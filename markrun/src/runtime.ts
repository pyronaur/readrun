import { readFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileRegion } from "./compiler.ts";
import type { ExecutionContext, Program } from "./compiler.ts";
import { MarkrunError } from "./errors.ts";
import { Markdown } from "./markdown.ts";
import { markdownOf, parse, resolveSection } from "./parser.ts";
import type { ParsedDocument, Region } from "./parser.ts";

export interface ConsoleLike {
  log(...values: unknown[]): void;
  [key: string]: unknown;
}

export interface MarkrunOptions {
  filename?: string;
  args?: readonly string[];
  console?: ConsoleLike | Console;
  globals?: Record<string, unknown>;
  strictVariables?: boolean;
  maxDepth?: number;
}

function markdownConsole(target: ConsoleLike | Console): ConsoleLike {
  const printable = new Set(["log", "info", "warn", "error", "debug", "trace", "assert", "dir"]);
  return new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key, object);
      if (typeof value !== "function") return value;
      if (!printable.has(String(key))) return value.bind(object);
      return (...args: unknown[]) => Reflect.apply(value, object, args.map(arg => arg instanceof Markdown ? arg.render() : arg));
    },
  }) as ConsoleLike;
}

export class Markrun {
  readonly document: ParsedDocument;
  readonly args: readonly string[];
  readonly #options: MarkrunOptions;
  readonly #programs = new Map<string, Program>();
  readonly #stack: Region[] = [];
  readonly #require: NodeJS.Require;
  readonly #console: ConsoleLike;
  #running = false;

  constructor(source: string, options: MarkrunOptions = {}) {
    this.#options = { ...options, globals: { ...options.globals } };
    this.document = parse(source, resolve(options.filename ?? "document.mr"));
    this.args = Object.freeze([...(options.args ?? process.argv.slice(2))]);
    this.#require = createRequire(this.document.filename);
    this.#console = markdownConsole(options.console ?? console);
    if (options.maxDepth !== undefined && (!Number.isInteger(options.maxDepth) || options.maxDepth < 1)) {
      throw new MarkrunError("DEPTH", "maxDepth must be a positive integer.", this.document.filename);
    }
  }

  #program(region: Region, asynchronous: boolean): Program {
    const key = `${region.id}:${asynchronous}`;
    if (!this.#programs.has(key)) {
      this.#programs.set(key, compileRegion(this.document, region, asynchronous, Object.keys(this.#options.globals ?? {})));
    }
    return this.#programs.get(key)!;
  }

  #fragment(region: Region, values?: Record<string, unknown>): Markdown {
    const result = new Markdown(markdownOf(region), region.name, this.document.filename, region.line, this.#options.strictVariables);
    if (values) result.set(values);
    return result;
  }

  #resolveImport(specifier: string): string {
    if (typeof specifier !== "string") throw new TypeError("Module specifier must be a string.");
    if (isAbsolute(specifier)) return pathToFileURL(specifier).href;
    if (isBuiltin(specifier) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)) return specifier;
    if (specifier.startsWith(".")) {
      return new URL(specifier, pathToFileURL(this.document.filename)).href;
    }
    return pathToFileURL(this.#require.resolve(specifier)).href;
  }

  #context(region: Region, fragment: Markdown): { context: ExecutionContext; location: { line: number } } {
    const filename = this.document.filename;
    const location = { line: region.line };
    const module = { exports: {} };
    return {
      location,
      context: {
        markrun: this, section: fragment, console: this.#console,
        filename, dirname: dirname(filename), require: this.#require, module,
        globals: this.#options.globals ?? {},
        meta: { url: pathToFileURL(filename).href, filename, dirname: dirname(filename), main: true, resolve: (name: string) => this.#resolveImport(name) },
        at: line => { location.line = line; },
        importModule: (specifier, options) => import(this.#resolveImport(specifier), options),
      },
    };
  }

  #executionError(cause: unknown, region: Region, line: number): MarkrunError {
    if (cause instanceof MarkrunError) return cause;
    return new MarkrunError("EXECUTION", `While executing the block in ${region.name}: ${cause instanceof Error ? cause.message : String(cause)}`, this.document.filename, line, cause);
  }

  /** Pull is eager and synchronous. Every call creates a fresh, independently parameterized value. */
  pull(name: string, values?: Record<string, unknown>): Markdown {
    const region = resolveSection(this.document, name);
    if (this.#stack.some(active => active.id === region.id)) {
      const chain = [...this.#stack, region].map(item => `${item.name} (line ${item.line})`).join(" -> ");
      throw new MarkrunError("CYCLE", `Circular section pull: ${chain}`, this.document.filename, region.line);
    }
    if (this.#stack.length >= (this.#options.maxDepth ?? 64)) {
      throw new MarkrunError("DEPTH", "Maximum section-pull depth exceeded.", this.document.filename, region.line);
    }
    const program = this.#program(region, false);
    const fragment = this.#fragment(region, values);
    const { context, location } = this.#context(region, fragment);
    this.#stack.push(region);
    try {
      program(context);
      return fragment;
    } catch (cause) {
      throw this.#executionError(cause, region, location.line);
    } finally {
      this.#stack.pop();
    }
  }

  /** Execute only the entry region, which ends at the first section marker. Prose is not auto-printed. */
  async run(values?: Record<string, unknown>): Promise<Markdown> {
    if (this.#running) throw new MarkrunError("REENTRY", "This document's entry program is already running.", this.document.filename);
    this.#running = true;
    const region = this.document.entry;
    try {
      const program = this.#program(region, true);
      const fragment = this.#fragment(region, values);
      const { context, location } = this.#context(region, fragment);
      try {
        await program(context);
        return fragment;
      } catch (cause) {
        throw this.#executionError(cause, region, location.line);
      }
    } finally {
      this.#running = false;
    }
  }

  /** Syntax-check every region without running any code. This is not a TypeScript type check. */
  check(): void {
    this.#program(this.document.entry, true);
    for (const region of this.document.sections) this.#program(region, false);
  }
}

export async function runFile(filename: string, options: Omit<MarkrunOptions, "filename"> = {}): Promise<Markrun> {
  const absolute = resolve(filename);
  const document = new Markrun(await readFile(absolute, "utf8"), { ...options, filename: absolute });
  await document.run();
  return document;
}
