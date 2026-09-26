# Verification report

Recorded on September 26, 2026.

## Executed checks

| Check | Result |
| --- | --- |
| TypeScript source type-check: `tsc --noEmit` | Passed |
| Core-language tests, including frontmatter, literal code and the compilation cache | 65 passed |
| CLI subprocess tests, including running every `README.md` chapter | 7 passed |
| Kitchen-sink tests, against a local stand-in for PokeAPI | 4 passed |
| Entire test suite under Bun (`bun test`) | 76 tests: 76 passed, 0 failed |
| Entire test suite under Node (`npm run test:node`) | 76 tests: 71 passed, 0 failed, 5 skipped |
| `mr README.md` and each chapter, `mr example.md`, `examples/*.md` | Passed |
| `kitchen-sink.md` against the real PokeAPI: names, piped names, `--json`, an unknown Pokémon, no input, `-h` | Passed |
| Compiled `mr` (bytecode) with a warm cache, measured with hyperfine | about 19 ms per run for a small hook, 49 ms with `MARKRUN_CACHE=0` |

Environment: macOS, Bun 1.4.0, Node.js 24.15.0, TypeScript 5.8.3, and @types/node 24.0.4.

## Verification boundary

The core and CLI were really executed; they are not pseudocode. The example tests inject a minimal `Bun.argv` value into the interpreter so its conditional branches can also be checked under Node. `example.output.txt` was recorded from the CLI with the user arguments `hello world`.

Five tests need the real Bun runtime because the files they run use Bun APIs: the four kitchen-sink tests and the `README.md` test. They run under Bun and are skipped under Node instead of passing via a mock. The kitchen-sink tests use a local stand-in for PokeAPI, so no network is needed.

No statement-level source-map accuracy, production hardening, package-condition completeness, complete CommonMark conformance, or sandbox security is claimed.

## Reproduce

With Bun installed, from the project root:

```sh
bun install
bun test
bun run check
bun src/cli.ts README.md
bun src/cli.ts example.md hello world
```

The portable core and CLI checks can also run under Node:

```sh
npm install
npm run test:node
npx tsc --noEmit
```

The Node command uses experimental TypeScript stripping to execute the interpreter's own source. Markrun still uses its pinned TypeScript compiler to compile code inside Markdown files.
