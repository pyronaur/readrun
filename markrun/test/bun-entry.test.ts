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
const isBun = Boolean((globalThis as typeof globalThis & { Bun?: unknown }).Bun);
const options = { skip: isBun ? false : 'Requires the real Bun runtime; not emulated under Node.' };
function run(args: string[]) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, NO_COLOR: '1' } });
}

test('Bun native entry: bun run example.mr hello world', options, () => {
  const result = run(['run', 'example.mr', 'hello', 'world']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /And it uses hello world/);
  assert.match(result.stdout, /## I mean, this renders nicely!/);
  assert.equal(result.stdout.split("In addition to more than one, there's more than 1 execution too").length - 1, 1);
});

test('Bun native entry: no user arguments skip the Run section', options, () => {
  const result = run(['run', 'example.mr']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Only if arguments were passed/);
  assert.match(result.stdout, /We can have multiple md blocks like this/);
  assert.doesNotMatch(result.stdout, /That's referenced inside the script/);
});

test('Bun native loader supports arbitrary .mr filenames, not just the example', options, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-bun-'));
  try {
    const filename = join(directory, 'different.mr');
    await writeFile(filename, '```ts\n$: a = "A";\nconsole.log(a);\n```\n<!--$: A -->\n# A\nworks');
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

// A tiny stand-in for PokeAPI, so these tests never touch the network.
async function withApi(run: (api: string) => Promise<void>) {
  const server = (globalThis as any).Bun.serve({
    port: 0,
    fetch(request: Request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/pokemon/pikachu') return Response.json({
        id: 25, name: 'pikachu', height: 4, weight: 60,
        types: [{ type: { name: 'electric' } }],
        stats: [{ base_stat: 35, stat: { name: 'hp' } }, { base_stat: 90, stat: { name: 'speed' } }],
        species: { url: new URL('/species/25', request.url).href },
      });
      if (pathname === '/species/25') return Response.json({ flavor_text_entries: [{ flavor_text: 'Stores\felectricity.', language: { name: 'en' } }] });
      return new Response('Not Found', { status: 404 });
    },
  });
  try { await run(`http://localhost:${server.port}`); } finally { server.stop(true); }
}
async function pokedex(args: string[], input = '') {
  const child = (globalThis as any).Bun.spawn([process.execPath, 'src/cli.ts', 'kitchen-sink.mr', ...args], {
    cwd: root, stdin: new TextEncoder().encode(input), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1' },
  });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, status };
}

test('Kitchen sink: named Pokémon render as cards, with an awaited fetch inside a section', options, () => withApi(async api => {
  const result = await pokedex(['--api', api, 'Pikachu']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '# Pokédex\n## #25 pikachu\nelectric · 0.4 m · 6 kg\n> Stores electricity.\n- hp: 35\n- speed: 90\n');
}));

test('Kitchen sink: names can be piped in, and --json prints only JSON', options, () => withApi(async api => {
  const result = await pokedex(['--api', api, '--json'], 'pikachu\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout)[0].types, 'electric');
}));

test('Kitchen sink: an unknown Pokémon goes to stderr with exit 1', options, () => withApi(async api => {
  const result = await pokedex(['--api', api, 'missingno']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /No Pokémon named "missingno"\./);
}));

test('Kitchen sink: no names prints help to stderr with exit 2; -h and --version exit 0', options, async () => {
  const empty = await pokedex([]);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /^Usage: mr kitchen-sink\.mr/);
  const help = await pokedex(['-h']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: .*\n\nLooks up Pokémon/);
  assert.equal((await pokedex(['--version'])).stdout, 'pokedex 0.1.0\n');
});
