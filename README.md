# Readrun

**A Markdown file that runs as a command.**

Readrun runs plain Markdown files whose ```` ```ts run ```` blocks are code. This README is one: read it here, or run it with `rr README.md`.

```ts run
// Everything before the first section marker is the entry: it runs when the file runs.
const [chapter] = Bun.argv.slice(2);
if (chapter) {
  $: text = chapter;
  console.log(text);
  process.exit(0);
}
```

A whole program, `greet.md`:

````markdown
<!-- Greets someone. Usage: rr greet.md NAME -->
```ts run
$: greeting = 'Greeting', { name: Bun.argv[2] ?? 'world' };
console.log(greeting);
```

<!--$: Greeting -->
# Hello, {{ name }}
````

`rr greet.md Ada` prints `# Hello, Ada`. The comment is a note and never prints, the code renders the `Greeting` section with a value, and GitHub shows the whole file as ordinary Markdown.

Run `rr README.md <chapter>` to read a chapter in your terminal:

- `install`: install the `readrun` command, or `rr` for short
- `examples`: the example files, from a first program to a Pokédex
- `rules`: the whole language on one table
- `output`: what a section prints, and in what order
- `values`: how sections get their data (runs a live example)
- `render`: rendering sections from code, `await`, and rendering in parallel
- `cli`: flags, stdin, stdout and exit codes
- `hooks`: Readrun as a Claude Code hook
- `structure`: section boundaries, scope, frontmatter and imports
- `cache`: the compilation cache
- `embedding`: using Readrun from TypeScript
- `about`: source layout, trust and references

<!--$: install -->
## Install

