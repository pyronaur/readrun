import { MarkrunError } from "./errors.ts";

export interface Token {
  kind: "text" | "marker" | "code";
  raw: string;
  line: number;
  endLine: number;
  code?: string;
  executable?: boolean;
  name?: string;
}

export interface Region {
  id: string;
  name: string;
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
export const normalizeName = (value: string): string => value.trim().replace(/\s+/g, " ");

/** A deliberate Markdown subset: `<!--$: Name -->` section markers and top-level fenced blocks. */
export function parse(source: string, filename = "document.mr"): ParsedDocument {
  source = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const tokens: Token[] = [];
  let inComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = i;
    const marker = inComment ? null : /^ {0,3}<!--\s*\$:(.*?)-->[ \t]*$/.exec(line);
    if (marker) {
      const name = normalizeName(marker[1]);
      if (!name) throw new MarkrunError("MARKER", "Section markers need a name: <!--$: Name -->.", filename, i + 1);
      tokens.push({ kind: "marker", raw: line, line: i + 1, endLine: i + 1, name });
      continue;
    }
    // Any other full-line HTML comment is prose, never an executable container.
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
    } else {
      tokens.push({ kind: "text", raw: line, line: i + 1, endLine: i + 1 });
    }
  }

  // The entry runs up to the first marker; each section runs from its marker to the next.
  const markers = tokens.flatMap((token, index) => token.kind === "marker" ? [index] : []);
  const sections: Region[] = markers.map((index, n) => {
    const token = tokens[index];
    return { id: `section:${token.line}`, name: token.name!, line: token.line, tokens: tokens.slice(index + 1, markers[n + 1] ?? tokens.length) };
  });
  const seen = new Map<string, Region>();
  for (const section of sections) {
    const previous = seen.get(section.name);
    if (previous) {
      throw new MarkrunError("DUPLICATE", `Section ${JSON.stringify(section.name)} is already defined on line ${previous.line}.`, filename, section.line);
    }
    seen.set(section.name, section);
  }

  return {
    source, filename, lineCount: lines.length, tokens, sections,
    entry: { id: "entry", name: "<entry>", line: 1, tokens: tokens.slice(0, markers[0] ?? tokens.length) },
  };
}

/** Names are exact and case-sensitive, with whitespace normalized. */
export function resolveSection(document: ParsedDocument, name: string): Region {
  if (typeof name !== "string" || !normalizeName(name)) {
    throw new MarkrunError("SELECTOR", "A section name must be a nonempty string.", document.filename);
  }
  const section = document.sections.find(item => item.name === normalizeName(name));
  if (section) return section;
  const available = document.sections.map(item => JSON.stringify(item.name)).join(", ") || "(none)";
  throw new MarkrunError("NOT_FOUND", `No section named ${JSON.stringify(name)}. Available sections: ${available}.`, document.filename);
}

export function markdownOf(region: Region): string {
  return region.tokens.filter(token => !(token.kind === "code" && token.executable)).map(token => token.raw).join("\n").trim();
}
