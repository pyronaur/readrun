# Claude Code hooks

A hook reads JSON on stdin and answers with stdout, stderr and its exit code, which a Readrun file does directly. Sections make good message templates.

````markdown
<!-- PreToolUse hook: stop recursive deletes, and tell Claude why. -->
```ts run
const input = await Bun.stdin.json();
const command = input.tool_input?.command ?? '';

if (/\brm\s+-[a-z]*(r[a-z]*f|f[a-z]*r)/.test(command)) {
  $: reason = 'Denied', { command };
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}
```

<!--$: Denied -->
Blocked `{{ command }}`. Ask the user to run it, or delete specific files instead.
````

## Two kinds of hook

- **JSON answers** (PreToolUse, PostToolUse, Stop decisions): stdout is only the JSON object. Keep the entry's notes in HTML comments; blank lines between blocks print nothing.
- **Context** (SessionStart, UserPromptSubmit): plain stdout becomes context for Claude, so the entry's own text is the context, with live values printed by code in place.

## Registering

Hooks may run without your shell's `PATH`. Call `readrun` by its full path:

```json
{ "type": "command", "command": "\"$HOME/.local/bin/readrun\" \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.md\"" }
```

A hook reads files that sit next to it through `__dirname`, for example `join(__dirname, 'protected.txt')`, since hooks run from the project's directory.

A cached run takes about 20 ms, so a hook on every tool call stays cheap. `examples/hook.md` in the Readrun repo is a runnable version.
