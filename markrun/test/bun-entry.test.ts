import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL('..', import.meta.url));
const isBun = Boolean((globalThis as typeof globalThis & { Bun?: unknown }).Bun);
const options = { skip: isBun ? false : 'Requires the real Bun runtime; not emulated under Node.' };
function run(args: string[]) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, NO_COLOR: '1' } });
}

test('Bun native entry: bun run example.mr hello world', options, () => {
  const result = run(['run', 'example.mr', 'hello', 'world']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /And it uses hello world/);
  assert.match(result.stdout, /# Last Section/);
  assert.equal(result.stdout.split("In addition to more than one, there's more than 1 execution too").length - 1, 1);
});

test('Bun native entry: no user arguments skip the Run section', options, () => {
  const result = run(['run', 'example.mr']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Only if arguments were passed/);
  assert.match(result.stdout, /# Always: More than 1/);
});

test('Bun native loader supports arbitrary .mr filenames, not just the example', options, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-bun-'));
  try {
    const filename = join(directory, 'different.mr');
    await writeFile(filename, '```ts\nconsole.log(`@:# A`);\n```\n---\n# A\nworks');
    const result = run(['run', filename]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /# A\nworks/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Bun explicit CLI and native entry agree on Bun.argv and rendering', options, () => {
  const direct = run(['run', 'example.mr', 'hello', 'world']);
  const explicit = run(['src/cli.ts', 'example.mr', 'hello', 'world']);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.equal(explicit.stdout, direct.stdout);
});
