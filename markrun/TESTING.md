# Verification report

Recorded on September 22, 2026.

## Executed checks

| Check | Result |
| --- | --- |
| TypeScript source type-check: `tsc --noEmit` | Passed |
| Loader JavaScript syntax: `node --check src/register.js` | Passed; syntax only |
| Core-language tests | 55 passed |
| Explicit CLI subprocess tests | 6 passed |
| Native Bun loader / Bun.argv parity tests | 4 skipped; Bun not available |
| Entire test suite | 65 tests: 61 passed, 0 failed, 4 skipped |
| `examples/parameters.mr Ada` via the portable CLI under Node | Passed |
| `examples/async-entry.mr` via the portable CLI under Node | Passed |

Environment: Linux x86_64, Node.js 22.16.0, TypeScript 5.8.3, and @types/node 24.0.4. Test dependencies were available locally; no successful package install or Bun execution occurred in this environment. Bun was not installed, and the attempted network installation was blocked by unavailable DNS/network access.

The recorded test output is in `test-results.tap`.

## Verification boundary

The core and CLI were really executed; they are not pseudocode. The example tests inject a minimal `Bun.argv` value into the otherwise unchanged interpreter so its conditional branches can be checked under Node. This is not a claim to have run Bun or emulated Bun's runtime APIs. `example.output.txt` was recorded from that core execution with the user arguments `hello world`.

The `src/register.js` preload and exact `bun run example.mr` command are **implemented but unverified on Bun here**. JavaScript syntax checking cannot verify loader registration, custom-entrypoint resolution, Bun console inspection, or Bun's argument vector. Four native smoke tests exercise those behaviors when the suite is run under the real Bun runtime; they are explicitly skipped under Node instead of passing via a mock.

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
