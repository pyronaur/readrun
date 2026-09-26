# Verification report

Recorded on September 26, 2026.

## Executed checks

| Check | Result |
| --- | --- |
| TypeScript source type-check: `tsc --noEmit` | Passed |
| Core-language tests | 57 passed |
| Explicit CLI subprocess tests | 6 passed |
| Native Bun loader, Bun.argv parity and kitchen-sink tests | 8 passed under Bun; skipped under Node |
| Entire test suite under Bun (`bun test`) | 71 tests: 71 passed, 0 failed |
| Entire test suite under Node (`npm run test:node`) | 71 tests: 63 passed, 0 failed, 8 skipped |
| `examples/parameters.mr Ada` via the CLI | Passed |
| `examples/async-entry.mr` via the native Bun loader | Passed |
| `kitchen-sink.mr` against the real PokeAPI: names, piped names, `--json`, an unknown Pokémon, no input, `-h` | Passed |

Environment: macOS, Bun 1.4.0, TypeScript 5.8.3, and @types/node 24.0.4.

## Verification boundary

The core, CLI and native Bun loader were really executed; they are not pseudocode. The example tests inject a minimal `Bun.argv` value into the interpreter so its conditional branches can also be checked under Node. `example.output.txt` was recorded from the CLI with the user arguments `hello world`.

The eight Bun-only tests cover loader registration, custom-entrypoint resolution, Bun's argument vector and the kitchen sink (against a local stand-in for PokeAPI, so no network is needed). They run under Bun and are skipped under Node instead of passing via a mock.

No statement-level source-map accuracy, production hardening, package-condition completeness, complete CommonMark conformance, or sandbox security is claimed.

## Reproduce

With Bun installed, from the project root:

```sh
bun install
bun test
bun run check
bun run example.mr hello world
bun src/cli.ts example.mr hello world
```

The last two invocations should produce identical output; the native test suite asserts this. The native loader also has a smoke test for an arbitrary `.mr` filename, so it does not rely on an example-specific package script.

The portable core and CLI checks can be reproduced with Node 22.16.0:

```sh
npm install
npm run test:node
npx tsc --noEmit
```

The Node command uses experimental TypeScript stripping to execute the interpreter's own source. Markrun still uses its pinned TypeScript compiler to compile code inside `.mr` files. The four Bun-only tests remain skipped in this mode.
