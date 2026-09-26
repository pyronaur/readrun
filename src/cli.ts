#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Markrun, MarkrunError } from "./index.ts";
import manifest from "../package.json" with { type: "json" };

const help = `Markrun: run Markdown files as commands

Usage:
  mr file.md [arguments...]                Execute from any directory
  mr --check file.md                       Syntax-check without executing
  mr --list file.md                        List section names
  mr --version                             Print the Markrun version

Only run Markdown files you trust: executable fences have full runtime access.`;

/** A mistake in how mr itself was called: shown with the usage text, exit code 2. */
class UsageError extends Error {}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    console.log(help);
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(`markrun ${manifest.version}`);
    return;
  }
  const mode = argv[0] === "--check" || argv[0] === "--list" ? argv[0] : "run";
  const operands = mode === "run" ? argv : argv.slice(1);
  if (operands[0]?.startsWith("-") && operands[0] !== "--") throw new UsageError(`Unknown option ${operands[0]}.`);
  const [file, ...args] = operands[0] === "--" ? operands.slice(1) : operands;
  if (!file) throw new UsageError("No file given.");
  const filename = resolve(file);
  let source: string;
  try {
    source = await readFile(filename, "utf8");
  } catch (cause) {
    const reason = (cause as NodeJS.ErrnoException).code ?? (cause instanceof Error ? cause.message : String(cause));
    throw new MarkrunError("FILE", `Cannot read ${file} (${reason}).`, filename, 1);
  }
  const document = new Markrun(source, { filename, args });
  if (mode === "--check") {
    document.check();
    console.log(`OK: ${file} (${document.document.sections.length} sections)`);
    return;
  }
  if (mode === "--list") {
    for (const section of document.document.sections) console.log(`${section.name}\tline ${section.line}`);
    return;
  }

  // A direct file and the explicit CLI see the same argument vector.
  const nativeBun = (globalThis as typeof globalThis & { Bun?: { argv: string[] } }).Bun;
  const normalized = [process.execPath, filename, ...args];
  const vectors = new Set([process.argv, nativeBun?.argv]);
  for (const vector of vectors) if (vector) vector.splice(0, vector.length, ...normalized);
  await document.run();
}

// import.meta.main also works in bytecode builds, where import.meta.url is the original source path.
const isMain = (import.meta as { main?: boolean }).main ?? (!!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`mr: ${error.message}\n\n${help}`);
      process.exitCode = 2;
      return;
    }
    if (error instanceof MarkrunError) {
      console.error(`[${error.code}] ${error.code === "FILE" ? error.message.replace(/^.*?:1: /, "") : error.message}`);
      if (error.cause !== undefined) console.error(error.cause);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
