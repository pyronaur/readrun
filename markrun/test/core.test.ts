import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Markrun, Markdown, MarkrunError, parse, resolveSection, runFile } from "../src/index.ts";
import type { MarkrunOptions } from "../src/index.ts";

const fence = (code: string, language = "ts", close = "```") => `\`\`\`${language}\n${code}\n${close}`;
const doc = (...parts: string[]) => parts.join("\n");
const marker = (name: string) => `<!--$: ${name} -->`;
function capture(source: string, options: MarkrunOptions = {}) {
  const output: unknown[][] = [];
  const target = { log: (...args: unknown[]) => { output.push(args); }, warn: (...args: unknown[]) => { output.push(args); } };
  return { runtime: new Markrun(source, { ...options, console: target }), output };
}
function errorCode(code: string, text?: RegExp) {
  return (error: unknown) => error instanceof MarkrunError && error.code === code && (!text || text.test(error.message));
}

test("entry executes in order and stops at the first section marker", async () => {
  const { runtime, output } = capture(doc(fence('console.log(1)'), fence('console.log(2)'), marker('A'), fence('console.log(3)')));
  await runtime.run();
  assert.deepEqual(output, [[1], [2]]);
});

test("without markers, --- and headings are ordinary Markdown and every fence runs", async () => {
  const { runtime, output } = capture(doc('Some prose', fence('console.log(1)'), '---', '# More', fence('console.log(2)')));
  const entry = await runtime.run();
  assert.deepEqual(output, [[1], [2]]);
  assert.equal(String(entry), 'Some prose\n---\n# More');
  assert.equal(runtime.document.sections.length, 0);
});

test("entry fences share lexical scope and TypeScript types are erased", async () => {
  const { runtime, output } = capture(doc(fence('interface Count { n: number }; const count: Count = {n: 2};'), 'prose', fence('count.n += 3; console.log(count.n);')));
  await runtime.run();
  assert.deepEqual(output, [[5]]);
});

test("fence boundaries prevent accidental ASI continuation", async () => {
  const { runtime, output } = capture(doc(fence('const n = 3'), fence('(() => console.log(n))()')));
  await runtime.run();
  assert.deepEqual(output, [[3]]);
});

test("unused sections do not execute", async () => {
  const { runtime, output } = capture(doc(fence('console.log("entry")'), marker('Hidden'), fence('throw new Error("must not execute")')));
  await runtime.run();
  assert.deepEqual(output, [['entry']]);
});

test("an unreachable pull has no side effects and does not resolve", async () => {
  const { runtime, output } = capture(fence('if (false) { $: x = "Missing"; } console.log("ok");'));
  await runtime.run();
  assert.deepEqual(output, [['ok']]);
});

test("pulling runs code before rendering, and set interpolates afterward", async () => {
  const { runtime, output } = capture(doc(fence('$: md = "Run"; md.set("arguments", "hello"); console.log(md);'), marker('Run'), 'Uses {{ arguments }}', fence('console.log("selected")')));
  await runtime.run();
  assert.deepEqual(output, [['selected'], ['Uses hello']]);
});

test("printing the same Markdown twice runs its side effects only once", async () => {
  const { runtime, output } = capture(doc(fence('$: md = "Once"; console.log(md); console.log(md);'), marker('Once'), 'text', fence('console.log("effect")')));
  await runtime.run();
  assert.deepEqual(output, [['effect'], ['text'], ['text']]);
});

test("each new pull reruns code and owns independent variables", () => {
  const { runtime, output } = capture(doc(marker('Item'), '# Item', '{{ value }}', fence('console.log("effect")')));
  const a = runtime.pull('Item').set('value', 'A');
  const b = runtime.pull('Item').set('value', 'B');
  assert.equal(String(a), '# Item\nA');
  assert.equal(String(b), '# Item\nB');
  assert.deepEqual(output, [['effect'], ['effect']]);
});

test("initial values are available to section code before rendering", () => {
  const { runtime } = capture(doc(marker('Math'), '{{ result }}', fence('const input: number = section.get("input"); section.set("result", input * 2);')));
  assert.equal(String(runtime.pull('Math', { input: 4 })), '8');
});

test("section code shares scope across its fences", () => {
  const { runtime } = capture(doc(marker('Math'), '{{ result }}', fence('const base: number = 7;'), 'Middle text', fence('section.set("result", base + 1)')));
  assert.equal(String(runtime.pull('Math')), '8\nMiddle text');
});

test("entry and pulled sections have separate lexical scope", async () => {
  const { runtime, output } = capture(doc(fence('const local = "entry"; $: child = "Child"; console.log(child); console.log(local);'), marker('Child'), 'child text', fence('const local = "child"; console.log(local)')));
  await runtime.run();
  assert.deepEqual(output, [['child'], ['child text'], ['entry']]);
});

