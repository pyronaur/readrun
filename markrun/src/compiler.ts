import ts from "typescript";
import { MarkrunError } from "./errors.ts";
import type { ParsedDocument, Region } from "./parser.ts";

export interface ExecutionContext {
  markrun: unknown;
  section: unknown;
  console: unknown;
  require: NodeJS.Require;
  module: { exports: unknown };
  filename: string;
  dirname: string;
  globals: Record<string, unknown>;
  meta: Record<string, unknown>;
  at(line: number): void;
  importModule(specifier: string, options?: ImportCallOptions): Promise<unknown>;
}

export type Program = (context: ExecutionContext) => unknown;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as FunctionConstructor;
const parameters = ["console", "require", "module", "exports", "__filename", "__dirname", "markrun", "section"];

/** Compile an entire region at once so bindings survive between its fences. */
export function compileRegion(document: ParsedDocument, region: Region, asynchronous: boolean, globals: string[] = []): Program {
  let internal = "__markrun_context";
  while (document.source.includes(internal) || globals.includes(internal)) internal += "_";
  for (const name of globals) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || parameters.includes(name)) {
      throw new MarkrunError("BINDING", `Invalid or reserved injected global ${JSON.stringify(name)}.`, document.filename);
    }
  }

  // Blank out prose rather than concatenate code: parser diagnostics retain .mr line numbers.
  const lines = Array<string>(document.lineCount).fill("");
  for (const token of region.tokens) {
    if (token.kind !== "code" || !token.executable) continue;
    lines[token.line - 1] = `${internal}.at(${token.line + 1});`;
    token.code!.split("\n").forEach((line, index) => { lines[token.line + index] = line; });
    // A fence boundary is also a statement boundary (avoid accidental ASI/IIFE concatenation).
    lines[token.endLine - 1] = ";";
  }
  const input = lines.join("\n");

  const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
    const factory = context.factory;
    const member = (name: string) => factory.createPropertyAccessExpression(factory.createIdentifier(internal), name);

    function visit(node: ts.Node, depth = 0): ts.VisitResult<ts.Node> {
      if (ts.isTypeNode(node)) return node;
      if (!asynchronous && depth === 0 && (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier))) {
        const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
        throw new MarkrunError("ASYNC_SECTION", `Implicit section pulls are synchronous. Move top-level await into the entry program (${region.label}).`, document.filename, line);
      }
      // Tagged templates (String.raw, Bun.$, etc.) belong to their tag, not Markrun.
      if (ts.isTaggedTemplateExpression(node)) {
        const tag = ts.visitNode(node.tag, child => visit(child, depth)) as ts.LeftHandSideExpression;
        const template = ts.visitEachChild(node.template, child => visit(child, depth), context) as ts.TemplateLiteral;
        return factory.updateTaggedTemplateExpression(node, tag, node.typeArguments, template);
      }
      const isReference = (ts.isNoSubstitutionTemplateLiteral(node) && node.text.trimStart().startsWith("@:"))
        || (ts.isTemplateExpression(node) && node.head.text.trimStart().startsWith("@:"));
      if (isReference) {
        const argument = ts.visitEachChild(node, child => visit(child, depth), context) as ts.Expression;
        return factory.createCallExpression(factory.createPropertyAccessExpression(member("markrun"), "pull"), undefined, [argument]);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        // Resolve dynamic imports relative to the .mr file, not this interpreter module.
        return factory.createCallExpression(member("importModule"), undefined, node.arguments.map(arg => ts.visitNode(arg, child => visit(child, depth)) as ts.Expression));
      }
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return member("meta");
      const nextDepth = ts.isFunctionLike(node) ? depth + 1 : depth;
      return ts.visitEachChild(node, child => visit(child, nextDepth), context);
    }
    return source => ts.visitNode(source, node => visit(node)) as ts.SourceFile;
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
    const Constructor = asynchronous ? AsyncFunction : Function;
    const sourceURL = `${document.filename.replace(/[\r\n]/g, "")}.${region.id.replace(":", "-")}.js`;
    executable = new Constructor(internal, ...parameters, ...globals, `${result.outputText}\n//# sourceURL=${sourceURL}`);
  } catch (cause) {
    throw new MarkrunError("SYNTAX", `Cannot compile ${region.label}: ${cause instanceof Error ? cause.message : String(cause)}`, document.filename, region.line, cause);
  }

  return context => executable(
    context, context.console, context.require, context.module, context.module.exports,
    context.filename, context.dirname, context.markrun, context.section,
    ...globals.map(name => context.globals[name]),
  );
}
