import { MarkrunError } from "./errors.ts";

export interface Token {
  kind: "text" | "comment" | "frontmatter" | "marker" | "code";
  raw: string;
  line: number;
  endLine: number;
  code?: string;
  executable?: boolean;
  name?: string;
}

/** Printable text between executable fences. Comments are never part of it. */
export interface Chunk {
  line: number;
  text: string;
}

export interface Region {
  id: string;
  name: string;
  line: number;
  tokens: Token[];
  chunks: Chunk[];
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
export function parse(source: string, filename = "document.md"): ParsedDocument {
  source = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const tokens: Token[] = [];
  let inComment = false;

  // A `---` block on the first line is frontmatter: information about the file, never printed.
  const frontmatterEnd = /^---[ \t]*$/.test(lines[0] ?? "") ? lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line)) : -1;
  for (let i = 0; i <= frontmatterEnd; i++) tokens.push({ kind: "frontmatter", raw: lines[i], line: i + 1, endLine: i + 1 });

  for (let i = frontmatterEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    const start = i;
    const marker = inComment ? null : /^ {0,3}<!--\s*\$:(.*?)-->[ \t]*$/.exec(line);
    if (marker) {
      const name = normalizeName(marker[1]);
      if (!name) throw new MarkrunError("MARKER", "Section markers need a name: <!--$: Name -->.", filename, i + 1);
      tokens.push({ kind: "marker", raw: line, line: i + 1, endLine: i + 1, name });
      continue;
    }
    // Any other full-line HTML comment is a note: never executed, never printed.
    if (inComment || /^ {0,3}<!--/.test(line)) {
      inComment = !line.includes("-->");
      tokens.push({ kind: "comment", raw: line, line: i + 1, endLine: i + 1 });
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
    const selected = tokens.slice(index + 1, markers[n + 1] ?? tokens.length);
    return { id: `section:${token.line}`, name: token.name!, line: token.line, tokens: selected, chunks: chunksOf(selected) };
  });
  const seen = new Map<string, Region>();
  for (const section of sections) {
    const previous = seen.get(section.name);
    if (previous) {
      throw new MarkrunError("DUPLICATE", `Section ${JSON.stringify(section.name)} is already defined on line ${previous.line}.`, filename, section.line);
    }
    seen.set(section.name, section);
  }

  const entryTokens = tokens.slice(0, markers[0] ?? tokens.length);
  return {
    source, filename, lineCount: lines.length, tokens, sections,
    entry: { id: "entry", name: "<entry>", line: 1, tokens: entryTokens, chunks: chunksOf(entryTokens) },
  };
}

/** Group text between executable fences. A region's text is trimmed at its start and end. */
function chunksOf(tokens: Token[]): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Token[] = [];
  const flush = () => {
    const text = current.map(token => token.raw).join("\n");
    if (text.trim()) chunks.push({ line: current[0].line, text });
    current = [];
  };
  for (const token of tokens) {
    if (token.kind === "comment" || token.kind === "frontmatter") continue;
    if (token.kind === "code" && token.executable) flush();
    else current.push(token);
  }
  flush();
  if (chunks.length) {
    const leading = /^(?:[ \t]*\n)+/.exec(chunks[0].text)?.[0] ?? "";
    chunks[0].line += leading.split("\n").length - 1;
    chunks[0].text = chunks[0].text.slice(leading.length);
    chunks[chunks.length - 1].text = chunks[chunks.length - 1].text.replace(/(?:\n[ \t]*)+$/, "");
  }
  return chunks;
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
