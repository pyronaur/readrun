import { readFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "node:util";
import { compileRegion, declaredNames, isVariableName, parameters } from "./compiler.ts";
import type { ExecutionContext, Program } from "./compiler.ts";
import { MarkrunError } from "./errors.ts";
import { interpolate } from "./markdown.ts";
import { parse, resolveSection } from "./parser.ts";
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
  maxDepth?: number;
  /** Called by route() after printing. Defaults to process.exit. */
  exit?: (code: number) => void;
}

/** What `import { ... } from 'markrun'` gives a .md file. */
export interface MarkrunModule {
  route(name: string, flags: readonly string[]): Promise<void>;
}

/**
 * Where a render's text and printed output go, in file order. Inside a rendered section, printing is
 * collected instead of written. Blank lines around a block that printed nothing never double up.
 */
function printer(target: ConsoleLike | Console, collect?: string[]) {
  const printing = new Set(["log", "info", "debug"]);
  let endsBlank = false;
  const write = (value: string) => { if (collect) collect.push(value); else target.log(value); };
  const console = new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key, object);
      if (!printing.has(String(key))) return typeof value === "function" ? value.bind(object) : value;
      return (...args: unknown[]) => {
        endsBlank = false;
        if (collect) collect.push(format(...args)); else Reflect.apply(value as Function, object, args);
      };
    },
  }) as ConsoleLike;
  const text = (value: string) => {
    if (endsBlank) value = value.replace(/^(?:[ \t]*\n)+/, "");
    endsBlank = /\n[ \t]*$/.test(value);
    write(value);
  };
  return { console, text };
}

/** `-h` also matches combined short flags such as `-vh`. Arguments after `--` never match. */
function hasFlag(args: readonly string[], flags: readonly string[]): boolean {
  const end = args.indexOf("--");
  for (const arg of end === -1 ? args : args.slice(0, end)) {
    if (flags.includes(arg)) return true;
    if (/^-[A-Za-z0-9]{2,}$/.test(arg) && flags.some(flag => /^-[A-Za-z0-9]$/.test(flag) && arg.includes(flag[1]))) return true;
  }
  return false;
}

export class Markrun {
  readonly document: ParsedDocument;
  readonly args: readonly string[];
  readonly #options: MarkrunOptions;
  readonly #programs = new Map<string, Program>();
  readonly #declared = new Map<string, Set<string>>();
  readonly #require: NodeJS.Require;
  readonly #console: ConsoleLike | Console;
  readonly #module: MarkrunModule;
  #running = false;

  constructor(source: string, options: MarkrunOptions = {}) {
    this.#options = { ...options, globals: { ...options.globals } };
    this.document = parse(source, resolve(options.filename ?? "document.md"));
    this.args = Object.freeze([...(options.args ?? process.argv.slice(2))]);
    this.#require = createRequire(this.document.filename);
    this.#console = options.console ?? console;
    this.#module = { route: (name, flags) => this.#route(name, flags) };
    if (options.maxDepth !== undefined && (!Number.isInteger(options.maxDepth) || options.maxDepth < 1)) {
      throw new MarkrunError("DEPTH", "maxDepth must be a positive integer.", this.document.filename);
    }
  }

  #program(region: Region, values: string[]): Program {
    const key = `${region.id}:${values.join(",")}`;
    if (!this.#programs.has(key)) {
      this.#programs.set(key, compileRegion(this.document, region, Object.keys(this.#options.globals ?? {}), values));
    }
    return this.#programs.get(key)!;
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

