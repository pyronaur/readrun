# Markrun

**Pull a section. Run its code. Render its Markdown.**

Markrun is a small executable-Markdown language. A `.mr` file is evaluated top to bottom, stopping at the first section marker such as `<!--$: Run -->`. Sections after that point are available on demand. Inside executable code, a statement such as `$: md = 'Run'` pulls the matching section and stores its `Markdown` value in `md`.

This is a local 0.1 prototype, not a published npm package. The interpreter and CLI have been tested under Node; the native Bun loader is included but could not be exercised in the build environment. See [TESTING.md](TESTING.md) for the exact verification boundary.

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
  $: md = `Run`;
  md.set('arguments', args.join(' '));
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

The supplied `example.mr` closes the fence in `Run` with four backticks; a closing fence may be longer than its opener.

`Always` is an ordinary section name, not a reserved lifecycle hook. Headings such as `## I mean, this renders nicely!` are plain Markdown; only markers define sections.

## Language rules

| Construct | Meaning |
| --- | --- |
| Backtick fence with `ts`, `typescript`, `js`, `javascript`, or no label | Execute its body as TypeScript/JavaScript. |
| `<!--$: Run -->` on its own line, outside a fence | Start a section named `Run`. It ends at the next marker. The first marker also ends the entry program. |
| `$: md = 'Run'` inside executable code | Immediately execute the `Run` section, then declare `const md` holding its Markdown. |
| `md.set('key', value)` | Set a value on that particular Markdown object; chainable. |
| `{{ key }}` | Substitute a value when the Markdown is rendered. This is data, not evaluated code. |
| `console.log(md)` / `String(md)` / `md.render()` | Render Markdown with executable fences removed. Do not rerun those fences. |

`$:` is an ordinary JavaScript label, so the file stays valid TypeScript. Only statements labeled `$` are pulls; strings, comments, templates and other labels are left alone. The right-hand side can be any expression:

```ts
const name = 'Run';
$: md = name;
```

A pull must assign to a plain name, and it must sit directly in a block (`if (x) $: md = 'Run'` needs braces), because it becomes a `const` declaration. Other HTML comments, such as `<!-- TODO -->`, are ordinary prose. Marker spacing is flexible: `<!--$:Run-->` and `<!-- $: Run -->` are the same marker.

The compiler rewrites actual TypeScript syntax-tree nodes, not arbitrary source text. No `String.prototype` patching is involved.

### Execution versus rendering

A pull is **eager**; interpolation is **lazy**:

```ts
$: md = 'Run';                     // Runs Run's code now.
md.set('arguments', 'hello');      // Changes its eventual text, not executed source.
console.log(md);                   // Renders it; no second execution.
md.set('arguments', 'goodbye');
console.log(md);                   // New text; still no second execution.

$: another = 'Run';                // A new pull: Run's code executes again.
```

Merely indexing a section does not execute its code. A reference inside a false branch is never pulled. Printing the same object multiple times does not repeat side effects. Compiled programs are cached, but section executions and parameter values are not shared between pulls.

Prose is not automatically printed during entry execution. `console.log` controls output. Rendering returns plain Markdown text, not ANSI styling, HTML, or a browser preview. A section's `console.log` output is emitted as a side effect; it is not captured into its Markdown body.

### Section boundaries and scope

A section runs from its marker to the next marker, or to the end of the file. The marker line itself is not rendered. Headings, `---` and other Markdown inside a section are plain content. Sections do not nest.

All executable fences in one region share a lexical scope and execute in document order. A selected section has a fresh scope, separate from the caller. Pass values explicitly rather than assuming it can see variables in the entry program.

Fences must contain statement sequences. Fence boundaries insert a statement separator; they are not a mechanism for splitting a string, expression, or other token across blocks.

### Passing data before section execution

`.set()` after a literal pull affects rendering only: the section's code has already run. Use the explicit API when its code needs parameters:

```ts
const md = markrun.pull('Greeting', { name: 'Ada' });
console.log(md);
```

The selected section receives its own Markdown object as `section`:

````markdown
<!--$: Greeting -->
# Hello, {{ name }}
{{ message }}

```ts
section.set('message', `Welcome, ${section.get('name')}!`);
```
````

`markrun` is the current document runtime. `markrun.args` is a read-only copy of user arguments. `section` refers to the current region's Markdown value. These names, plus the usual injected `console`, `require`, `module`, `exports`, `__filename`, and `__dirname`, are reserved at region scope.

