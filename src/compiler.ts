import { createRequire } from "node:module";
import type TS from "typescript";
import { cacheKey, readCache, writeCache } from "./cache.ts";
import { ReadrunError } from "./errors.ts";
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
  render(name: unknown, values?: unknown): Promise<string>;
  all(renders: Promise<string>[]): Promise<string[]>;
  importModule(specifier: string, options?: ImportCallOptions): Promise<unknown>;
}

export type Program = (context: ExecutionContext) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as FunctionConstructor;
export const parameters = ["console", "require", "module", "exports", "__filename", "__dirname"];
const reserved = new Set(("break case catch class const continue debugger default delete do else enum export extends false finally for "
  + "function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static "
  + "implements interface package private protected public await arguments eval").split(" "));

/**
 * TypeScript takes ~100 ms to load, so it is loaded only when something isn't cached yet.
 * The literal require() lets `bun build --compile` bundle it; Node uses createRequire.
 */
let loaded: typeof TS | undefined;
function typescript(): typeof TS {
  return loaded ??= typeof require === "function" ? require("typescript") : createRequire(import.meta.url)("typescript");
}

/** A passed value becomes a variable only when its key is a usable identifier. */
export const isVariableName = (name: string): boolean => /^[A-Za-z_$][\w$]*$/.test(name) && !reserved.has(name);

/** Blank out prose rather than concatenate code: parser diagnostics retain .md line numbers. */
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

function bindingNames(name: TS.BindingName, into: Set<string>): void {
  const ts = typescript();
  if (ts.isIdentifier(name)) into.add(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, into);
}

/** Names a section declares at its top level. A passed value must not reuse one. */
export function declaredNames(document: ParsedDocument, region: Region): Set<string> {
  const key = cacheKey(codegen, "names", document.source, region.id);
  const hit = readCache<string[]>(key);
  if (Array.isArray(hit)) return new Set(hit);
  const ts = typescript();
  const names = new Set<string>();
  const source = ts.createSourceFile("region.ts", regionSource(document, region, "__readrun_context", []), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
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
      for (const line of renderLines(statement) ?? []) names.add(line.target.text);
    }
  }
  writeCache(key, [...names]);
  return names;
}

interface RenderLine { statement: TS.Statement; target: TS.Identifier; name: TS.Expression; values?: TS.Expression }

/** `target = name` or `target = name, values`. */
function renderParts(statement: TS.Statement): RenderLine | undefined {
  const ts = typescript();
  let expression = ts.isExpressionStatement(statement) ? statement.expression : undefined;
  let values: TS.Expression | undefined;
  if (expression && ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    values = expression.right;
    expression = expression.left;
  }
  if (!expression || !ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(expression.left)) return undefined;
  return { statement, target: expression.left, name: expression.right, values };
}

/** `$: line` renders one section; `$: { line; line }` renders several at the same time. Undefined when any line isn't a render. */
function renderLines(node: TS.LabeledStatement): RenderLine[] | undefined {
  const ts = typescript();
  const statements = ts.isBlock(node.statement) ? [...node.statement.statements] : [node.statement];
  const lines = statements.map(renderParts);
  return lines.length && lines.every(line => line) ? lines as RenderLine[] : undefined;
}

/** Compile an entire region at once so bindings survive between its fences. Every region is async. */
export function compileRegion(document: ParsedDocument, region: Region, globals: string[] = [], values: string[] = []): Program {
  let internal = "__readrun_context";
  while (document.source.includes(internal) || globals.includes(internal)) internal += "_";
  for (const name of globals) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || parameters.includes(name)) {
      throw new ReadrunError("BINDING", `Invalid or reserved injected global ${JSON.stringify(name)}.`, document.filename);
    }
  }
  const key = cacheKey(codegen, "region", document.source, region.id, internal, globals.join(","), values.join(","));
  let output = readCache<string>(key);
  if (typeof output !== "string") {
    output = transpile(document, region, internal, values);
    writeCache(key, output);
  }

  let executable: Function;
  try {
    const sourceURL = `${document.filename.replace(/[\r\n]/g, "")}.${region.id.replace(":", "-")}.js`;
    executable = new AsyncFunction(internal, ...parameters, ...globals, `${output}\n//# sourceURL=${sourceURL}`);
  } catch (cause) {
    throw new ReadrunError("SYNTAX", `Cannot compile ${region.name}: ${cause instanceof Error ? cause.message : String(cause)}`, document.filename, region.line, cause);
  }

  return context => executable(
    context, context.console, context.require, context.module, context.module.exports,
    context.filename, context.dirname,
    ...globals.map(name => context.globals[name]),
  );
}

