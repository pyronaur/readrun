# Command-line tools

Flags, stdin and stdout use plain Bun APIs. Readrun adds only `route()`.

## Arguments

`rr` makes `Bun.argv` look like a normal run, so `Bun.argv.slice(2)` holds the user's arguments.

```ts
import { parseArgs } from 'util';

const { values: flags, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    title: { type: 'string', default: 'Report' },
    json: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});
```

A wrong flag makes `parseArgs` throw, which exits 1 with its message. For friendlier errors, catch it and print a usage section to stderr with your own exit code:

```ts
try {
  // parseArgs(...) and your own checks
} catch (error) {
  $: usage = 'Usage';
  console.error(`${(error as Error).message}\n\n${usage}`);
  process.exit(2);
}
```

## Help and version

```ts
import { route } from 'readrun';

await route('Help', ['-h', '--help']);
await route('Version', ['-v', '--version']);
```

When one of the flags is passed, `route` prints that section and exits 0. It matches combined short flags like `-vh` and ignores arguments after `--`. Call it before `parseArgs`, so a strict parser never sees those flags. `route` is the only export of `'readrun'`.

## Stdin

Stdin can be read once:

```ts
const text = await Bun.stdin.text();
const data = await Bun.stdin.json();                  // one JSON value
const rows = Bun.JSONL.parse(await Bun.stdin.text()); // JSON Lines
```

A read finishes when the caller closes stdin. What stdin is depends on the caller: a pipe from a shell, a file or `/dev/null` from a redirect, a socket from programs such as Claude Code (for hooks), Node or Bun. A caller that never closes its stdin, like some agent shells, makes a read wait forever, and nothing about stdin tells you so in advance.

So when input is optional, let the arguments decide, the way `cat` does: read stdin only when no input arguments were given (or the user passes `-`), and skip it in an interactive terminal. An empty read means nothing was piped.

```ts
const piped = positionals.length === 0 && !process.stdin.isTTY ? (await Bun.stdin.text()).trim() : '';
```

When piped input should win over an argument, `fstatSync(0).isFIFO()` (from `'node:fs'`) spots a shell pipe. Use it only as an extra signal: programs pass their input through sockets, which it doesn't detect.

When you run a stdin-reading tool from an agent's shell, give it input explicitly: pipe something in, or add `< /dev/null`.

`Bun.JSONL.parse` stops at the first invalid line and returns what it parsed so far.

## Output and exit codes

- Data goes to stdout with `console.log`, so the output pipes cleanly. Keep the entry free of text when stdout carries data such as JSON.
- Messages for the user go to stderr: `console.error(section)`.
- Set the exit code with `process.exit(code)` from the entry. Inside a section, `process.exit` ends the program before that section's collected output reaches anyone.

`examples/pokedex.md` in the Readrun repo is a complete tool using all of this.
