#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Markrun, MarkrunError } from "./index.ts";

const help = `Markrun 0.1 — executable Markdown

Usage:
  mr file.mr [arguments...]                Execute from any directory
  mr --check file.mr                       Syntax-check without executing
  mr --list file.mr                        List addressable headings

Only run .mr files you trust: executable fences have full runtime access.`;

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    console.log(help);
    return;
  }
  const mode = argv[0] === "--check" || argv[0] === "--list" ? argv[0] : "run";
  const operands = mode === "run" ? argv : argv.slice(1);
  const [file, ...args] = operands[0] === "--" ? operands.slice(1) : operands;
  if (!file) throw new Error(help);
  const filename = resolve(file);
  const document = new Markrun(await readFile(filename, "utf8"), { filename, args });
  if (mode === "--check") {
    document.check();
    console.log(`OK: ${file} (${document.document.sections.length} headings)`);
    return;
  }
  if (mode === "--list") {
    for (const section of document.document.sections) console.log(`@:${section.label}\tline ${section.line}`);
    return;
  }

  // A direct file and the explicit CLI see the same argument vector.
  const nativeBun = (globalThis as typeof globalThis & { Bun?: { argv: string[] } }).Bun;
  const normalized = [process.execPath, filename, ...args];
  const vectors = new Set([process.argv, nativeBun?.argv]);
  for (const vector of vectors) if (vector) vector.splice(0, vector.length, ...normalized);
  await document.run();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof MarkrunError ? `[${error.code}] ${error.message}` : error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
