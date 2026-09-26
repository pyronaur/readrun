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
  assert.match(result.stdout, /^Markrun: run Markdown files as commands/);
});

test('CLI --list names every section without running the entry', () => {
  const result = cli(['--list', 'examples/basics.md']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Run\tline 14$/m);
  assert.match(result.stdout, /^Last Section\tline 35$/m);
  assert.doesNotMatch(result.stdout, /In addition/);
});

test('CLI --check validates the example without evaluating Bun-specific code', () => {
  const result = cli(['--check', 'examples/basics.md']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: examples\/basics.md \(3 sections\)/);
});

test('CLI normalizes argv and passes user arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-cli-'));
  try {
    const filename = join(directory, 'args.md');
    await writeFile(filename, '```ts run\nconsole.log(process.argv.slice(2).join("|"));\n```');
    const result = cli([filename, 'one', '--two']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'one|--two');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI returns nonzero and useful diagnostics on execution failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-failure-'));
  try {
    const filename = join(directory, 'bad.md');
    await writeFile(filename, '```ts run\nthrow new Error("intentional failure")\n```');
    const result = cli([filename]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[EXECUTION\].*bad.md:2:.*intentional failure/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI fails for a missing file', () => {
  const result = cli(['does-not-exist.md']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
});

test('README.md runs: the introduction lists chapters, and every chapter renders', { skip: bun ? false : 'README.md uses Bun.argv; it needs the real Bun runtime.' }, () => {
  const intro = cli(['README.md']);
  assert.equal(intro.status, 0, intro.stderr);
  const chapters = [...intro.stdout.matchAll(/^- `([a-z]+)`:/gm)].map(match => match[1]);
  assert.ok(chapters.length >= 10, intro.stdout);
  for (const chapter of chapters) {
    const result = cli(['README.md', chapter]);
    assert.equal(result.status, 0, `${chapter}: ${result.stderr}`);
  }
  assert.match(cli(['README.md', 'values']).stdout, /> Hello Ada, this line was filled in by Markrun\./);
});
