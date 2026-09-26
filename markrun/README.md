# Markrun

**A Markdown file that runs as a command.**

Markrun is a small executable-Markdown language for terminal workflows. A `.mr` file is Markdown with TypeScript/JavaScript fences. `mr file.mr` runs the top of the file, the *entry*, and prints its text and output in order. Sections marked with `<!--$: Name -->` are templates: the entry renders one with `$: md = 'Name', { values }` and decides what to do with the result.

Flags, stdin and stdout use plain Bun and Node APIs. Markrun adds only the section markers, `$:` pulls and a `route()` helper.

This is a local 0.1 prototype, not a published npm package. See [TESTING.md](TESTING.md) for what has been verified.

## Run it

With Bun installed, run these commands from this directory:

```sh
bun install
bun run example.mr hello world
bun run example.mr
```

The included `bunfig.toml` registers the `.mr` loader before the entrypoint is loaded. A bare Bun installation does not gain Markrun syntax until this project-local configuration is present.

```toml
preload = ["./src/register.js"]

[loader]
".mr" = "ts"
```

The explicit runner avoids depending on custom entrypoint loading:

```sh
bun src/cli.ts example.mr hello world
bun src/cli.ts --check example.mr
bun src/cli.ts --list example.mr
bun run examples/parameters.mr Ada
bun run examples/async-entry.mr
bun src/cli.ts kitchen-sink.mr --help
bun test
bun run check
```

### Compiled executable

`just install` builds the explicit runner and copies the binary to `~/.local/bin/mr`.
The binary includes the Bun runtime and the TypeScript compiler.
It executes a document from any working directory.

```sh
just install
mr document.mr hello world
```

To add Markrun to another local project, copy `src/`, install the `typescript` dependency from `package.json`, and add the preload and loader settings to that project's `bunfig.toml`. Adjust the preload path when the files live elsewhere.

## A complete program

````markdown
```ts
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

```ts
console.log("Only if arguments were passed");
```

<!--$: Always -->
We can have multiple md blocks like this

```ts
console.log("In addition to more than one, there's more than 1 execution too");
```

<!--$: Last Section -->
## I mean, this renders nicely!
Because it's rendered with console.log in the first section
````

The supplied `example.mr` closes the fence in `Run` with four backticks; a closing fence may be longer than its opener. `Always` is an ordinary section name, not a reserved lifecycle hook.

`kitchen-sink.mr` is a small Pokédex using every feature: flags, names from arguments or stdin, `--help` and `--version` routes, a section that awaits a `fetch`, sections rendering sections, JSON output, and stderr with exit codes. It needs internet access to reach [PokeAPI](https://pokeapi.co).

```sh
mr kitchen-sink.mr pikachu bulbasaur
echo eevee | mr kitchen-sink.mr --json | jq '.[0].types'
mr kitchen-sink.mr --help
```

## Language rules

| Construct | Meaning |
| --- | --- |
| Backtick fence with `ts`, `typescript`, `js`, `javascript`, or no label | Executable code. |
| Everything before the first marker | The entry. `mr file.mr` runs it. |
| `<!--$: Name -->` on its own line, outside a fence | Starts a section named `Name`. It runs until the next marker. |
| `$: md = 'Name'` / `$: md = 'Name', { values }` | Render the section now and declare `const md`, a string with its output. |
| `{{ key }}` | Filled from the values passed at the pull. A missing value is an error. |
| Any other full-line `<!-- … -->` comment | A note. Never executed, never printed. |
| `import { route } from 'markrun'` | `await route('Help', ['-h', '--help'])` prints a section and exits when a flag is passed. |

### Rendering

Rendering a section goes top to bottom: its text, then whatever its code prints, then more text, in file order. The entry prints as it goes. A pulled section collects the same output into the string that `$:` returns, and the caller decides where it goes.

````markdown
<!--$: List -->
# {{ title }}

```ts
for (const item of items) {
  $: line = 'Line', { item };
  console.log(line);          // lands right here, under the heading
}
```

Done
````

`console.log`, `console.info` and `console.debug` inside a section are part of its output. `console.error` and `console.warn` always go to stderr. Libraries that print through the global `console` write straight to stdout.

### Values

A section is a template, and its values come only from the pull that renders it:

```ts
$: md = 'Greeting', { name: 'Ada' };   // {{ name }} is "Ada"
$: line = 'Line', item;                // item's keys become the section's names
```

Inside the section, passed values are `const` variables in its code and fill its placeholders. Nothing else does: a section's own variables never reach its text, and the entry gets no values at all. To trace a `{{ name }}`, find the pull.

Values must be an object. Keys that aren't valid variable names (such as `first-name` or `arguments`) still fill placeholders but are not variables. A value may not reuse a name the section declares itself.

`{{ user.name }}` follows own properties only. `0` and `false` render as text, `null` renders as nothing, and `undefined` or a missing value is an error naming the section and the placeholder. Values are not Markdown-escaped, and they are never executed.

Every pull runs the section again with fresh variables. Each section has its own scope, separate from its caller.

### Pulls and await

`$:` is an ordinary JavaScript label, so the file stays valid TypeScript. Only statements labeled `$` are pulls; strings, comments, templates and other labels are left alone. The name can be any expression, for example `$: md = name`.

Every region can `await`, including sections. A pull waits for the section, so the compiler adds the `await` itself. A pull must sit directly in a block (`if (x) $: md = 'Run'` needs braces), because it becomes a `const` declaration, and inside a function that function must be `async`.

### Flags, stdin and stdout

Use Bun's APIs directly. `mr` makes `Bun.argv` look like a normal run, so `Bun.argv.slice(2)` holds the user's arguments.

```ts
import { parseArgs } from 'util';
import { route } from 'markrun';