  #requireFor(): NodeJS.Require {
    const base = this.#require;
    return Object.assign((id: string) => id === "markrun" ? this.#module : base(id), {
      resolve: base.resolve, cache: base.cache, extensions: base.extensions, main: base.main,
    }) as NodeJS.Require;
  }

  #context(region: Region, values: Record<string, unknown>, output: ReturnType<typeof printer>, chain: Region[]) {
    const filename = this.document.filename;
    const location = { line: region.line };
    const module = { exports: {} };
    const context: ExecutionContext = {
      console: output.console, values,
      filename, dirname: dirname(filename), require: this.#requireFor(), module,
      globals: this.#options.globals ?? {},
      meta: { url: pathToFileURL(filename).href, filename, dirname: dirname(filename), main: true, resolve: (name: string) => this.#resolveImport(name) },
      at: line => { location.line = line; },
      text: index => {
        const chunk = region.chunks[index];
        output.text(interpolate(chunk.text, values, region.name, filename, chunk.line));
      },
      render: (name, passed) => this.#render(name, passed, chain),
      importModule: (specifier, options) => specifier === "markrun" ? Promise.resolve(this.#module) : import(this.#resolveImport(specifier), options),
    };
    return { context, location };
  }

  #executionError(cause: unknown, region: Region, line: number): MarkrunError {
    if (cause instanceof MarkrunError) return cause;
    const where = region.id === "entry" ? "the entry" : `section ${JSON.stringify(region.name)}`;
    return new MarkrunError("EXECUTION", `While running ${where}: ${cause instanceof Error ? cause.message : String(cause)}`, this.document.filename, line, cause);
  }

  #variables(region: Region, values: Record<string, unknown>): string[] {
    if (!this.#declared.has(region.id)) this.#declared.set(region.id, declaredNames(this.document, region));
    const declared = this.#declared.get(region.id)!;
    const names = Object.keys(values).filter(isVariableName).sort();
    for (const name of names) {
      if (declared.has(name) || parameters.includes(name) || Object.hasOwn(this.#options.globals ?? {}, name)) {
        throw new MarkrunError("VALUE", `The value ${JSON.stringify(name)} passed to section ${JSON.stringify(region.name)} has the same name as a variable the section already has. Rename one of them.`, this.document.filename, region.line);
      }
    }
    return names;
  }

  /** Render a section: run its code top to bottom and collect its text and printed output in order. */
  async #render(name: unknown, passed: unknown, chain: Region[]): Promise<string> {
    if (typeof name !== "string") throw new MarkrunError("SELECTOR", "A section name must be a string.", this.document.filename);
    const region = resolveSection(this.document, name);
    if (passed !== undefined && (passed === null || typeof passed !== "object" || Array.isArray(passed))) {
      throw new MarkrunError("VALUE", `Values for section ${JSON.stringify(region.name)} must be an object, as in $: md = '${region.name}', { title }.`, this.document.filename, region.line);
    }
    if (chain.includes(region)) {
      const path = [...chain, region].map(item => `${item.name} (line ${item.line})`).join(" -> ");
      throw new MarkrunError("CYCLE", `Circular section render: ${path}`, this.document.filename, region.line);
    }
    if (chain.length >= (this.#options.maxDepth ?? 64)) {
      throw new MarkrunError("DEPTH", "Maximum section depth exceeded.", this.document.filename, region.line);
    }
    const values = { ...(passed as Record<string, unknown> | undefined) };
    const program = this.#program(region, this.#variables(region, values));
    const output: string[] = [];
    const { context, location } = this.#context(region, values, printer(this.#console, output), [...chain, region]);
    try {
      await program(context);
    } catch (cause) {
      throw this.#executionError(cause, region, location.line);
    }
    return output.join("\n");
  }

  async #route(name: string, flags: readonly string[]): Promise<void> {
    if (!Array.isArray(flags)) throw new MarkrunError("ROUTE", "route() needs a list of flags, as in route('Help', ['-h', '--help']).", this.document.filename);
    if (!hasFlag(this.args, flags)) return;
    this.#console.log(await this.#render(name, undefined, []));
    (this.#options.exit ?? (code => process.exit(code)))(0);
  }

  /** Render a section by name and return its text. */
  render(name: string, values?: Record<string, unknown>): Promise<string> {
    return this.#render(name, values, []);
  }

  /** Run the entry: its text and printed output go straight to the console, in order. */
  async run(): Promise<void> {
    if (this.#running) throw new MarkrunError("REENTRY", "This document's entry program is already running.", this.document.filename);
    this.#running = true;
    const region = this.document.entry;
    try {
      const program = this.#program(region, []);
      const { context, location } = this.#context(region, {}, printer(this.#console), [region]);
      try {
        await program(context);
      } catch (cause) {
        throw this.#executionError(cause, region, location.line);
      }
    } finally {
      this.#running = false;
    }
  }

  /** Syntax-check every region without running any code. This is not a TypeScript type check. */
  check(): void {
    this.#program(this.document.entry, []);
    for (const region of this.document.sections) this.#program(region, []);
  }
}

export async function runFile(filename: string, options: Omit<MarkrunOptions, "filename"> = {}): Promise<Markrun> {
  const absolute = resolve(filename);
  const document = new Markrun(await readFile(absolute, "utf8"), { ...options, filename: absolute });
  await document.run();
  return document;
}
