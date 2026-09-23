import { MarkrunError } from "./errors.ts";

export interface Token {
  kind: "text" | "heading" | "code" | "stop";
  raw: string;
  line: number;
  endLine: number;
  code?: string;
  executable?: boolean;
  level?: number;
  title?: string;
}

export interface Region {
  id: string;
  label: string;
  level: number;
  title: string;
  alias: string;
  line: number;
  tokens: Token[];
}

export interface ParsedDocument {
  filename: string;
  source: string;
  lineCount: number;
  tokens: Token[];
  entry: Region;
  sections: Region[];
}

const executableLanguages = new Set(["", "ts", "typescript", "js", "javascript"]);
export const normalizeHeading = (value: string): string => value.trim().replace(/\s+/g, " ");

/** A deliberate Markdown subset: ATX headings and top-level fenced blocks. */
export function parse(source: string, filename = "document.mr"): ParsedDocument {
  source = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const tokens: Token[] = [];
  let inComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = i;
    // A full-line HTML comment is prose, never an executable container.
    if (inComment || /^ {0,3}<!--/.test(line)) {
      inComment = !line.includes("-->");
      tokens.push({ kind: "text", raw: line, line: i + 1, endLine: i + 1 });
      continue;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (fence) {
      const delimiter = fence[1][0];
      const width = fence[1].length;
      const info = fence[2].trim();
      if (delimiter === "`" && info.includes("`")) {
        throw new MarkrunError("FENCE", "A backtick fence's info string cannot contain backticks.", filename, i + 1);
      }
      const close = new RegExp(`^ {0,3}${delimiter === "`" ? "`" : "~"}{${width},}[ \\t]*$`);
      const body: string[] = [];
      while (++i < lines.length && !close.test(lines[i])) body.push(lines[i]);
      if (i >= lines.length) {
        throw new MarkrunError("FENCE", `Unclosed ${delimiter.repeat(width)} fence.`, filename, start + 1);
      }
      // Only exact language labels execute. `ts noexec` and all tilde fences are display-only.
      tokens.push({
        kind: "code", line: start + 1, endLine: i + 1,
        raw: lines.slice(start, i + 1).join("\n"), code: body.join("\n"),
        executable: delimiter === "`" && executableLanguages.has(info.toLowerCase()),
      });
    } else if (/^ {0,3}---[ \t]*$/.test(line)) {
      tokens.push({ kind: "stop", raw: line, line: i + 1, endLine: i + 1 });
    } else {
      const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
      if (heading) {
        const title = normalizeHeading((heading[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, ""));
        if (!title) throw new MarkrunError("HEADING", "Headings need a nonempty title so they can be referenced.", filename, i + 1);
        tokens.push({ kind: "heading", raw: line, line: i + 1, endLine: i + 1, level: heading[1].length, title });
      } else {
        tokens.push({ kind: "text", raw: line, line: i + 1, endLine: i + 1 });
      }
    }
  }

  function regionTokens(start: number, end: number): Token[] {
    const result: Token[] = [];
    for (let i = start; i < end && tokens[i].kind !== "stop"; i++) result.push(tokens[i]);
    return result;
  }

  const sections: Region[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== "heading") continue;
    let end = i + 1;
    while (end < tokens.length) {
      const next = tokens[end];
      if (next.kind === "heading" && next.level! <= token.level!) break;
      end++;
    }
    const title = token.title!;
    const alias = normalizeHeading(title.split(":", 1)[0]);
    sections.push({
      id: `heading:${token.line}`, label: `${"#".repeat(token.level!)} ${title}`,
      level: token.level!, title, alias, line: token.line, tokens: regionTokens(i, end),
    });
  }

  return {
    source, filename, lineCount: lines.length, tokens, sections,
    entry: { id: "entry", label: "<entry>", title: "", alias: "", level: 0, line: 1, tokens: regionTokens(0, tokens.length) },
  };
}

/** Resolve full titles first, then the label preceding a colon. Hash depth is significant. */
export function resolveSection(document: ParsedDocument, selector: string): Region {
  if (typeof selector !== "string") {
    throw new MarkrunError("SELECTOR", "A section selector must be a string.", document.filename);
  }
  const input = selector.trim().replace(/^@:\s*/, "");
  const match = /^(#{1,6})[ \t]+(.+)$/.exec(input);
  if (!match) {
    throw new MarkrunError("SELECTOR", `Invalid selector ${JSON.stringify(selector)}. Use @:# Heading or @:## Subheading.`, document.filename);
  }
  const level = match[1].length;
  const name = normalizeHeading(match[2]);
  const atLevel = document.sections.filter(section => section.level === level);
  const exact = atLevel.filter(section => section.title === name);
  const matches = exact.length ? exact : atLevel.filter(section => section.alias === name);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new MarkrunError("AMBIGUOUS", `Ambiguous selector ${JSON.stringify(selector)}; matches lines ${matches.map(s => s.line).join(", ")}. Use a unique full heading.`, document.filename);
  }
  const elsewhere = document.sections.filter(section => section.title === name || section.alias === name);
  const hint = elsewhere.length
    ? ` Heading depth matters. Did you mean ${elsewhere.map(s => JSON.stringify(`@:${s.label}`)).join(" or ")}?`
    : ` Available headings: ${document.sections.map(s => `@:${s.label}`).join(", ") || "(none)"}.`;
  throw new MarkrunError("NOT_FOUND", `No section matches ${JSON.stringify(selector)}.${hint}`, document.filename);
}

export function markdownOf(region: Region): string {
  return region.tokens.filter(token => !(token.kind === "code" && token.executable)).map(token => token.raw).join("\n").trim();
}
