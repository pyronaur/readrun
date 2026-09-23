import { MarkrunError } from "./errors.ts";

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

/** Code runs when this value is created by pull(), never during inspection/coercion. */
export class Markdown {
  readonly heading: string;
  readonly source: string;
  readonly #filename: string;
  readonly #line: number;
  readonly #strict: boolean;
  readonly #values = new Map<string, unknown>();

  constructor(source: string, heading: string, filename: string, line: number, strict = false) {
    this.source = source;
    this.heading = heading;
    this.#filename = filename;
    this.#line = line;
    this.#strict = strict;
  }

  set(name: string, value: unknown): this;
  set(values: Record<string, unknown>): this;
  set(name: string | Record<string, unknown>, value?: unknown): this {
    if (typeof name === "object" && name !== null && !Array.isArray(name)) {
      for (const [key, item] of Object.entries(name)) this.set(key, item);
      return this;
    }
    if (typeof name !== "string" || !name.trim() || name.split(".").some(key => dangerousKeys.has(key))) {
      throw new MarkrunError("VARIABLE", "Variable names must be nonempty and cannot contain prototype-access keys.", this.#filename, this.#line);
    }
    this.#values.set(name, value);
    return this;
  }

  get(name: string): unknown {
    if (this.#values.has(name)) return this.#values.get(name);
    const [first, ...parts] = name.split(".");
    if (dangerousKeys.has(first) || !this.#values.has(first)) return undefined;
    let value = this.#values.get(first);
    for (const part of parts) {
      if (dangerousKeys.has(part) || value === null || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  }

  render(): string {
    return this.source.replace(/\{\{\s*([A-Za-z_$][\w$.-]*)\s*\}\}/g, (placeholder, name: string) => {
      const value = this.get(name);
      if (value === undefined) {
        if (this.#strict) throw new MarkrunError("VARIABLE", `Missing variable ${JSON.stringify(name)} in ${this.heading}.`, this.#filename, this.#line);
        return placeholder;
      }
      // This is data substitution, never eval(), and never feeds the executable code compiler.
      return value === null ? "" : String(value);
    });
  }

  toString(): string { return this.render(); }
  toJSON(): string { return this.render(); }
  [Symbol.toPrimitive](): string { return this.render(); }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.render(); }
  [Symbol.for("Bun.inspect.custom")](): string { return this.render(); }
}