await route('Help', ['-h', '--help']);          // prints <!--$: Help --> and exits 0

const { values: flags, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: { title: { type: 'string', default: 'Report' } },
  allowPositionals: true,
});

const text = process.stdin.isTTY ? undefined : await Bun.stdin.text();
const data = await Bun.stdin.json();            // one JSON value
const rows = Bun.JSONL.parse(await Bun.stdin.text());
```

`process.stdin.isTTY` is true when nothing is piped. Without the check, reading stdin in a terminal waits for Ctrl-D, like `cat`. `Bun.JSONL.parse` stops at the first invalid line and returns what it parsed so far.

`route(name, flags)` matches exact flags, combined short flags such as `-vh`, and ignores arguments after `--`. Put routes before `parseArgs` so a strict parser never sees them.

### Section boundaries and scope

A section runs from its marker to the next marker, or to the end of the file. The marker line itself is not rendered. Headings, `---` and other Markdown inside a section are plain content. Sections do not nest.

All executable fences in one region share a lexical scope and execute in document order. Fences must contain statement sequences. Fence boundaries insert a statement separator; they are not a mechanism for splitting a string, expression, or other token across blocks.

`console`, `require`, `module`, `exports`, `__filename` and `__dirname` are provided in every region, as in CommonJS.

### Section lookup

Names are matched exactly and case-sensitively, with whitespace normalized. Two markers with the same name are an error when the file is parsed. An unknown name lists the available sections. Circular pulls show their section chain, and nesting has a default depth limit of 64.

### Imports

Static imports are lowered to region-local `require` calls, and are loaded when that region executes. Dynamic imports resolve relative to the `.mr` file. Bare dynamic package names currently use `require.resolve`, so packages exposing only an `import` export condition are outside this prototype's resolver support. Use explicit file URLs for those modules. `import.meta.url`, `filename`, `dirname`, and `resolve()` are supplied by the interpreter; `main` is currently always true inside interpreted regions. `'markrun'` always refers to the running Markrun, like `'bun'` refers to Bun.

### Markdown subset

This is intentionally not a complete CommonMark parser. Structural syntax is limited to section markers, fenced blocks with up to three leading spaces, and full-line HTML comments. Everything else, including headings and `---`, is plain Markdown.

Inline Markdown code spans remain prose. Tilde fences, other language labels, and annotated labels such as `ts noexec` remain display-only and are printed. Nesting executable fences inside blockquotes, lists, or arbitrary HTML blocks is not supported. Use top-level fences. Unclosed fences and markers without a name are errors.

## Embedding

```ts
import { Markrun, runFile } from './src/index.ts';

const runtime = new Markrun(source, {
  filename: '/absolute/path/to/document.mr',
  args: ['hello'],
});

runtime.check();                                         // Syntax only; no execution or type checking.
await runtime.run();                                     // Run the entry, printing as it goes.
const text = await runtime.pull('Run', { arguments: 'hello' });

// Or read a real file and run its entry:
await runFile('./example.mr');
```

`runFile()` does not rewrite the host process's global argument vector. The explicit CLI normalizes `process.argv` and `Bun.argv` to match a direct file invocation. `route()` calls the `exit` option, which defaults to `process.exit`.

`check()` compiles every region, including unused sections. During normal execution, section code is compiled lazily when pulled. Markdown structure is always parsed eagerly. Runtime failures name the section and the starting line of the executing code block, with the original exception retained as `cause`; these are block locations, not statement-level source maps.

## Source layout

```text
src/parser.ts       Markdown structure, section markers and name resolution
src/compiler.ts     TypeScript AST rewriting and region compilation
src/markdown.ts     Placeholder interpolation
src/runtime.ts      Rendering, pulls, route() and cycle detection
src/register.js     Bun's native .mr module loader
src/cli.ts          Explicit runner, --check and --list
src/index.ts        Public API
example.mr          The complete example program
kitchen-sink.mr     A Pokédex workflow using every feature
examples/           Parameters and asynchronous-entry examples
test/               Core, CLI and native-Bun smoke tests
```

## Trust boundary

**Only execute `.mr` files you trust.** Executable fences run with the same filesystem, network, process, and environment access as the hosting Bun process. This is a language runtime, not a sandbox. Syntax checking does not prove a file safe. Value substitution never becomes executable source, but that does not make an untrusted document safe to run.

## Implementation references

The adapter uses Bun's documented [preload and loader configuration](https://bun.com/docs/runtime/bunfig) and [plugin onLoad API](https://bun.com/docs/runtime/plugins). Argument handling follows [Bun's argument-vector guide](https://bun.com/guides/process/argv). Syntax rewriting uses the [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).