### Variables

`.set()` accepts a name/value pair or an object:

```ts
md.set('arguments', 'one two');
md.set({ count: 0, enabled: false, user: { name: 'Ada' } });
```

`{{ user.name }}` follows own properties only. Literal dotted keys take precedence. `0` and `false` are preserved, `null` becomes empty text, and missing or `undefined` values leave their placeholders visible. Set `strictVariables: true` in the programmatic API to reject missing values during rendering. Prototype-access keys are rejected. Values are not Markdown-escaped: supplying Markdown as a value intentionally renders that Markdown.

### Section lookup

Names are matched exactly and case-sensitively, with whitespace normalized. Two markers with the same name are an error when the file is parsed. An unknown name lists the available sections. Circular pulls show their section chain, and nesting has a default depth limit of 64.

### Await and imports

The entry program supports top-level `await`, including across successive fences:

```ts
const { basename } = await import('node:path');
await Promise.resolve();
console.log(basename(import.meta.filename));
```

Section pulls remain synchronous so they can be used in ordinary functions and callbacks. A selected section containing top-level `await` is rejected before execution. Do asynchronous work in the entry, then pass its results into the section. Async functions and promises otherwise retain normal JavaScript behavior; Markrun does not automatically await background work you start without awaiting it.

Static imports are lowered to region-local `require` calls, and are loaded when that region executes. Dynamic imports resolve relative to the `.mr` file. Bare dynamic package names currently use `require.resolve`, so packages exposing only an `import` export condition are outside this prototype's resolver support. Use explicit file URLs for those modules. `import.meta.url`, `filename`, `dirname`, and `resolve()` are supplied by the interpreter; `main` is currently always true inside interpreted regions, not a full emulation of module-entry detection.

### Markdown subset

This is intentionally not a complete CommonMark parser. Structural syntax is limited to section markers, fenced blocks with up to three leading spaces, and full-line HTML comments. Everything else, including headings and `---`, is plain Markdown.

Inline Markdown code spans remain prose. Tilde fences, other language labels, and annotated labels such as `ts noexec` remain display-only. Nesting executable fences inside blockquotes, lists, or arbitrary HTML blocks is not supported. Use top-level fences. Unclosed fences and markers without a name are errors.

## Embedding

```ts
import { Markrun, runFile } from './src/index.ts';

const runtime = new Markrun(source, {
  filename: '/absolute/path/to/document.mr',
  args: ['hello'],
  strictVariables: true,
});

runtime.check();                         // Syntax only; no execution or type checking.
await runtime.run();                     // Execute the entry once.
const md = runtime.pull('Run', { arguments: 'hello' });
console.log(md.render());

// Or read a real file and execute its entry:
await runFile('./example.mr');
```

`runFile()` does not rewrite the host process's global argument vector; embedded programs should use `markrun.args` with the `args` option. The explicit CLI normalizes `process.argv` and `Bun.argv` to match a direct file invocation.

`check()` compiles every region, including unused sections. During normal execution, section code is compiled lazily when pulled. Markdown structure is always parsed eagerly. Runtime failures name the section and the starting line of the executing code block, with the original exception retained as `cause`; these are block locations, not statement-level source maps.

## Source layout

```text
src/parser.ts       Markdown structure, section markers and name resolution
src/compiler.ts     TypeScript AST rewriting and region compilation
src/markdown.ts     Parameter storage, interpolation and inspection
src/runtime.ts      Ordered execution, fresh pulls and cycle detection
src/register.js     Bun's native .mr module loader
src/cli.ts          Explicit runner, --check and --list
src/index.ts        Public API
example.mr          The complete example program
examples/           Parameters and asynchronous-entry examples
test/               Core, CLI and native-Bun smoke tests
```

## Trust boundary

**Only execute `.mr` files you trust.** Executable fences run with the same filesystem, network, process, and environment access as the hosting Bun process. This is a language runtime, not a sandbox. Syntax checking does not prove a file safe. Placeholder substitution never becomes executable source, but that does not make an untrusted document safe to run.

## Implementation references

The adapter uses Bun's documented [preload and loader configuration](https://bun.com/docs/runtime/bunfig) and [plugin onLoad API](https://bun.com/docs/runtime/plugins). Argument handling follows [Bun's argument-vector guide](https://bun.com/guides/process/argv). Syntax rewriting uses the [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).
