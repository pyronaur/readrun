import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";

// Never touch the real ~/.cache/markrun from tests.
process.env.MARKRUN_CACHE_DIR = mkdtempSync(join(tmpdir(), "markrun-cache-"));
import { Markrun, MarkrunError, parse, resolveSection, runFile } from "../src/index.ts";
import type { MarkrunOptions } from "../src/index.ts";

const fence = (code: string, language = "ts run", close = "```") => `\`\`\`${language}\n${code}\n${close}`;
const doc = (...parts: string[]) => parts.join("\n");
const marker = (name: string) => `<!--$: ${name} -->`;
function capture(source: string, options: MarkrunOptions = {}) {
  const output: unknown[][] = [], errors: unknown[][] = [], exits: number[] = [];
  const target = { log: (...args: unknown[]) => { output.push(args); }, error: (...args: unknown[]) => { errors.push(args); } };
  const exit = (code: number) => { exits.push(code); throw new Error(`exit ${code}`); };
  return { runtime: new Markrun(source, { exit, ...options, console: target }), output, errors, exits };
}
function errorCode(code: string, text?: RegExp) {
  return (error: unknown) => error instanceof MarkrunError && error.code === code && (!text || text.test(error.message));
}

// Entry

test("entry executes in order and stops at the first section marker", async () => {
  const { runtime, output } = capture(doc(fence('console.log(1)'), fence('console.log(2)'), marker('A'), fence('console.log(3)')));
  await runtime.run();
  assert.deepEqual(output, [[1], [2]]);
});

test("entry text prints in place, between code output", async () => {
  const { runtime, output } = capture(doc('# Hello', '', fence('console.log("from code")'), '', 'Bye'));
  await runtime.run();
  assert.deepEqual(output, [['# Hello\n'], ['from code'], ['\nBye']]);
});

test("blank lines around a block that printed nothing do not double up", async () => {
  const { runtime, output } = capture(doc('Top', '', fence('const quiet = 1;'), '', 'Bottom', '', fence('console.log("loud")'), '', 'End'));
  await runtime.run();
  assert.deepEqual(output, [['Top\n'], ['Bottom\n'], ['loud'], ['\nEnd']]);
});

test("HTML comments are notes: never executed and never printed", async () => {
  const { runtime, output } = capture(doc('<!-- A note -->', fence('console.log("right")'), '<!--', fence('console.log("wrong")'), '-->', 'text'));
  await runtime.run();
  assert.deepEqual(output, [['right'], ['text']]);
});

test("frontmatter is information about the file: never executed, never printed", async () => {
  const { runtime, output } = capture(doc('---', 'title: Hello', '---', '# Heading', fence('console.log("ran")')));
  await runtime.run();
  assert.deepEqual(output, [['# Heading'], ['ran']]);
});

test("frontmatter can end with ..., and an unclosed --- on the first line is ordinary text", async () => {
  const closed = capture(doc('---', 'a: 1', '...', 'text'));
  await closed.runtime.run();
  assert.deepEqual(closed.output, [['text']]);
  const open = capture(doc('---', 'text'));
  await open.runtime.run();
  assert.deepEqual(open.output, [['---\ntext']]);
});

test("placeholders inside inline code and fenced blocks are printed as written", async () => {
  const runtime = new Markrun(doc(marker('A'), 'Hi {{ name }}, write `{{ name }}` or ``{{ x }}``.', '```text', '{{ y }}', '```', '~~~', '{{ z }}', '~~~'));
  assert.equal(await runtime.render('A', { name: 'Ada' }), 'Hi Ada, write `{{ name }}` or ``{{ x }}``.\n```text\n{{ y }}\n```\n~~~\n{{ z }}\n~~~');
});

test("without markers, --- and headings are ordinary text", async () => {
  const { runtime, output } = capture(doc('Some prose', '---', '# More', fence('console.log(1)')));
  await runtime.run();
  assert.deepEqual(output, [['Some prose\n---\n# More'], [1]]);
  assert.equal(runtime.document.sections.length, 0);
});

test("the entry gets no values, so a placeholder there is an error", async () => {
  const { runtime } = capture('Hello {{ name }}');
  await assert.rejects(() => runtime.run(), errorCode('VALUE', /entry gets no values/));
});

