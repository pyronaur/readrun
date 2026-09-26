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
 * A placeholder without a value is printed as written.
 */
export function interpolate(text: string, values: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([A-Za-z_$][\w$.-]*)\s*\}\}/g, (placeholder, name: string) => {
    const value = lookup(values, name);
    if (value === undefined) return placeholder;
    return value === null ? "" : String(value);
  });
}