test("a section runs until the next marker; headings and --- inside it are plain Markdown", () => {
  const { runtime, output } = capture(doc(marker('A'), '# A', 'P', fence('console.log("P")'), '---', '## Sub', 'C', fence('console.log("C")'), marker('B'), fence('console.log("B")')));
  assert.equal(String(runtime.pull('A')), '# A\nP\n---\n## Sub\nC');
  assert.deepEqual(output, [['P'], ['C']]);
});

test("the marker line itself is not part of the rendered section", () => {
  const runtime = new Markrun(doc('intro', marker('A'), 'body'));
  assert.equal(String(runtime.pull('A')), 'body');
});

test("duplicate section names are rejected when the document is parsed", () => {
  assert.throws(() => new Markrun(doc(marker('Same'), 'one', marker('Same'), 'two')), errorCode('DUPLICATE', /line 1/));
});

test("an unknown name lists the available sections", () => {
  const runtime = new Markrun(doc(marker('Last Section'), 'x'));
  assert.throws(() => runtime.pull('Last'), errorCode('NOT_FOUND', /Available sections: "Last Section"/));
});

test("names are case-sensitive, not arbitrary prefix matches", () => {
  const runtime = new Markrun(doc(marker('Always longer')));
  assert.throws(() => runtime.pull('Always'), errorCode('NOT_FOUND'));
  assert.throws(() => runtime.pull('always longer'), errorCode('NOT_FOUND'));
});

test("empty names are diagnosed", () => {
  const runtime = new Markrun(marker('A'));
  assert.throws(() => runtime.pull(''), errorCode('SELECTOR'));
  assert.throws(() => runtime.pull('   '), errorCode('SELECTOR'));
});

test("markers tolerate spacing and indentation; names are whitespace-normalized", () => {
  const runtime = new Markrun(doc('<!--$:Tight-->', 'a', '   <!--  $:  Spaced   out  -->', 'b'));
  assert.deepEqual(runtime.document.sections.map(section => section.name), ['Tight', 'Spaced out']);
  assert.equal(String(runtime.pull('Spaced out')), 'b');
});

test("markers without a name are rejected", () => {
  assert.throws(() => new Markrun('<!--$: -->'), errorCode('MARKER'));
  assert.throws(() => new Markrun('<!--$:-->'), errorCode('MARKER'));
});

test("plain HTML comments are prose, not markers", async () => {
  const { runtime } = capture(doc('<!-- TODO -->', 'text'));
  assert.equal(runtime.document.sections.length, 0);
  assert.equal(String(await runtime.run()), '<!-- TODO -->\ntext');
});

test("markers inside executable fences are not Markdown structure", async () => {
  const { runtime, output } = capture(fence('const text = `\n<!--$: Fake -->\n`; console.log(text);'));
  await runtime.run();
  assert.equal(runtime.document.sections.length, 0);
  assert.deepEqual(output, [['\n<!--$: Fake -->\n']]);
});

test("a longer closing fence is accepted, including the supplied four-backtick closer", async () => {
  const { runtime, output } = capture(fence('console.log(1)', 'ts', '````'));
  await runtime.run();
  assert.deepEqual(output, [[1]]);
});

test("shorter backticks inside a wider display fence do not close it", async () => {
  const source = '````text\n```ts\nthrow new Error("not executed")\n```\n````';
  const { runtime } = capture(source);
  assert.equal(String(await runtime.run()), source);
});

test("unclosed fences report their opening line", () => {
  assert.throws(() => new Markrun('intro\n```ts\nx()', { filename: '/tmp/broken.mr' }), (error: unknown) => error instanceof MarkrunError && error.code === 'FENCE' && error.line === 2);
});

test("BOM and CRLF input are normalized", async () => {
  const { runtime, output } = capture('\uFEFF```ts\r\nconsole.log(1)\r\n```\r\n<!--$: A -->\r\ntext');
  await runtime.run();
  assert.deepEqual(output, [[1]]);
  assert.equal(String(runtime.pull('A')), 'text');
});

test("unlabelled and js fences execute; text, unknown languages and tilde fences stay literal", async () => {
  const { runtime, output } = capture(doc(fence('console.log(1)', ''), fence('console.log(2)', 'js'), fence('throw 1', 'text'), fence('throw 2', 'python'), '~~~ts\nthrow 3\n~~~', fence('throw 4', 'ts noexec')));
  const rendered = String(await runtime.run());
  assert.deepEqual(output, [[1], [2]]);
  assert.match(rendered, /```text/);
  assert.match(rendered, /~~~ts/);
  assert.match(rendered, /```ts noexec/);
});