test("entry fences share lexical scope and TypeScript types are erased", async () => {
  const { runtime, output } = capture(doc(fence('interface Count { n: number }; const count: Count = {n: 2};'), fence('count.n += 3; console.log(count.n);')));
  await runtime.run();
  assert.deepEqual(output, [[5]]);
});

test("fence boundaries prevent accidental ASI continuation", async () => {
  const { runtime, output } = capture(doc(fence('const n = 3'), fence('(() => console.log(n))()')));
  await runtime.run();
  assert.deepEqual(output, [[3]]);
});

test("entry supports top-level await in sequential fence order", async () => {
  const { runtime, output } = capture(doc(fence('const n = await Promise.resolve(3); console.log(n);'), fence('await Promise.resolve(); console.log(n + 1);')));
  await runtime.run();
  assert.deepEqual(output, [[3], [4]]);
});

// Rendering sections

test("unused sections do not execute", async () => {
  const { runtime, output } = capture(doc(fence('console.log("entry")'), marker('Hidden'), fence('throw new Error("must not execute")')));
  await runtime.run();
  assert.deepEqual(output, [['entry']]);
});

test("$: renders the section and returns its text as a string", async () => {
  const { runtime, output } = capture(doc(fence('$: md = "A"; console.log(typeof md, md);'), marker('A'), 'Hello'));
  await runtime.run();
  assert.deepEqual(output, [['string', 'Hello']]);
});

test("passed values fill placeholders", async () => {
  const { runtime, output } = capture(doc(fence('$: md = "Greeting", { name: "Ada" }; console.log(md);'), marker('Greeting'), '# Hello, {{ name }}'));
  await runtime.run();
  assert.deepEqual(output, [['# Hello, Ada']]);
});

test("passed values are variables in the section's code", async () => {
  const runtime = new Markrun(doc(marker('Math'), fence('console.log(input * 2)')));
  assert.equal(await runtime.render('Math', { input: 4 }), '8');
});

test("an object can be passed as is; its keys become the section's names", async () => {
  const { runtime, output } = capture(doc(fence('const item = { foo: "a", bar: "b" }; $: line = "Line", item; console.log(line);'), marker('Line'), '- {{ foo }} and {{ bar }}'));
  await runtime.run();
  assert.deepEqual(output, [['- a and b']]);
});

test("a missing value is an error that names the section and placeholder", async () => {
  const runtime = new Markrun(doc(marker('A'), 'Hi {{ name }}'), { filename: '/tmp/missing.md' });
  await assert.rejects(() => runtime.render('A'), (error: unknown) => error instanceof MarkrunError && error.code === 'VALUE' && error.line === 2 && /"A" needs a value for \{\{ name \}\}/.test(error.message));
});

test("values must be an object", async () => {
  const runtime = new Markrun(marker('A'));
  await assert.rejects(() => runtime.render('A', 'text' as never), errorCode('VALUE', /must be an object/));
});

test("a value may not reuse a name the section declares", async () => {
  const runtime = new Markrun(doc(marker('A'), fence('const title = "own";')));
  await assert.rejects(() => runtime.render('A', { title: 'passed' }), errorCode('VALUE', /same name/));
});

test("keys that are not variable names still fill placeholders", async () => {
  const runtime = new Markrun(doc(marker('A'), '{{ first-name }} {{ arguments }}'));
  assert.equal(await runtime.render('A', { 'first-name': 'Ada', arguments: 'x y' }), 'Ada x y');
});

test("placeholders follow own-property paths, and preserve false and zero", async () => {
  const runtime = new Markrun(doc(marker('A'), '{{ user.name }} {{ list.length }} {{ n }} {{ ok }} [{{ none }}]'));
  assert.equal(await runtime.render('A', { user: { name: 'Ada' }, list: [1, 2], n: 0, ok: false, none: null }), 'Ada 2 0 false []');
});

test("prototype properties are never reachable from placeholders", async () => {
  const runtime = new Markrun(doc(marker('A'), '{{ obj.inherited }}'));
  await assert.rejects(() => runtime.render('A', { obj: Object.create({ inherited: 'secret' }) }), errorCode('VALUE'));
});

test("values are data, never executable source", async () => {
  const runtime = new Markrun(doc(marker('A'), '{{ value }}'));
  const value = '```ts\nthrow new Error("must not execute")\n```';
  assert.equal(await runtime.render('A', { value }), value);
});

