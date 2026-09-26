```ts run
// Every region can await, including sections.
import { basename } from 'node:path';

$: md = 'Result', { filename: basename(import.meta.filename) };
console.log(md);

// A $: { } block renders its sections at the same time.
const started = Date.now();
$: {
  first = 'Slow', { name: 'first' };
  second = 'Slow', { name: 'second' };
}
console.log(first, second);
console.log(`Both took ${Date.now() - started < 450 ? 'about 300' : 'over 450'} ms, not 600.`);
```
<!--$: Result -->
```ts run
await Bun.sleep(10);
console.log('Waited inside the section.');
```
Ran {{ filename }} in sequence.

<!--$: Slow -->
```ts run
await Bun.sleep(300);
```
The {{ name }} section is done.
