# Exact rules

## Contents
1. Placeholders
2. Values and names
3. `$:` renders
4. Output shape
5. Errors
6. Imports and packages
7. File structure
8. Cache

## 1. Placeholders

- `{{ name }}` and `{{name}}` are the same.
- `{{ user.name }}` follows own properties. Array indexes work: `{{ items.1 }}`.
- Values render with `String(value)`: `0` and `false` as text, arrays as `1,2`, objects as `[object Object]`. Format lists and objects into a string before passing them.
- `null` renders as nothing. `undefined` or a missing value leaves the placeholder as written, so a typo in a name shows up in the output.
- Placeholders apply to a section's text, never to its `run` code.
- Values are inserted as data: never escaped, never executed.

## 2. Values and names

- Values must be an object, or the render fails with `VALUE`.
- Keys that are valid variable names become `const` variables in the section's code. Other keys (`first-name`, `arguments`) only fill placeholders.
- A value may not share a name with something the section declares at its top level (a `const`, function, class, import, or `$:` name). That fails with `VALUE`; rename one of them.
- The entry receives no values.

## 3. `$:` renders

- Forms: `$: x = 'Name'`, `$: x = 'Name', { values }`, `$: x = 'Name', obj`. The name can be any expression, such as a variable or template string.
- A `$:` line sits directly in a block, and becomes a `const`. After an `if`, use braces: `if (ok) { $: x = 'Name'; }`.
- Inside a function, that function is `async`.
- In a `$: { }` block, every line is a render (`a = 'Name', {...};`), each name appears once, and no line uses another's result. The first failing render fails the whole block.
- Sections can render other sections. Circular renders fail with `CYCLE`; depth stops at 64.

## 4. Output shape

- A rendered string is trimmed at both ends.
- Blank lines between blocks print nothing extra, so a code-only entry prints only what its code prints.
- Inside a section, `console.log`, `console.info` and `console.debug` go into its output. `console.error` and `console.warn` go to stderr. Libraries printing through the global `console` write straight to stdout.
- Displayed (non-`run`) fences print with their fence lines, as raw Markdown.

## 5. Errors

- Format: `[CODE] file:line: message`, then the original error. Exit code 1.
- Codes: `SYNTAX`, `EXECUTION` (a thrown error), `RENDER` (a malformed `$:`), `NOT_FOUND` (lists available sections), `VALUE`, `CYCLE`, `DUPLICATE` (two markers with one name), `MARKER` (a marker without a name), `FENCE` (an unclosed fence), `FILE` (the file can't be read).
- Mistakes in calling `rr` itself (an unknown option before the file, no file) print usage and exit 2.
- `rr --check` compiles every region without running it, so it catches `SYNTAX`, `RENDER`, `FENCE`, `DUPLICATE` and `MARKER`. Value and runtime problems appear only when running.
- `process.exit(code)` inside a section ends the program immediately; the section's collected output is lost.

## 6. Imports and packages

- Static and dynamic imports resolve relative to the Markdown file. Packages resolve from `node_modules` next to the file or above it.
- Each region imports what it uses; a section doesn't see the entry's imports.
- `'readrun'` exports only `route`. `'bun'` and Node built-ins such as `'util'` are available.
- `rr` includes the Bun runtime. Other Markdown files can't be imported; share code through `.ts` modules.
- `require`, `module`, `exports`, `__filename`, `__dirname` and `import.meta.filename` are available in every region.

## 7. File structure

- A marker is `<!--$: Name -->` on its own line, outside a fence. Names match exactly and case-sensitively, with whitespace normalized; spaces and Unicode are fine.
- Sections don't nest. Headings and `---` inside a section are content.
- All `run` fences in one region share one scope and run in order. Each fence holds whole statements.
- Code runs only in backtick fences whose label is exactly `<language> run` or `run`: `~~~ts run`, `sh run` and `ts run now` are displayed.
- Executable fences inside lists, blockquotes or HTML blocks are displayed.
- A `#!` first line is printed like any text.

## 8. Cache

Compiled code is cached in `~/.cache/readrun/`, keyed by the file's contents, so edits always compile fresh. `READRUN_CACHE=0` turns it off; `READRUN_CACHE_DIR` moves it. Deleting the folder is safe.