test("multi-line HTML comments suppress executable fences", async () => {
  const { runtime, output } = capture(doc('<!--', '# Fake', fence('console.log("wrong")'), '-->', fence('console.log("right")')));
  await runtime.run();
  assert.deepEqual(output, [['right']]);
});

test("inline Markdown backticks remain prose", async () => {
  const { runtime, output } = capture('Use `console.log("no")` as documentation.');
  assert.equal(String(await runtime.run()), 'Use `console.log("no")` as documentation.');
  assert.deepEqual(output, []);
});

test("only $: statements pull; comments, strings, templates and other labels are left alone", async () => {
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

test("the pulled name can be any expression", async () => {
  const { runtime, output } = capture(doc(fence('const name = "Hello"; $: a = name; $: b = `${name}`; console.log(a, b);'), marker('Hello'), 'world'));
  await runtime.run();
  assert.deepEqual(output, [['world', 'world']]);
});

test("a pull works in ordinary synchronous functions and callbacks", async () => {
  const { runtime, output } = capture(doc(fence('function select() { $: md = "A"; return md; } console.log(select()); [1].forEach(() => { $: md = "A"; console.log(md); });'), marker('A'), 'a'));
  await runtime.run();
  assert.deepEqual(output, [['a'], ['a']]);
});

test("a $: statement must assign to a plain name inside a block", () => {
  for (const code of ['$: "A";', '$: a.b = "A";', '$: a += "A";', 'if (true) $: a = "A";']) {
    const runtime = new Markrun(doc(fence(code), marker('A')));
    assert.throws(() => runtime.check(), errorCode('PULL'), code);
  }
});

test("interpolation is lazy, supports own-property paths, and preserves false and zero", () => {
  const md = new Markdown('{{ user.name }} {{ n }} {{ ok }} {{ none }} {{ missing }}', 'A', 'x.mr', 1);
  md.set({ user: { name: 'Ada' }, n: 0, ok: false, none: null });
  assert.equal(String(md), 'Ada 0 false  {{ missing }}');
  md.set('user.name', 'Grace');
  assert.equal(md.get('user.name'), 'Grace');
});

test("strict interpolation rejects missing variables at render time, not selection time", () => {
  const runtime = new Markrun(doc(marker('A'), '{{ missing }}'), { strictVariables: true });
  const md = runtime.pull('A');
  assert.throws(() => String(md), errorCode('VARIABLE'));
  md.set('missing', 'fixed');
  assert.equal(String(md), 'fixed');
});

test("interpolation is data, not executable source", () => {
  const runtime = new Markrun(doc(marker('A'), '{{ value }}'));
  const value = '```ts\nthrow new Error("must not execute")\n```';
  assert.equal(String(runtime.pull('A').set('value', value)), value);
});

test("prototype access is not exposed by variable interpolation", () => {
  const md = new Markdown('{{ obj.inherited }} {{ obj.constructor }}', 'A', 'x.mr', 1);
  md.set('obj', Object.create({ inherited: 'secret' }));
  assert.equal(String(md), '{{ obj.inherited }} {{ obj.constructor }}');
  assert.throws(() => md.set('__proto__', 'x'), errorCode('VARIABLE'));
  assert.throws(() => md.set('obj.constructor', 'x'), errorCode('VARIABLE'));
});

test("String, JSON and inspection render Markdown without rerunning code", () => {
  const { runtime, output } = capture(doc(marker('A'), 'text', fence('console.log("once")')));
  const md = runtime.pull('A');
  assert.equal(String(md), 'text');
  assert.equal(JSON.stringify(md), '"text"');
  assert.equal(inspect(md), 'text');
  assert.deepEqual(output, [['once']]);
});

test("direct and indirect circular pulls fail with a call chain", () => {
  const runtime = new Markrun(doc(marker('A'), fence('$: b = "B";'), marker('B'), fence('$: a = "A";')));
  assert.throws(() => runtime.pull('A'), errorCode('CYCLE', /A .* -> B .* -> A/));
});

test("failed pulls unwind the stack so future pulls can run", () => {
  const { runtime } = capture(doc(marker('Broken'), fence('throw new Error("boom")'), marker('Fine'), 'ok'));
  assert.throws(() => runtime.pull('Broken'), errorCode('EXECUTION'));
  assert.throws(() => runtime.pull('Broken'), errorCode('EXECUTION'));
  assert.equal(String(runtime.pull('Fine')), 'ok');
});

test("runtime errors identify the executing fence's source line", () => {
  const runtime = new Markrun(doc(marker('Broken'), fence('const n = 1'), 'text', fence('throw new Error("boom")')), { filename: '/tmp/source.mr' });
  assert.throws(() => runtime.pull('Broken'), (error: unknown) => error instanceof MarkrunError && error.code === 'EXECUTION' && error.line === 7 && error.cause instanceof Error);
});

test("parser diagnostics identify the original Markdown line", async () => {
  const runtime = new Markrun(doc('intro', 'more prose', fence('const = ;')), { filename: '/tmp/syntax.mr' });
  await assert.rejects(() => runtime.run(), (error: unknown) => error instanceof MarkrunError && error.code === 'SYNTAX' && error.line === 4);
});

test("entry supports top-level await in sequential fence order", async () => {
  const { runtime, output } = capture(doc(fence('const n = await Promise.resolve(3); console.log(n);'), fence('await Promise.resolve(); console.log(n + 1);')));
  await runtime.run();
  assert.deepEqual(output, [[3], [4]]);
});

test("section pulls explicitly reject top-level await", () => {
  const runtime = new Markrun(doc(marker('Async'), fence('await Promise.resolve()')));
  assert.throws(() => runtime.pull('Async'), errorCode('ASYNC_SECTION'));
});

test("check compiles but never executes code", () => {
  const { runtime, output } = capture(doc(fence('console.log("entry")'), marker('A'), fence('console.log("section")')));
  runtime.check();
  assert.deepEqual(output, []);
});

test("unused invalid code is lazy, while check diagnoses it", async () => {
  const runtime = new Markrun(doc(fence('const ok = true'), marker('Invalid'), fence('const = ;')));
  await runtime.run();
  assert.throws(() => runtime.check(), errorCode('SYNTAX'));
});

test("static imports execute locally and dynamic imports resolve from the .mr file", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-import-'));
  try {
    await writeFile(join(directory, 'helper.mjs'), 'export const answer = 42;');
    const { runtime, output } = capture(doc(fence('import { basename } from "node:path"; const { answer } = await import("./helper.mjs"); console.log(answer, basename(import.meta.filename));'), marker('Local'), fence('import { basename } from "node:path"; console.log(basename(__filename));')), { filename: join(directory, 'example.mr') });
    await runtime.run();
    runtime.pull('Local');
    assert.deepEqual(output, [[42, 'example.mr'], ['example.mr']]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("static relative imports are resolved from the source document", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-require-'));
  try {
    await writeFile(join(directory, 'helper.cjs'), 'exports.answer = 42;');
    const { runtime, output } = capture(fence('import { answer } from "./helper.cjs"; console.log(answer);'), { filename: join(directory, 'test.mr') });
    await runtime.run();
    assert.deepEqual(output, [[42]]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the internal context binding cannot collide with user identifiers", async () => {
  const { runtime, output } = capture(doc(fence('const __markrun_context = 3; $: a = "A"; console.log(__markrun_context, a);'), marker('A'), 'a'));
  await runtime.run();
  assert.deepEqual(output, [[3, 'a']]);
});

test("markrun.args is a stable copy of caller-supplied user arguments", async () => {
  const args = ['one', 'two'];
  const { runtime, output } = capture(fence('console.log(markrun.args.join(" "));'), { args });
  args.push('three');
  await runtime.run();
  assert.deepEqual(output, [['one two']]);
});

test("runFile reads and runs a real .mr file", async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markrun-file-'));
  try {
    const filename = join(directory, 'file.mr');
    await writeFile(filename, doc(fence('$: a = "A"; console.log(a);'), marker('A'), 'a text'));
    const output: unknown[][] = [];
    const runtime = await runFile(filename, { console: { log: (...args: unknown[]) => { output.push(args); } } });
    assert.equal(runtime.document.sections.length, 1);
    assert.deepEqual(output, [['a text']]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the corrected user example works with and without arguments", async () => {
  const filename = fileURLToPath(new URL('../example.mr', import.meta.url));
  const source = await readFile(filename, 'utf8');
  for (const args of [[], ['hello', 'world']]) {
    const { runtime, output } = capture(source, { filename, args, globals: { Bun: { argv: ['/bin/bun', filename, ...args] } } });
    await runtime.run();
    const text = output.map(row => row.join(' ')).join('\n');
    assert.equal(text.includes('Only if arguments were passed'), args.length > 0);
    assert.equal(text.includes('And it uses hello world'), args.length > 0);
    assert.equal(text.split("In addition to more than one, there's more than 1 execution too").length - 1, 1);
    assert.match(text, /## I mean, this renders nicely!\nBecause it's rendered/);
    assert.doesNotMatch(text, /```ts/);
  }
});
