```ts
// Every region can await, including sections.
import { basename } from 'node:path';

$: md = 'Result', { filename: basename(import.meta.filename) };
console.log(md);
```
<!--$: Result -->
```ts
await Bun.sleep(10);
console.log('Waited inside the section.');
```
Ran {{ filename }} in sequence.
