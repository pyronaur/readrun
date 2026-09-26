export { Markrun, runFile } from "./runtime.ts";
export type { MarkrunOptions, ConsoleLike, MarkrunModule } from "./runtime.ts";
export { MarkrunError } from "./errors.ts";
export { parse, resolveSection } from "./parser.ts";
export type { ParsedDocument, Region, Token, Chunk } from "./parser.ts";

/**
 * Inside a Markrun file: when any of `flags` is passed, print the named section and exit.
 * Markrun provides the working version; this export exists for editor types.
 */
export async function route(name: string, flags: readonly string[]): Promise<void> {
  throw new Error(`route(${JSON.stringify(name)}, ${JSON.stringify(flags)}) only works inside a Markdown file run by mr.`);
}