test("section output is text and printed output, in file order", async () => {
  const runtime = new Markrun(doc(marker('A'), '# Top', fence('console.log("middle")'), 'Bottom'));
  assert.equal(await runtime.render('A'), '# Top\nmiddle\nBottom');
});

test("a section's printing is captured, but console.error still goes to stderr", async () => {
  const { runtime, output, errors } = capture(doc(marker('A'), fence('console.log("in"); console.error("warn")')));
  assert.equal(await runtime.render('A'), 'in');
  assert.deepEqual(output, []);
  assert.deepEqual(errors, [['warn']]);
});

test("sections can render their own children in place", async () => {
  const source = doc(marker('List'), '# {{ title }}', fence('for (const item of items) { $: line = "Line", { item }; console.log(line); }'), 'Done', marker('Line'), '- {{ item }}');
  const runtime = new Markrun(source);
  assert.equal(await runtime.render('List', { title: 'Items', items: ['a', 'b'] }), '# Items\n- a\n- b\nDone');
});

test("each render runs the section again, with its own values", async () => {
  const { runtime, output } = capture(doc(marker('Item'), '{{ value }}', fence('console.error("effect")')));
  assert.equal(await runtime.render('Item', { value: 'A' }), 'A');
  assert.equal(await runtime.render('Item', { value: 'B' }), 'B');
  assert.deepEqual(output, []);
});

test("sections can await", async () => {
  const runtime = new Markrun(doc(marker('A'), fence('const n = await Promise.resolve(2);\nconsole.log(n);')));
  assert.equal(await runtime.render('A'), '2');
});

test("section code shares scope across its fences", async () => {
  const runtime = new Markrun(doc(marker('Math'), fence('const base: number = 7;'), 'Middle', fence('console.log(base + 1)')));
  assert.equal(await runtime.render('Math'), 'Middle\n8');
});

test("entry and rendered sections have separate lexical scope", async () => {
  const { runtime, output } = capture(doc(fence('const local = "entry"; $: child = "Child"; console.log(child); console.log(local);'), marker('Child'), fence('const local = "child"; console.log(local)')));
  await runtime.run();
  assert.deepEqual(output, [['child'], ['entry']]);
});

test("an unreachable render has no side effects and does not resolve", async () => {
  const { runtime, output } = capture(fence('if (false) { $: x = "Missing"; } console.log("ok");'));
  await runtime.run();
  assert.deepEqual(output, [['ok']]);
});

test("the section name can be any expression", async () => {
  const { runtime, output } = capture(doc(fence('const name = "Hello"; $: a = name; $: b = `${name}`; console.log(a, b);'), marker('Hello'), 'world'));
  await runtime.run();
  assert.deepEqual(output, [['world', 'world']]);
});

test("$: works in async functions and callbacks", async () => {
  const { runtime, output } = capture(doc(fence('async function select() { $: md = "A"; return md; } console.log(await select()); await Promise.all([1].map(async () => { $: md = "A"; console.log(md); }));'), marker('A'), 'a'));
  await runtime.run();
  assert.deepEqual(output, [['a'], ['a']]);
});

test("$: must assign a plain name, inside a block, inside an async function", () => {
  for (const code of ['$: "A";', '$: a.b = "A";', '$: a += "A";', 'if (true) $: a = "A";', 'function f() { $: a = "A"; }', '$: a = "A", {}, {};']) {
    const runtime = new Markrun(doc(fence(code), marker('A')));
    assert.throws(() => runtime.check(), errorCode('RENDER'), code);
  }
});

test("only $: statements render; comments, strings, templates and other labels are left alone", async () => {
  const code = [
    '// $: a = "Missing"',
    'const text = "$: a = \'Missing\'";',
    'const template = `$: a = "Missing"`;',
    'outer: for (const n of [1]) { break outer; }',
    'console.log(text, template);',
  ].join('\n');
  const { runtime, output } = capture(fence(code));
  await runtime.run();
  assert.deepEqual(output, [['$: a = \'Missing\'', '$: a = "Missing"']]);
});

