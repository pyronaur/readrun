import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";

// Never touch the real ~/.cache/markrun from tests.
process.env.MARKRUN_CACHE_DIR = mkdtempSync(join(tmpdir(), "markrun-cache-"));

const root = fileURLToPath(new URL('..', import.meta.url));
const bun = Boolean((globalThis as typeof globalThis & { Bun?: unknown }).Bun);
const runtimeFlags = bun ? [] : ['--experimental-strip-types'];
function cli(args: string[]) {
  return spawnSync(process.execPath, [...runtimeFlags, join(root, 'src/cli.ts'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
}

test('CLI help works without executing a file', () => {
  const result = cli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Markrun 0.1/);
});

test('CLI --list names every section without running the entry', () => {
  const result = cli(['--list', 'example.mr']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Run\tline 14$/m);
  assert.match(result.stdout, /^Last Section\tline 29$/m);
  assert.doesNotMatch(result.stdout, /In addition/);
});

test('CLI --check validates the example without evaluating Bun-specific code', () => {
  const result = cli(['--check', 'example.mr']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: example.mr \(3 sections\)/);
});

test('CLI normalizes argv and passes user arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-cli-'));
  try {
    const filename = join(directory, 'args.mr');
    await writeFile(filename, '```ts\nconsole.log(process.argv.slice(2).join("|"));\n```');
    const result = cli([filename, 'one', '--two']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'one|--two');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI returns nonzero and useful diagnostics on execution failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-failure-'));
  try {
    const filename = join(directory, 'bad.mr');
    await writeFile(filename, '```ts\nthrow new Error("intentional failure")\n```');
    const result = cli([filename]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[EXECUTION\].*bad.mr:2:.*intentional failure/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI fails for a missing file', () => {
  const result = cli(['does-not-exist.mr']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
});