The command is `readrun`, and `rr` is a shorter name for it. Download it for macOS or Linux from the [latest release](https://github.com/pyronaur/readrun/releases/latest). It is one file that includes the Bun runtime and the TypeScript compiler, so nothing else is needed:

```sh
mkdir -p ~/.local/bin
curl -fsSL https://github.com/pyronaur/readrun/releases/latest/download/readrun-darwin-arm64.tar.gz | tar -xz -C ~/.local/bin
ln -s readrun ~/.local/bin/rr     # optional: skip it if you use Mozilla's rr debugger
rr --version
```

Replace `darwin-arm64` with `darwin-x64`, `linux-x64` or `linux-arm64` to match your machine, and make sure `~/.local/bin` is on your `PATH`.

With [Bun](https://bun.com) installed, `bun install -g github:pyronaur/readrun` installs `readrun` and `rr` too. It runs the TypeScript source with your Bun, so it starts a little slower than the release binary.

From a clone of this repository, `bun install` and then `just install` build `./dist/readrun`, copy it to `~/.local/bin/readrun` and link `rr` to it. Without installing, `bun src/cli.ts README.md` does the same as `rr README.md`.

```sh
rr file.md [arguments...]     # run the file
rr --check file.md            # syntax-check every block without running anything
rr --list file.md             # list section names
rr --version                  # print the Readrun version
bun test                      # run the tests
bun run check                 # type-check Readrun itself
```

<!--$: examples -->
## Examples

`examples/basics.md` is a first complete program:

````markdown
```ts run
const args = Bun.argv.slice(2);

if (args.length > 0) {
  $: md = 'Run', { arguments: args.join(' ') };
  console.log(md);
}

$: always = 'Always'
$: last = "Last Section";
console.log("There can be more than one", always);
console.log(last);
```
<!--$: Run -->
That's referenced inside the script
And it uses {{ arguments }}

```ts run
console.log("Only if arguments were passed");
```

<!--$: Always -->
We can have multiple md blocks like this

```ts run
console.log("In addition to more than one, there's more than 1 execution too");
```

This block has no `run`, so it's only shown:

```ts
console.log("I am printed as code, never executed");
```

<!--$: Last Section -->
## I mean, this renders nicely!
Because it's rendered with console.log in the first section
````

`rr examples/basics.md hello world` prints `Run` because arguments were passed, then `Always` and `Last Section`. `Always` is an ordinary section name, not a reserved hook.

The other examples each show one idea:

| File | Shows |
| --- | --- |
| `examples/greeting.md` | Values filling a template and appearing as variables in its code: `rr examples/greeting.md Ada` |
| `examples/await.md` | A section that awaits, and a `$: { }` block rendering two sections at the same time |
| `examples/hook.md` | A Claude Code hook that answers in JSON |
| `examples/pokedex.md` | Everything together: flags, stdin, `--help` and `--version` routes, a section that fetches, sections rendering sections, JSON output, stderr and exit codes |

The Pokédex needs internet access to reach [PokeAPI](https://pokeapi.co):

```sh
rr examples/pokedex.md pikachu bulbasaur
echo eevee | rr examples/pokedex.md --json | jq '.[0].types'
rr examples/pokedex.md --help
```

<!--$: rules -->
## Language rules

A Readrun file is plain Markdown. These are the only things that mean something extra:

| Construct | Meaning |
| --- | --- |
| A backtick fence labeled `ts run`, `typescript run`, `js run`, `javascript run`, or just `run` | Executable code. Every other fence is only shown. |
| Everything before the first marker | The entry. `rr file.md` runs it. |
| `<!--$: Name -->` on its own line, outside a fence | Starts a section named `Name`. It runs until the next marker. |
| `$: md = 'Name'` / `$: md = 'Name', { values }` | Render the section now and declare `const md`, a string with its output. |
| `$: { a = 'A'; b = 'B', { values }; }` | Render several sections at the same time, declaring `a` and `b`. |
| `{{ key }}` | Filled from the values passed where the section is rendered. Without a value, it is printed as written. |
| Any other full-line `<!-- … -->` comment, and frontmatter | Notes. Never executed, never printed. |
| `import { route } from 'readrun'` | `await route('Help', ['-h', '--help'])` prints a section and exits when a flag is passed. |

Markers are HTML comments, so GitHub and other Markdown viewers hide them. Running code is opt-in: a plain ```` ```ts ```` block is an example that is shown, never run, so any Markdown file is safe to open with `rr`. GitHub highlights ```` ```ts run ```` by its first word and never shows the `run`.

<!--$: output -->
## Output

Rendering a section goes top to bottom: its text, then whatever its code prints, then more text, in file order. The entry prints as it goes. A section rendered with `$:` collects the same output into the string that `$:` returns, and the caller decides where it goes.

~~~ts
<!--$: List -->
# {{ title }}

```ts run
for (const item of items) {
  $: line = 'Line', { item };
  console.log(line);          // lands right here, under the heading
}
```

Done
~~~

`console.log`, `console.info` and `console.debug` inside a section are part of its output. `console.error` and `console.warn` always go to stderr. Libraries that print through the global `console` write straight to stdout.

<!--$: values -->
## Values

A section is a template, and its values come only from the `$:` that renders it:

```ts
$: md = 'Greeting', { name: 'Ada' };   // {{ name }} is "Ada"
$: line = 'Line', item;                // item's keys become the section's names
```

Inside a section, passed values are `const` variables in its code and fill its placeholders. Nothing else does: a section's own variables never reach its text, and the entry gets no values at all. To trace a `{{ name }}`, find where the section is rendered.

- Values must be an object. Keys that aren't valid variable names (such as `first-name` or `arguments`) still fill placeholders but are not variables. A value may not reuse a name the section declares itself.
- `{{ user.name }}` follows own properties only. `0` and `false` render as text, `null` renders as nothing, and a placeholder without a value is printed as written.
- Placeholders are filled everywhere in the text, including inside backticks and code blocks.
- Values are not Markdown-escaped, and they are never executed.
- Every render runs the section again with fresh variables. Each section has its own scope, separate from its caller.

Code computes, and sections write. A render returns text, so compute the data a caller needs (counts, records, decisions) in code and pass it to sections as values. Keep text meant for people in sections rather than assembling Markdown in code. When a section works something out itself, it renders a smaller section with what it found.

A live example. On GitHub you see its code and the `Greeting` template below it; with `rr README.md values` you see the result:

```ts run
$: greeting = 'Greeting', { name: 'Ada', language: 'Readrun' };
console.log(greeting);
```

<!--$: Greeting -->
> Hello {{ name }}, this line was filled in by {{ language }}.

```ts run
// Passed values are also variables in the section's own code.
console.log(`> (${name.length} letters in "${name}")`);
```

<!--$: render -->
## Rendering from code, and await

`$:` is an ordinary JavaScript label, so the file stays valid TypeScript. Only statements labeled `$` render sections; strings, comments, templates and other labels are left alone. The name can be any expression, for example `$: md = name`.

Every region can `await`, including sections. A render waits for the section, so the compiler adds the `await` itself. A `$:` statement must sit directly in a block (`if (x) $: md = 'Run'` needs braces), because it becomes a `const` declaration, and inside a function that function must be `async`.

Each `$:` line waits for its section before the next line starts. To render several sections at the same time, put the lines in a `$: { }` block:

```ts
$: {
  a = 'Slow', { name: 'A' };
  b = 'Slow', { name: 'B' };
}
console.log(a, b);   // both ready here
```

- Only render lines go inside the block, and each one declares its name, as with single lines.
- The lines run at the same time, so none of them can use another's result. Use it after the block.
- Under the hood it is `const [a, b] = await Promise.all([render('Slow', …), render('Slow', …)])`.

<!--$: cli -->
## Flags, stdin and stdout

Use Bun's APIs directly. `rr` makes `Bun.argv` look like a normal run, so `Bun.argv.slice(2)` holds the user's arguments.

```ts
import { parseArgs } from 'util';
import { route } from 'readrun';

await route('Help', ['-h', '--help']);          // prints <!--$: Help --> and exits 0

const { values: flags, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: { title: { type: 'string', default: 'Report' } },
  allowPositionals: true,
});

// Optional input: read stdin only when no input arguments were given.
const piped = positionals.length === 0 && !process.stdin.isTTY ? (await Bun.stdin.text()).trim() : '';
```

- Stdin can be read once: `await Bun.stdin.text()`, `await Bun.stdin.json()` for one JSON value, or `Bun.JSONL.parse(await Bun.stdin.text())` for JSON Lines. `Bun.JSONL.parse` stops at the first invalid line and returns what it parsed so far.
- A read finishes when the caller closes stdin. In a terminal (`process.stdin.isTTY`) it waits for Ctrl-D. Programs such as Claude Code, Node and Bun pass a socket, and a caller that never closes it, like some agent shells, makes a read wait forever. So when input is optional, let the arguments decide, the way `cat` does, and treat an empty read as nothing piped. When testing such a tool from an agent's shell, pipe input in or add `< /dev/null`.
- A wrong flag makes `parseArgs` throw, which exits 1. For a friendlier error, catch it, `console.error` a rendered usage section, and `process.exit(2)`.
- `route(name, flags)` matches exact flags, combined short flags such as `-vh`, and ignores arguments after `--`. Put routes before `parseArgs` so a strict parser never sees them.
- Write errors to stderr with `console.error`, and set the exit code with `process.exit`.

<!--$: hooks -->
## Claude Code hooks

Hooks read JSON on stdin and answer with exit codes, stdout and stderr, so a Readrun file works as a [Claude Code hook](https://code.claude.com/docs/en/hooks) as is. Sections make good message templates:

~~~ts
<!-- PreToolUse hook: stop recursive deletes, and tell Claude why. -->
```ts run
const input = await Bun.stdin.json();
const command = input.tool_input?.command ?? '';

if (/\brm\s+-[a-z]*(r[a-z]*f|f[a-z]*r)/.test(command)) {
  $: reason = 'Denied', { command };
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}
```

<!--$: Denied -->
Blocked `{{ command }}`. Ask the user to run it, or delete specific files instead.
~~~

- For hooks that answer in JSON, keep the entry free of text and put notes in comments: stdout must be only the JSON object.
- For SessionStart and UserPromptSubmit hooks, plain stdout becomes context for Claude, so the file's own text is the context.
- A hook reads files next to itself through `__dirname`, for example `join(__dirname, 'protected.txt')`, since hooks run from the project's directory.
- Point the hook at the full path of `readrun`, for example `"$HOME/.local/bin/readrun" "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.md"`. Hooks may not see your shell's `PATH`.

<!--$: structure -->
## Structure

- A section runs from its marker to the next marker, or to the end of the file. The marker line itself is not rendered. Headings, `---` and other Markdown inside a section are plain content. Sections do not nest.
- All executable fences in one region share a lexical scope and run in document order. Fences must contain whole statements; a fence boundary ends a statement.
- `console`, `require`, `module`, `exports`, `__filename` and `__dirname` are provided in every region, as in CommonJS.
- Section names match exactly and case-sensitively, with whitespace normalized. Two markers with the same name are an error. An unknown name lists the available sections. Circular renders show their chain, and nesting stops at a depth of 64.
- A `---` block starting on the first line is frontmatter: never executed, never printed.
- Static imports load when their region runs. Dynamic imports resolve relative to the Markdown file. `import.meta.url`, `filename`, `dirname` and `resolve()` are supplied. `'readrun'` always refers to the running Readrun, like `'bun'` refers to Bun.
- This is not a complete CommonMark parser. Only section markers, fenced blocks with up to three leading spaces, full-line HTML comments and frontmatter have structure. Executable fences inside lists, blockquotes or HTML blocks are not supported. Unclosed fences and markers without a name are errors.

<!--$: cache -->
## Compilation cache

Compiled code is cached in `~/.cache/readrun/` (or `$XDG_CACHE_HOME/readrun/`), so a repeat run doesn't load the TypeScript compiler. Only `rr` reads or writes that folder, and nothing is written next to your files. Entries are keyed by the file's contents, the section, the passed value names and Readrun's own code generation, so edits and upgrades always compile fresh. Only successful compiles are stored, and a damaged entry is compiled again. Deleting the folder is always safe.

```sh
READRUN_CACHE=0 rr file.md              # no cache: always compile, read and write nothing
READRUN_CACHE_DIR=/tmp/rr rr file.md    # use a different folder
```

The compiled `rr` is built with Bun's `--bytecode`, so it starts in about 15 ms. A cached run of a small file takes about 20 ms, compared with about 50 ms when it has to compile.

<!--$: embedding -->
## Embedding

```ts
import { Readrun, runFile } from './src/index.ts';

const runtime = new Readrun(source, { filename: '/absolute/path/to/document.md', args: ['hello'] });

runtime.check();                                         // syntax only; no execution or type checking
await runtime.run();                                     // run the entry, printing as it goes
const text = await runtime.render('Run', { arguments: 'hello' });

await runFile('./examples/basics.md');                   // or read a file and run its entry
```

`runFile()` does not rewrite the host process's argument vector; the CLI makes `process.argv` and `Bun.argv` match a direct run. `route()` calls the `exit` option, which defaults to `process.exit`. Runtime failures name the section and the starting line of the running block, with the original exception kept as `cause`.

<!--$: about -->
## About

```text
src/parser.ts       Markdown structure, section markers, frontmatter and name resolution
src/compiler.ts     TypeScript AST rewriting and region compilation
src/cache.ts        Compilation cache
src/template.ts     Placeholder interpolation
src/runtime.ts      Rendering, route() and cycle detection
src/cli.ts          The readrun command: run, --check and --list
src/index.ts        Public API
examples/           Example programs, from basics.md to pokedex.md
test/               Core, CLI and example tests
```

**Only run Markdown files you trust.** Executable fences run with the same filesystem, network, process and environment access as `rr` itself. This is a language runtime, not a sandbox, and `rr README.md` runs this file's code too. Value substitution never becomes executable source, but that does not make an untrusted document safe to run.

`bun test` runs the core, CLI and example tests; `npm run test:node` runs the same suite under Node, skipping the tests that need Bun. Syntax rewriting uses the [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API); flags and stdin follow Bun's [argument](https://bun.com/guides/process/argv) and [stdin](https://bun.com/guides/process/stdin) guides.
