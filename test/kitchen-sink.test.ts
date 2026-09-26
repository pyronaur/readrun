import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";

// Never touch the real ~/.cache/markrun from tests.
process.env.MARKRUN_CACHE_DIR = mkdtempSync(join(tmpdir(), "markrun-cache-"));

const root = fileURLToPath(new URL('..', import.meta.url));
const isBun = Boolean((globalThis as typeof globalThis & { Bun?: unknown }).Bun);
const options = { skip: isBun ? false : 'The kitchen sink uses Bun APIs; these tests need the real Bun runtime.' };
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
  const child = (globalThis as any).Bun.spawn([process.execPath, 'src/cli.ts', 'kitchen-sink.md', ...args], {
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
  assert.match(empty.stderr, /^Usage: mr kitchen-sink\.md/);
  const help = await pokedex(['-h']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: .*\n\nLooks up Pokémon/);
  assert.equal((await pokedex(['--version'])).stdout, 'pokedex 0.1.0\n');
});
