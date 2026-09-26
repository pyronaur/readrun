import ts from "typescript";
import { MarkrunError } from "./errors.ts";
import type { ParsedDocument, Region } from "./parser.ts";

export interface ExecutionContext {
  console: unknown;
  require: NodeJS.Require;
  module: { exports: unknown };
  filename: string;
  dirname: string;
  globals: Record<string, unknown>;
  meta: Record<string, unknown>;
  values: Record<string, unknown>;
  at(line: number): void;
  text(index: number): void;
  pull(name: unknown, values?: unknown): Promise<string>;
  importModule(specifier: string, options?: ImportCallOptions): Promise<unknown>;
}

export type Program = (context: ExecutionContext) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as FunctionConstructor;
export const parameters = ["console", "require", "module", "exports", "__filename", "__dirname"];
const reserved = new Set(("break case catch class const continue debugger default delete do else enum export extends false finally for "
  + "function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static "
  + "implements interface package private protected public await arguments eval").split(" "));

/** A passed value becomes a variable only when its key is a usable identifier. */
export const isVariableName = (name: string): boolean => /^[A-Za-z_$][\w$]*$/.test(name) && !reserved.has(name);

/** Blank out prose rather than concatenate code: parser diagnostics retain .mr line numbers. */
function regionSource(document: ParsedDocument, region: Region, internal: string, values: string[]): string {
  const lines = Array<string>(document.lineCount).fill("");
  for (const token of region.tokens) {
    if (token.kind !== "code" || !token.executable) continue;
    lines[token.line - 1] = `${internal}.at(${token.line + 1});`;
    token.code!.split("\n").forEach((line, index) => { lines[token.line + index] = line; });
    // A fence boundary is also a statement boundary (avoid accidental ASI/IIFE concatenation).
    lines[token.endLine - 1] = ";";
  }
  // Text is emitted where it stands, so code output lands between the surrounding text.
  region.chunks.forEach((chunk, index) => { lines[chunk.line - 1] = `${internal}.text(${index});`; });
  // Passed values are declared on the marker line, before any of the section's own code.
  if (values.length) lines[region.line - 1] = `const { ${values.join(", ")} } = ${internal}.values;`;
  return lines.join("\n");
}

function bindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) into.add(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, into);
}

/** Names a section declares at its top level. A passed value must not reuse one. */
export function declaredNames(document: ParsedDocument, region: Region): Set<string> {
  const names = new Set<string>();
  const source = ts.createSourceFile("region.ts", regionSource(document, region, "__markrun_context", []), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, names);
    else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.add(statement.name.text);
    else if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      if (clause.name) names.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
      else if (bindings) for (const element of bindings.elements) names.add(element.name.text);
    } else if (ts.isLabeledStatement(statement) && statement.label.text === "$") {
      const pull = pullParts(statement);
      if (pull) names.add(pull.target.text);
    }
  }
  return names;
}

/** `$: target = name` or `$: target = name, values`. */
function pullParts(node: ts.LabeledStatement): { target: ts.Identifier; name: ts.Expression; values?: ts.Expression } | undefined {
  let expression = ts.isExpressionStatement(node.statement) ? node.statement.expression : undefined;
  let values: ts.Expression | undefined;
  if (expression && ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    values = expression.right;
    expression = expression.left;
  }
  if (!expression || !ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(expression.left)) return undefined;
  return { target: expression.left, name: expression.right, values };
}

/** Compile an entire region at once so bindings survive between its fences. Every region is async. */
export function compileRegion(document: ParsedDocument, region: Region, globals: string[] = [], values: string[] = []): Program {
  let internal = "__markrun_context";
  while (document.source.includes(internal) || globals.includes(internal)) internal += "_";
  for (const name of globals) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || parameters.includes(name)) {
      throw new MarkrunError("BINDING", `Invalid or reserved injected global ${JSON.stringify(name)}.`, document.filename);
    }
  }
  const input = regionSource(document, region, internal, values);

  const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
    const factory = context.factory;
    const member = (name: string) => factory.createPropertyAccessExpression(factory.createIdentifier(internal), name);

    function visit(node: ts.Node): ts.VisitResult<ts.Node> {
      if (ts.isTypeNode(node)) return node;
      // `$: md = 'Section', values` becomes `const md = await pull('Section', values)`.
      if (ts.isLabeledStatement(node) && node.label.text === "$") {
        const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const pull = pullParts(node);
        if (!pull) {
          throw new MarkrunError("PULL", "A $: pull must assign a section to a name, as in $: md = 'Section' or $: md = 'Section', { values }.", document.filename, line);
        }
        if (!ts.isBlock(node.parent) && !ts.isSourceFile(node.parent) && !ts.isCaseOrDefaultClause(node.parent)) {
          throw new MarkrunError("PULL", "A $: pull declares a variable, so it needs its own block. Wrap it in { }.", document.filename, line);
        }
        let owner: ts.Node | undefined = node.parent;
        while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
        if (owner && !ts.canHaveModifiers(owner)) owner = undefined;
        if (owner && !ts.getModifiers(owner as ts.HasModifiers)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
          throw new MarkrunError("PULL", "A $: pull waits for the section, so the function around it must be async.", document.filename, line);
        }
        const args = [pull.name, ...(pull.values ? [pull.values] : [])].map(arg => ts.visitNode(arg, visit) as ts.Expression);
        const call = factory.createAwaitExpression(factory.createCallExpression(member("pull"), undefined, args));
        return factory.createVariableStatement(undefined, factory.createVariableDeclarationList(
          [factory.createVariableDeclaration(pull.target.text, undefined, undefined, call)], ts.NodeFlags.Const,
        ));
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        // Resolve dynamic imports relative to the .mr file, not this interpreter module.
        return factory.createCallExpression(member("importModule"), undefined, node.arguments.map(arg => ts.visitNode(arg, visit) as ts.Expression));
      }
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return member("meta");
      return ts.visitEachChild(node, visit, context);
    }
    return source => ts.visitNode(source, visit) as ts.SourceFile;
  };

  const result = ts.transpileModule(input, {
    // .cts makes static imports local synchronous require calls. Dynamic imports use our resolver.
    fileName: `${document.filename}.cts`,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
      alwaysStrict: true,
      newLine: ts.NewLineKind.LineFeed,
    },
    reportDiagnostics: true,
    transformers: { before: [transformer] },
  });
  const diagnostic = result.diagnostics?.find(item => item.category === ts.DiagnosticCategory.Error);
  if (diagnostic) {
    const line = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : region.line;
    throw new MarkrunError("SYNTAX", ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"), document.filename, line);
  }

  let executable: Function;
  try {
    const sourceURL = `${document.filename.replace(/[\r\n]/g, "")}.${region.id.replace(":", "-")}.js`;
    executable = new AsyncFunction(internal, ...parameters, ...globals, `${result.outputText}\n//# sourceURL=${sourceURL}`);
  } catch (cause) {
    throw new MarkrunError("SYNTAX", `Cannot compile ${region.name}: ${cause instanceof Error ? cause.message : String(cause)}`, document.filename, region.line, cause);
  }

  return context => executable(
    context, context.console, context.require, context.module, context.module.exports,
    context.filename, context.dirname,
    ...globals.map(name => context.globals[name]),
  );
}
