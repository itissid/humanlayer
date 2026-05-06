# HumanLayer Codex Policy

This directory defines a project-local Codex setup for solo development in this repo.

## Default Behavior

- `profile = "humanlayer-local"` makes this repo start with the local policy.
- `sandbox_mode = "workspace-write"` lets Codex edit this workspace without giving full-machine access.
- `approval_policy = "never"` avoids routine permission prompts.
- Shell command network access is disabled through `sandbox_workspace_write.network_access = false`.
- Codex web search is enabled with `web_search = "live"`.
- Deepwiki MCP is enabled for repository documentation lookup.
- Context7 and Linearis MCP are disabled in this project layer.

## Commands

Interactive:

```bash
.codex/bin/codex-humanlayer
```

Non-interactive:

```bash
.codex/bin/codex-humanlayer-exec "make a scoped change and run focused tests"
```

## Policy Notes

The rules in `.codex/rules/default.rules` govern host/outside-sandbox command execution. The main guardrail is the sandbox: routine shell commands should stay inside `workspace-write`, without external network access.

The rules intentionally allow local Git workflows such as `commit`, `rebase`, `merge`, `branch`, `switch`, and `worktree`, while blocking remote Git operations like `push`, `fetch`, and `pull`.

Commands such as `rm`, `curl`, `ssh`, arbitrary `python`, broad package installs, container launchers, and shell wrappers are forbidden for outside-sandbox execution. If a one-off task needs one of those, run it manually or add a narrow temporary rule.
