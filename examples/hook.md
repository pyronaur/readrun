<!-- A Claude Code PreToolUse hook: stop recursive deletes, and tell Claude why.
     In .claude/settings.json: { "matcher": "Bash", "hooks": [{ "type": "command",
     "command": "\"$HOME/.local/bin/mr\" \"$CLAUDE_PROJECT_DIR/.claude/hooks/hook.md\"" }] } -->
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
Blocked `{{ command }}`.

Recursive deletes need a human. Ask the user to run it, or delete specific files instead.
