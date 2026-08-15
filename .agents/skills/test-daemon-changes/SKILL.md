---
name: test-daemon-changes
description: >
  Restart the local HumanLayer daemon (hld) to test code changes in the WUI.
  Use when you have made changes to Go code in hld/ and need to rebuild, restart
  the daemon, and verify the changes are reflected in the running WUI.
when_to_use: >
  After modifying Go source files in hld/, hld/cmd/, hld/daemon/, hld/api/, or
  hld/client/ and the user wants to test those changes in the WUI. Also use when
  the user says "test daemon changes", "restart the daemon", "rebuild and test",
  or "see my changes in the WUI".
user-invocable: false
---

# Test Daemon Changes

You are restarting the local HumanLayer daemon to test code changes in the WUI. This skill is for use when both the daemon and WUI are running locally (started via `make daemon-dev-local` and `make wui-dev-local`). It does NOT apply when using `make wui-dev-remote` (remote daemon over SSH tunnel).

## Prerequisites

- The WUI must already be running via `make wui-dev-local` in a separate terminal
- The WUI is accessible in Chrome at `http://localhost:1420`
- Code changes have been made in `hld/`

## Steps

### 1. Detect the running daemon

Run `make daemon-detect` to find the single local daemon process. This outputs `PID=<pid>` and `PORT=<port>`.

```bash
make daemon-detect
```

- If it reports **zero daemons**: inform the user that no daemon is running and they need to start one with `make daemon-dev-local`.
- If it reports **multiple daemons**: inform the user and abort. They need to manually kill extras before this workflow can proceed.
- If it reports **exactly one**: proceed. Save both the PID and PORT values for the next steps.

### 2. Ask user permission to kill the daemon

Before killing the daemon, explicitly ask the user for permission. Example:

> "I found a local daemon (PID <pid>) on port <port>. Can I kill it, rebuild with your changes, and restart it on the same port?"

Do NOT proceed until the user confirms.

### 3. Kill the daemon

After the user confirms, run:

```bash
make daemon-kill PID=<pid>
```

This sends SIGTERM for graceful shutdown, waits 3 seconds, then SIGKILL if needed.

### 4. Verify the daemon is dead

Run `make daemon-detect` again. It should report "No local hld daemon found" and exit with error. If the daemon is still running, wait a few seconds and check once more. If it persists, inform the user.

### 5. Rebuild and restart the daemon

Run the daemon build and start it in the background on the **same port** that was detected in step 1:

```bash
make daemon-dev-build
```

Then start the daemon in the background:

```bash
cd hld && HUMANLAYER_DATABASE_PATH=~/.humanlayer/daemon-nightly.db \
  HUMANLAYER_DAEMON_SOCKET=~/.humanlayer/daemon-local-wui.sock \
  HUMANLAYER_DAEMON_HTTP_PORT=<port> \
  ./hld-dev > ~/.humanlayer/logs/daemon-local-wui.log 2>&1 &
```

Use the Bash tool with `run_in_background: true` for this.

**IMPORTANT**: The port MUST match the port from step 1. The WUI has the daemon URL baked in at startup and will not discover a different port.

### 6. Wait for the daemon to be healthy

Poll the health endpoint until it responds:

```bash
curl -s http://localhost:<port>/api/v1/health
```

Wait up to 10 seconds, checking every 2 seconds. If it doesn't come up, check `~/.humanlayer/logs/daemon-local-wui.log` for errors and inform the user.

### 7. Click Retry Connection in the WUI

Use Chrome browser automation to reconnect the WUI to the restarted daemon:

1. Get tab context with `mcp__claude-in-chrome__tabs_context_mcp`
2. Find the WUI tab at `http://localhost:1420`, or navigate to it if not open
3. Use `mcp__claude-in-chrome__read_page` with `filter: "interactive"` to find the `"Retry Connection"` button
4. Click it using `mcp__claude-in-chrome__computer` with `action: "left_click"` and the button's `ref`
5. Verify the sessions list has reloaded by reading the page again and checking for the sessions tab (e.g., `tab "Sessions (N)"`)

If the "Retry Connection" button is not visible, the WUI may have already reconnected automatically or may still be in the "connecting" state. Wait a moment and check again.

### 8. Confirm to the user

Tell the user the daemon has been restarted with their changes and the WUI is connected. If there were any issues, report them.
