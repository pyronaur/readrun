# Prompt templates

Sections hold prompts as readable Markdown. The entry gathers the values, renders the sections, and hands the strings to whatever runs the agent.

````markdown
```ts run
import { $ } from "bun";

const [docs, help] = (await Promise.all([
  $`docs`.text(),
  $`tool --help`.text(),
])).map(text => text.trimEnd());

$: {
  system = 'System', { submit };
  prompt = 'Prompt', { task, docs, help, submit };
}

await runAgent({ system, prompt });
```

<!--$: Prompt -->
## Requested Task
<task>
{{ task }}
</task>

## On completion
Run `{{ submit }} --summary "SUMMARY" MESSAGE`.

<!--$: System -->
# Role: Explorer
...
````

## What this relies on

- The marker line is never rendered, so a section's string starts at its first line of content. Headings, `---` and tags like `<task>` are ordinary text inside it.
- Placeholders fill inside backticks and fenced blocks too, which suits commands the agent should run.
- The rendered string is trimmed at both ends.
- Rendering independent prompts in one `$: { }` block runs them at the same time.
- Shell output often ends with a newline; trim it before passing it as a value.

## Tooling that reads imports

Tools such as knip that follow imports see a Readrun file only through its `run` fences. For knip, a compiler that extracts them:

```ts
const runFence = /^```(?:(?:ts|typescript|js|javascript) run|run)\n([\s\S]*?)^```$/gm;
// compilers: { md: (text) => [...text.matchAll(runFence)].map(([, code]) => code).join("\n") }
```