test("direct and indirect circular renders fail with a call chain", async () => {
  const runtime = new Markrun(doc(marker('A'), fence('$: b = "B";'), marker('B'), fence('$: a = "A";')));
  await assert.rejects(() => runtime.render('A'), errorCode('CYCLE', /A .* -> B .* -> A/));
});

test("the same section can be rendered concurrently", async () => {
  const runtime = new Markrun(doc(marker('A'), fence('await Promise.resolve(); console.log(n);')));
  assert.deepEqual(await Promise.all([runtime.render('A', { n: 1 }), runtime.render('A', { n: 2 })]), ['1', '2']);
});

test("failed renders do not block later renders", async () => {
  const runtime = new Markrun(doc(marker('Broken'), fence('throw new Error("boom")'), marker('Fine'), 'ok'));
  await assert.rejects(() => runtime.render('Broken'), errorCode('EXECUTION'));
  assert.equal(await runtime.render('Fine'), 'ok');
});

test("runtime errors identify the executing fence's source line", async () => {
  const runtime = new Markrun(doc(marker('Broken'), fence('const n = 1'), 'text', fence('throw new Error("boom")')), { filename: '/tmp/source.md' });
  await assert.rejects(() => runtime.render('Broken'), (error: unknown) => error instanceof MarkrunError && error.code === 'EXECUTION' && error.line === 7 && error.cause instanceof Error);
});

test("parser diagnostics identify the original Markdown line", async () => {
  const runtime = new Markrun(doc('intro', 'more prose', fence('const = ;')), { filename: '/tmp/syntax.md' });
  await assert.rejects(() => runtime.run(), (error: unknown) => error instanceof MarkrunError && error.code === 'SYNTAX' && error.line === 4);
});

// route()

test("route prints the section and exits when one of its flags is passed", async () => {
  const { runtime, output, exits } = capture(doc(fence('import { route } from "markrun";\nawait route("Help", ["-h", "--help"]);\nconsole.log("main");'), marker('Help'), 'Usage: demo'), { args: ['--help'] });
  await assert.rejects(() => runtime.run(), /exit 0/);
  assert.deepEqual(output, [['Usage: demo']]);
  assert.deepEqual(exits, [0]);
});

test("route does nothing when its flags are absent", async () => {
  const { runtime, output } = capture(doc(fence('import { route } from "markrun";\nawait route("Help", ["-h", "--help"]);\nconsole.log("main");'), marker('Help'), 'Usage'), { args: ['file.txt'] });
  await runtime.run();
  assert.deepEqual(output, [['main']]);
});

test("route matches combined short flags and ignores arguments after --", async () => {
  const source = doc(fence('const { route } = await import("markrun");\nawait route("V", ["-v"]);\nconsole.log("main");'), marker('V'), 'v1');
  const combined = capture(source, { args: ['-xv'] });
  await assert.rejects(() => combined.runtime.run(), /exit 0/);
  const escaped = capture(source, { args: ['--', '-v'] });
  await escaped.runtime.run();
  assert.deepEqual(escaped.output, [['main']]);
});

// Markdown structure

test("section names resolve exactly and case-sensitively", async () => {
  const runtime = new Markrun(doc(marker('Always longer'), 'x'));
  await assert.rejects(() => runtime.render('Always'), errorCode('NOT_FOUND', /Available sections: "Always longer"/));
  await assert.rejects(() => runtime.render('always longer'), errorCode('NOT_FOUND'));
});

test("duplicate section names are rejected when the document is parsed", () => {
  assert.throws(() => new Markrun(doc(marker('Same'), 'one', marker('Same'), 'two')), errorCode('DUPLICATE', /line 1/));
});

test("markers tolerate spacing and indentation; names are whitespace-normalized", async () => {
  const runtime = new Markrun(doc('<!--$:Tight-->', 'a', '   <!--  $:  Spaced   out  -->', 'b'));
  assert.deepEqual(runtime.document.sections.map(section => section.name), ['Tight', 'Spaced out']);
  assert.equal(await runtime.render('Spaced out'), 'b');
  assert.equal(resolveSection(parse(marker('A')), ' A ').name, 'A');
});

test("markers without a name are rejected", () => {
  assert.throws(() => new Markrun('<!--$: -->'), errorCode('MARKER'));
  assert.throws(() => new Markrun('<!--$:-->'), errorCode('MARKER'));
});

