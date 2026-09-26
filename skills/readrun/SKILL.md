---
name: readrun
description: Readrun (`readrun`, or `rr` for short) runs Markdown files as commands. Use it to write, run, fix or explain a Markdown workflow file, a Claude Code hook written in Markdown, or prompt templates rendered from a Markdown file.
disable-model-invocation: true
---

# Readrun

A Readrun file is a plain Markdown file that runs as a command: `rr file.md [args...]`. Code runs only in fences marked `run`; everything else is Markdown the file prints or keeps as templates. The file stays readable anywhere Markdown renders.

## The file

A file has an **entry** and **sections**:

1. The **entry** is everything before the first marker. `rr file.md` runs it top to bottom and prints as it goes: its text, and whatever its code prints, in file order.
2. A **section** starts at `<!--$: Name -->` on its own line and runs until the next marker. A section is a **template**: it does nothing until code renders it.

Code runs in backtick fences labeled `ts run`, `typescript run`, `js run`, `javascript run`, or just `run`. Every other block is displayed, including plain ```` ```ts ````, which is how to show example code.

HTML comments and frontmatter are notes: never printed, never run. Put a file's usage notes in a top comment, because entry text is output.

````markdown
<!-- Greets someone. Usage: rr greet.md NAME -->
```ts run
$: greeting = 'Greeting', { name: Bun.argv[2] ?? 'world' };
console.log(greeting);
```

<!--$: Greeting -->
# Hello, {{ name }}
````

## Rendering sections

`$: md = 'Name', { values }` renders a section and declares `const md`, a string holding the section's output: its text, plus what its code printed, in file order. Nothing prints until the caller prints `md`.

- **Values** are the section's only input. They fill `{{ key }}` placeholders everywhere in its text, backticks and code blocks included, and they are `const` variables in its code. A placeholder without a value is printed as written.
- A section has its own scope. It sees its values, never the caller's variables. Pass what it needs.
- `$: line = 'Line', item` passes an object's keys as values. Each render runs the section fresh.
- Every block can `await`. A `$:` render waits for its section. Inside a function, the function is `async`.
- `$: { a = 'A', {...}; b = 'B', {...}; }` renders several sections at the same time. Its lines are independent: use their results after the block.

`$:` is a JavaScript label the compiler rewrites, so the file stays valid TypeScript.

## Data in code, text in sections

Code computes; sections write. A render returns text, so compute the data a caller needs (counts, records, decisions) in code, in the entry or in a `.ts` module, and pass the results to sections as values.

Output meant for people lives in section text with placeholders, rather than Markdown assembled in code. When a section works something out itself, it renders a smaller section with what it found:

````markdown
<!--$: Note -->
```ts run
import { stat } from 'node:fs/promises';
const updated = (await stat(path)).mtime.toISOString().slice(0, 10);
$: line = 'Note line', { title, updated };
console.log(line);
```

<!--$: Note line -->
- **{{ title }}**, updated {{ updated }}
````

## Running and checking

```sh
rr file.md [args...]     # run the entry
rr --check file.md       # compile every block without running anything; exits 1 on a syntax error
rr --list file.md        # section names and their lines
rr --version             # the installed Readrun version
```

Errors print as `[CODE] file:line: message` and exit 1. An unknown section name lists the sections that exist.

## Reference

Read the one that matches the task:

1. Command-line tool (flags, stdin, stdout, `--help`, exit codes): `./references/cli.md`
2. Claude Code hook: `./references/hooks.md`
3. Prompt templates rendered for an agent: `./references/prompts.md`
4. Exact rules (placeholder formatting, name clashes, parallel blocks, imports and packages, errors, file structure, cache): `./references/rules.md`

Readrun's own [README](https://github.com/pyronaur/readrun#readme) is a runnable manual: in a clone of the repository, `rr README.md` lists its chapters and `rr README.md <chapter>` prints one.
