import { MarkrunError } from "./errors.ts";

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

/** Follow own properties only; a dotted path never reaches the prototype chain. */
function lookup(values: Record<string, unknown>, name: string): unknown {
  if (Object.hasOwn(values, name)) return values[name];
  let value: unknown = values;
  for (const part of name.split(".")) {
    if (dangerousKeys.has(part) || value === null || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * Fill `{{ name }}` from the values passed by the caller. This is data substitution, never eval().
 * Code is literal in Markdown, so placeholders inside inline code or fenced blocks are left as written.
 */
const code = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n {0,3}\1[`~]*[ \t]*(?=\n|$)|(`+)[^`\n][\s\S]*?\2/;
const placeholder = /\{\{\s*([A-Za-z_$][\w$.-]*)\s*\}\}/;
const pattern = new RegExp(`${code.source}|${placeholder.source}`, "g");

export function interpolate(text: string, values: Record<string, unknown>, section: string, filename: string, line: number): string {
  return text.replace(pattern, (match: string, _fence: string, _ticks: string, name: string | undefined, offset: number) => {
    if (!name) return match;
    const value = lookup(values, name);
    if (value === undefined) {
      const where = section === "<entry>" ? "The entry gets no values, so it cannot use" : `Section ${JSON.stringify(section)} needs a value for`;
      throw new MarkrunError("VALUE", `${where} {{ ${name} }}. Pass it where the section is rendered.`, filename, line + text.slice(0, offset).split("\n").length - 1);
    }
    return value === null ? "" : String(value);
  });
}
