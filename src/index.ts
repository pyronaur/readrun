export { Readrun, runFile } from "./runtime.ts";
export type { ReadrunOptions, ConsoleLike, ReadrunModule } from "./runtime.ts";
export { ReadrunError } from "./errors.ts";
export { parse, resolveSection } from "./parser.ts";
export type { ParsedDocument, Region, Token, Chunk } from "./parser.ts";

/**
 * Inside a Readrun file: when any of `flags` is passed, print the named section and exit.
 * Readrun provides the working version; this export exists for editor types.
 */
export async function route(name: string, flags: readonly string[]): Promise<void> {
  throw new Error(`route(${JSON.stringify(name)}, ${JSON.stringify(flags)}) only works inside a Markdown file run by readrun.`);
}