/** Rewrite `$:` renders, imports and import.meta, then strip types. Only successful output is cached. */
function transpile(document: ParsedDocument, region: Region, internal: string, values: string[]): string {
  const ts = typescript();
  const input = regionSource(document, region, internal, values);

  const transformer: TS.TransformerFactory<TS.SourceFile> = context => {
    const factory = context.factory;
    const member = (name: string) => factory.createPropertyAccessExpression(factory.createIdentifier(internal), name);

    function visit(node: TS.Node): TS.VisitResult<TS.Node> {
      if (ts.isTypeNode(node)) return node;
      // `$: md = 'Section', values` becomes `const md = await render('Section', values)`.
      // `$: { a = 'A'; b = 'B' }` becomes `const [a, b] = await Promise.all([render('A'), render('B')])`.
      if (ts.isLabeledStatement(node) && node.label.text === "$") {
        const lineOf = (item: TS.Node) => item.getSourceFile().getLineAndCharacterOfPosition(item.getStart()).line + 1;
        const line = lineOf(node);
        const parallel = ts.isBlock(node.statement);
        const lines = renderLines(node);
        if (!lines) {
          const statements = parallel ? [...(node.statement as TS.Block).statements] : [];
          const bad = statements.find(statement => !renderParts(statement));
          if (parallel && !bad) throw new ReadrunError("RENDER", "A $: { } block needs at least one render inside.", document.filename, line);
          throw new ReadrunError("RENDER", parallel
            ? "Each line in a $: { } block must render a section, as in a = 'Section', { values };"
            : "A $: render must assign a section to a name, as in $: md = 'Section' or $: md = 'Section', { values }.", document.filename, bad ? lineOf(bad) : line);
        }
        // Lines in a block run at the same time, so none of them can use another's result.
        const targets = new Map(lines.map(item => [item.target.text, item]));
        if (targets.size < lines.length) {
          const repeated = lines.find((item, index) => lines.findIndex(other => other.target.text === item.target.text) !== index)!;
          throw new ReadrunError("RENDER", `${repeated.target.text} is assigned twice in the same $: { } block.`, document.filename, lineOf(repeated.statement));
        }
        const uses = (expression: TS.Node): string | undefined => {
          if (ts.isIdentifier(expression) && targets.has(expression.text)
            && !(ts.isPropertyAccessExpression(expression.parent) && expression.parent.name === expression)
            && !(ts.isPropertyAssignment(expression.parent) && expression.parent.name === expression)) return expression.text;
          return ts.forEachChild(expression, uses);
        };
        if (parallel) for (const item of lines) {
          const used = [item.name, item.values].map(part => part && uses(part)).find(Boolean);
          if (used) throw new ReadrunError("RENDER", `${item.target.text} can't use ${used}: lines in a $: { } block render at the same time. Move it after the block.`, document.filename, lineOf(item.statement));
        }
        if (!ts.isBlock(node.parent) && !ts.isSourceFile(node.parent) && !ts.isCaseOrDefaultClause(node.parent)) {
          throw new ReadrunError("RENDER", "A $: render declares a variable, so it needs its own block. Wrap it in { }.", document.filename, line);
        }
        let owner: TS.Node | undefined = node.parent;
        while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
        if (owner && !ts.canHaveModifiers(owner)) owner = undefined;
        if (owner && !ts.getModifiers(owner as TS.HasModifiers)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
          throw new ReadrunError("RENDER", "A $: render waits for the section, so the function around it must be async.", document.filename, line);
        }
        const calls = lines.map(item => factory.createCallExpression(member("render"), undefined,
          [item.name, ...(item.values ? [item.values] : [])].map(arg => ts.visitNode(arg, visit) as TS.Expression)));
        const declaration = parallel
          ? factory.createVariableDeclaration(
            factory.createArrayBindingPattern(lines.map(item => factory.createBindingElement(undefined, undefined, item.target.text))), undefined, undefined,
            factory.createAwaitExpression(factory.createCallExpression(member("all"), undefined, [factory.createArrayLiteralExpression(calls)])))
          : factory.createVariableDeclaration(lines[0].target.text, undefined, undefined, factory.createAwaitExpression(calls[0]));
        return factory.createVariableStatement(undefined, factory.createVariableDeclarationList([declaration], ts.NodeFlags.Const));
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        // Resolve dynamic imports relative to the .md file, not this interpreter module.
        return factory.createCallExpression(member("importModule"), undefined, node.arguments.map(arg => ts.visitNode(arg, visit) as TS.Expression));
      }
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return member("meta");
      return ts.visitEachChild(node, visit, context);
    }
    return source => ts.visitNode(source, visit) as TS.SourceFile;
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
    throw new ReadrunError("SYNTAX", ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"), document.filename, line);
  }
  return result.outputText;
}

/** Changes whenever the code generation changes, so a new Readrun never reuses old output. */
const codegen = cacheKey("readrun-codegen", ...[regionSource, renderParts, renderLines, declaredNames, compileRegion, transpile].map(String));