test("markers inside executable fences are not Markdown structure", async () => {
  const { runtime, output } = capture(fence('const text = `\n<!--$: Fake -->\n`; console.log(text);'));
  await runtime.run();
  assert.equal(runtime.document.sections.length, 0);
  assert.deepEqual(output, [['\n<!--$: Fake -->\n']]);
});

test("a longer closing fence is accepted, including a four-backtick closer", async () => {
  const { runtime, output } = capture(fence('console.log(1)', 'ts run', '````'));
  await runtime.run();
  assert.deepEqual(output, [[1]]);
});

test("shorter backticks inside a wider display fence do not close it", async () => {
  const source = '````text\n```ts\nthrow new Error("not executed")\n```\n````';
  const { runtime, output } = capture(source);
  await runtime.run();
  assert.deepEqual(output, [[source]]);
});

test("unclosed fences report their opening line", () => {
  assert.throws(() => new Markrun('intro\n```ts\nx()', { filename: '/tmp/broken.md' }), (error: unknown) => error instanceof MarkrunError && error.code === 'FENCE' && error.line === 2);
});

test("BOM and CRLF input are normalized", async () => {
  const { runtime, output } = capture('﻿```ts run\r\nconsole.log(1)\r\n```\r\n<!--$: A -->\r\ntext');
  await runtime.run();
  assert.deepEqual(output, [[1]]);
  assert.equal(await runtime.render('A'), 'text');
});

test("only fences marked run execute; everything else is shown", async () => {
  const shown = [fence('throw 1', 'ts'), fence('throw 2', ''), fence('throw 3', 'text'), fence('throw 4', 'python'), '~~~ts run\nthrow 5\n~~~', fence('throw 6', 'ts run now'), fence('throw 7', 'sh run')];
  const { runtime, output } = capture(doc(fence('console.log(1)', 'ts run'), fence('console.log(2)', 'js run'), fence('console.log(3)', 'run'), fence('console.log(4)', 'TypeScript Run'), ...shown));
  await runtime.run();
  assert.deepEqual(output.slice(0, 4), [[1], [2], [3], [4]]);
  const printed = String(output[4][0]);
  for (const label of ['```ts\n', '```\nthrow 2', '```text', '```python', '~~~ts run', '```ts run now', '```sh run']) assert.ok(printed.includes(label), label);
});

// Checking, imports and files

test("check compiles every region but never executes code", () => {
  const { runtime, output } = capture(doc(fence('console.log("entry")'), marker('A'), fence('console.log("section")')));
  runtime.check();
  assert.deepEqual(output, []);
});

test("unused invalid code is lazy, while check diagnoses it", async () => {
  const runtime = new Markrun(doc(fence('const ok = true'), marker('Invalid'), fence('const = ;')));
  await runtime.run();
  assert.throws(() => runtime.check(), errorCode('SYNTAX'));
});

