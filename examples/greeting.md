```ts run
// Values are passed where the section is rendered. The section's code sees them as variables.
$: md = 'Greeting', { name: Bun.argv[2] ?? 'world' };
console.log(md);
```
<!--$: Greeting -->
# Hello, {{ name }}

```ts run
console.log(`Prepared a greeting for ${name}.`);
```