test("static imports execute locally and dynamic imports resolve from the .md file", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-import-'));
  try {
    await writeFile(join(directory, 'helper.mjs'), 'export const answer = 42;');
    const { runtime, output } = capture(doc(fence('import { basename } from "node:path"; const { answer } = await import("./helper.mjs"); console.log(answer, basename(import.meta.filename));'), marker('Local'), fence('import { basename } from "node:path"; console.log(basename(__filename));')), { filename: join(directory, 'example.md') });
    await runtime.run();
    assert.equal(await runtime.render('Local'), 'example.md');
    assert.deepEqual(output, [[42, 'example.md']]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("static relative imports are resolved from the source document", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-require-'));
  try {
    await writeFile(join(directory, 'helper.cjs'), 'exports.answer = 42;');
    const { runtime, output } = capture(fence('import { answer } from "./helper.cjs"; console.log(answer);'), { filename: join(directory, 'test.md') });
    await runtime.run();
    assert.deepEqual(output, [[42]]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the internal context binding cannot collide with user identifiers", async () => {
  const { runtime, output } = capture(doc(fence('const __markrun_context = 3; $: a = "A"; console.log(__markrun_context, a);'), marker('A'), 'a'));
  await runtime.run();
  assert.deepEqual(output, [[3, 'a']]);
});

test("runFile reads and runs a real .md file", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-file-'));
  try {
    const filename = join(directory, 'file.md');
    await writeFile(filename, doc(fence('$: a = "A"; console.log(a);'), marker('A'), 'a text'));
    const output: unknown[][] = [];
    const runtime = await runFile(filename, { console: { log: (...args: unknown[]) => { output.push(args); } } });
    assert.equal(runtime.document.sections.length, 1);
    assert.deepEqual(output, [['a text']]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("examples/basics.md works with and without arguments", async () => {
  const filename = fileURLToPath(new URL('../examples/basics.md', import.meta.url));
  const source = await readFile(filename, 'utf8');
  for (const args of [[], ['hello', 'world']]) {
    const { runtime, output } = capture(source, { filename, args, globals: { Bun: { argv: ['/bin/bun', filename, ...args] } } });
    await runtime.run();
    const text = output.map(row => row.join(' ')).join('\n');
    assert.equal(text.includes('Only if arguments were passed'), args.length > 0);
    assert.equal(text.includes('And it uses hello world'), args.length > 0);
    assert.equal(text.split("In addition to more than one, there's more than 1 execution too").length - 1, 1);
    assert.match(text, /## I mean, this renders nicely!\nBecause it's rendered/);
    assert.doesNotMatch(text, /```ts run/);
    assert.match(text, /```ts\nconsole.log\("I am printed as code, never executed"\);\n```/);
  }
});

// Compilation cache

async function cacheEntries(): Promise<string[]> {
  const dir = process.env.MARKRUN_CACHE_DIR!;
  return (await readdir(dir)).filter(name => name.endsWith('.json')).map(name => join(dir, name));
}
async function withCache(run: () => Promise<void>) {
  const previous = { dir: process.env.MARKRUN_CACHE_DIR, off: process.env.MARKRUN_CACHE };
  process.env.MARKRUN_CACHE_DIR = await mkdtemp(join(tmpdir(), 'markrun-cache-test-'));
  delete process.env.MARKRUN_CACHE;
  try { await run(); } finally {
    await rm(process.env.MARKRUN_CACHE_DIR, { recursive: true, force: true });
    process.env.MARKRUN_CACHE_DIR = previous.dir;
    if (previous.off === undefined) delete process.env.MARKRUN_CACHE; else process.env.MARKRUN_CACHE = previous.off;
  }
}
async function tamper(from: string, to: string) {
  for (const file of await cacheEntries()) {
    const text = await readFile(file, 'utf8');
    if (text.includes(from)) await writeFile(file, text.replace(from, to));
  }
}
const cached = fence('console.log("compiled")');

test("compiled output is cached in MARKRUN_CACHE_DIR and reused by later runs", () => withCache(async () => {
  await capture(cached).runtime.run();
  assert.ok((await cacheEntries()).length > 0);
  await tamper('compiled', 'from cache');
  const again = capture(cached);
  await again.runtime.run();
  assert.deepEqual(again.output, [['from cache']]);
}));

test("MARKRUN_CACHE=0 neither reads nor writes the cache", () => withCache(async () => {
  await capture(cached).runtime.run();
  await tamper('compiled', 'from cache');
  process.env.MARKRUN_CACHE = '0';
  const fresh = capture(cached);
  await fresh.runtime.run();
  assert.deepEqual(fresh.output, [['compiled']]);
  const other = capture(fence('console.log("never cached")'));
  await other.runtime.run();
  for (const file of await cacheEntries()) assert.doesNotMatch(await readFile(file, 'utf8'), /never cached/);
}));

test("a damaged cache entry is compiled again", () => withCache(async () => {
  await capture(cached).runtime.run();
  for (const file of await cacheEntries()) await writeFile(file, '{not json');
  const again = capture(cached);
  await again.runtime.run();
  assert.deepEqual(again.output, [['compiled']]);
}));

test("editing a file means a fresh compile, and errors are never cached", () => withCache(async () => {
  await capture(cached).runtime.run();
  await tamper('compiled', 'from cache');
  const edited = capture(fence('console.log("compiled") '));
  await edited.runtime.run();
  assert.deepEqual(edited.output, [['compiled']]);
  const broken = fence('const = ;');
  await assert.rejects(() => capture(broken).runtime.run(), errorCode('SYNTAX'));
  await assert.rejects(() => capture(broken).runtime.run(), errorCode('SYNTAX'));
}));
