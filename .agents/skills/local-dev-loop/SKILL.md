---
name: local-dev-loop
description: >
  Guide for iterating on HumanLayer WUI (React/Tauri) and HLD (Go daemon) changes
  locally. Covers architecture orientation, build/test commands, daemon restart via
  test-daemon-changes skill, and browser verification patterns. Use when implementing
  or planning changes to humanlayer-wui/ or hld/.
when_to_use: >
  When making code changes to humanlayer-wui/ (React frontend) or hld/ (Go daemon)
  and testing them locally against a running WUI dev server. Also reference when
  creating implementation plans for WUI or HLD features to include correct testing
  methodology and verification steps in the plan.
user-invocable: true
---

# Local Dev Loop

Iterative development guide for HumanLayer's WUI (React frontend) and HLD (Go daemon).
Use this skill to make changes, verify them, and iterate. Also reference it when writing
implementation plans to include correct testing and verification methodology.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Terminal: make wui-dev-local                   │
│  Vite dev server on http://localhost:1420       │
│  Tauri webview wrapping React frontend          │
│  Hot-reloads .tsx/.ts changes automatically     │
└──────────────────────┬──────────────────────────┘
                       │ HTTP (auto-detected port)
┌──────────────────────▼──────────────────────────┐
│  hld-dev daemon (Go binary)                     │
│  REST API + SSE on http://localhost:<PORT>       │
│  SQLite at ~/.humanlayer/daemon-nightly.db       │
│  Spawns Claude Code sessions via hlyr CLI        │
└─────────────────────────────────────────────────┘
```

**Data flow**: WUI frontend --> HTTP requests --> daemon --> SQLite + session management.
Real-time updates flow back via SSE (Server-Sent Events).

### Key Directories

```
humanlayer/
├── hld/                              # Go daemon (backend)
│   ├── cmd/hld/                      #   main entry point
│   ├── api/handlers/                 #   HTTP handlers (files, sessions, approvals)
│   ├── internal/                     #   internal packages (filescan, etc.)
│   ├── daemon/                       #   core daemon lifecycle
│   └── store/                        #   SQLite persistence layer
├── humanlayer-wui/                   # React + Tauri desktop app (frontend)
│   ├── src/
│   │   ├── components/               #   React components
│   │   │   ├── Layout.tsx            #     global layout, status bar
│   │   │   └── internal/             #     feature components
│   │   │       ├── ConversationStream/  # message/tool rendering
│   │   │       └── SessionDetail/       # session view, hotkeys, hooks
│   │   ├── lib/                      #   utilities, API clients, search
│   │   ├── hooks/                    #   React hooks (hotkeys, etc.)
│   │   └── AppStore.ts              #   Zustand global state
│   └── src-tauri/                    #   Tauri Rust backend (auto-recompiles)
├── hlyr/                             # TypeScript CLI + MCP server
└── .claude/skills/                   # skills (including this one)
```

### How Components Connect

1. **WUI frontend** (React) makes HTTP requests to the daemon for sessions, files, approvals
2. **WUI frontend** receives real-time updates via SSE from the daemon
3. **Daemon** (`hld`) stores everything in SQLite, spawns Claude Code sessions via `hlyr`
4. **File scanner** (`hld/internal/filescan/`) serves the `@` fuzzy file search, called by `hld/api/handlers/files.go`
5. **`.claude/fuzzy-include`** in each workingDir controls which gitignored paths appear in `@` search

## Prerequisites

Before using this skill, ensure:

1. **WUI dev server is running** in a separate terminal:
   ```bash
   make wui-dev-local
   ```
   This starts Vite on `http://localhost:1420` and auto-detects the local daemon.
   Leave it running throughout your iteration session.

2. **A local daemon is running.** `wui-dev-local` auto-starts one if needed, or you
   can start one manually:
   ```bash
   make daemon-dev-local                  # foreground, default port
   make daemon-dev-local LOCAL_PORT=7778  # specific port
   ```

3. **Chrome is open** with the WUI tab at `http://localhost:1420` (for browser verification).

## Change Classification

Before making changes, classify what you're modifying:

| Changed Files | Type | Rebuild? | Daemon Restart? |
|---|---|---|---|
| `hld/**/*.go` | **HLD-only** | `go build` | Yes, use `test-daemon-changes` skill |
| `humanlayer-wui/src/**/*.{tsx,ts,css}` | **WUI-only** | No, Vite hot-reloads | No |
| `humanlayer-wui/src-tauri/**/*.rs` | **Tauri backend** | No, auto-recompiles | No |
| Both `hld/` and `humanlayer-wui/src/` | **Combined** | `go build` for HLD | Yes for HLD; WUI hot-reloads |

---

## HLD Changes (Go Daemon)

### Iteration Loop

1. **Make code changes** in `hld/`
2. **Run automated checks**:
   ```bash
   cd hld && go build ./...
   cd hld && go test ./...
   cd hld && go vet ./...
   ```
3. **Restart daemon with changes**: Use the `test-daemon-changes` skill. It will:
   - Detect the running daemon (PID + PORT)
   - Ask for permission to kill it
   - Rebuild via `make daemon-dev-build`
   - Restart on the same port
   - Click "Retry Connection" in the WUI
4. **Verify in browser** (see Browser Verification Patterns below)
5. **Iterate** from step 1

### When NOT to Restart the Daemon

If you're only modifying `*_test.go` files, just run `go test`. No daemon restart needed.

---

## WUI Changes (React Frontend)

### Iteration Loop

1. **Make code changes** in `humanlayer-wui/src/`
2. **Run automated checks**:
   ```bash
   cd humanlayer-wui && make check    # lint + typecheck
   cd humanlayer-wui && bun test      # unit tests
   ```
3. **Vite hot-reloads automatically.** Switch to Chrome and the changes are live.
4. **Verify in browser** (see Browser Verification Patterns below)
5. **Iterate** from step 1

### Common WUI Change Types

| Change | Location | Notes |
|---|---|---|
| New component | `src/components/` | Import where needed |
| New hook | `src/hooks/` | Follow existing patterns |
| Store changes | `src/AppStore.ts` | Zustand state + actions |
| Hotkey additions | Component using `useHotkeys()` | Check scopes in `src/hooks/hotkeys/scopes.ts` |
| Pure logic | `src/lib/` | Write unit tests alongside |

---

## Combined Changes (HLD + WUI)

1. **Make all code changes** in both `hld/` and `humanlayer-wui/src/`
2. **Run automated checks for both**:
   ```bash
   cd hld && go build ./... && go test ./... && go vet ./...
   cd humanlayer-wui && make check && bun test
   ```
3. **Restart daemon**: Use the `test-daemon-changes` skill (WUI hot-reloads automatically)
4. **Verify in browser**
5. **Iterate**

Order matters: restart the daemon first. The WUI will already have your frontend
changes hot-reloaded by the time the daemon comes back up.

---

## Standard Automated Verification

Always run these after making changes, before browser verification.

### HLD (Go)

```bash
cd hld && go build ./...               # compilation check
cd hld && go test ./...                # all tests
cd hld && go vet ./...                 # static analysis
cd hld && go test -v ./path/to/pkg/... # verbose for specific package
```

### WUI (TypeScript/React)

```bash
cd humanlayer-wui && make check        # lint + typecheck
cd humanlayer-wui && bun test          # unit tests
```

### Full Monorepo

```bash
make check-test                        # all checks and tests across the monorepo
```

---

## Browser Verification Patterns

Use Chrome browser automation tools (`mcp__claude-in-chrome__*`) to verify changes
in the WUI. These are generic patterns. Refer to your implementation plan's manual
verification steps for what specifically to check.

### 1. Get Tab Context (Always First)

```
mcp__claude-in-chrome__tabs_context_mcp
```

Returns available tabs. Find the WUI tab at `http://localhost:1420`.

### 2. Take Screenshots

```
mcp__claude-in-chrome__computer  action: "screenshot"  tabId: <id>
```

Use `action: "zoom"` with a `region: [x0, y0, x1, y1]` to inspect small UI elements.

### 3. Read Interactive Elements

```
mcp__claude-in-chrome__read_page  tabId: <id>  filter: "interactive"
```

Returns elements with `ref` IDs (e.g., `ref_1`, `ref_2`) you can click.

### 4. Create a Test Session

To test changes in a fresh session with a specific workingDir:

1. Navigate to sessions list (click "sessions" link or go to `http://localhost:1420/#/`)
2. Click "CREATE C" button (top right)
3. Click "WORKING DIRECTORY" field, type the repo name, select from dropdown
4. Click the input area, type a prompt (e.g., "hi"), click "LAUNCH"
5. Wait for session status to show `READY_FOR_INPUT`

### 5. Interact with Session Input

1. Click the input area ("ENTER to start typing..." placeholder)
2. Type text: `action: "type"  text: "your text here"`
3. For `@` mentions: type `@` followed by a search term, the fuzzy file list appears
4. `Escape` dismisses the fuzzy list without selecting

### 6. Click Elements

By reference (preferred):
```
mcp__claude-in-chrome__computer  action: "left_click"  ref: "ref_N"
```

By coordinate (fallback):
```
mcp__claude-in-chrome__computer  action: "left_click"  coordinate: [x, y]
```

### 7. Test Keyboard Shortcuts

```
mcp__claude-in-chrome__computer  action: "key"  text: "/"         # single key
mcp__claude-in-chrome__computer  action: "key"  text: "Escape"    # special key
mcp__claude-in-chrome__computer  action: "key"  text: "cmd+a"     # modifier combo
```

### 8. Following Plan Verification Steps

After automated checks pass, follow the manual verification steps from your
implementation plan. For each step:

1. **Set up the precondition** (navigate to the right page, create test data)
2. **Perform the action** (click, type, press hotkey)
3. **Take a screenshot** to capture the result
4. **Assert the expected outcome** (element visible, text present, layout correct)

If a step fails, diagnose the issue, fix the code, re-run automated checks, then
retry the failing verification step.

---

## Debugging

### Daemon Logs

```bash
# Local WUI daemon logs
tail -50 ~/.humanlayer/logs/daemon-local-wui.log

# Dev daemon logs (most recent)
ls -t ~/.humanlayer/logs/daemon-*.log | head -1 | xargs tail -50
```

### Database Inspection

Use the `humanlayer-sessions` skill to query session data. Or query directly:

```bash
# Nightly database (used by local WUI dev)
sqlite3 ~/.humanlayer/daemon-nightly.db "SELECT id, title, status FROM sessions ORDER BY created_at DESC LIMIT 5;"

# Dev database
sqlite3 ~/.humanlayer/daemon-dev.db "SELECT id, title, status FROM sessions ORDER BY created_at DESC LIMIT 5;"

# Schema
sqlite3 ~/.humanlayer/daemon-nightly.db ".schema"
```

### WUI Console Logs

```
mcp__claude-in-chrome__read_console_messages  tabId: <id>  pattern: "your filter"
```

### Network Requests

```
mcp__claude-in-chrome__read_network_requests  tabId: <id>
```

---

## Key File Locations

| Purpose | Path |
|---|---|
| Daemon entry point | `hld/cmd/hld/main.go` |
| HTTP handlers | `hld/api/handlers/` |
| File scanner (`@` search) | `hld/internal/filescan/scanner.go` |
| SQLite store | `hld/store/sqlite.go` |
| WUI global layout | `humanlayer-wui/src/components/Layout.tsx` |
| WUI app state (Zustand) | `humanlayer-wui/src/AppStore.ts` |
| Session detail view | `humanlayer-wui/src/components/internal/SessionDetail/` |
| Conversation rendering | `humanlayer-wui/src/components/internal/ConversationStream/` |
| Hotkey scopes | `humanlayer-wui/src/hooks/hotkeys/scopes.ts` |
| Daemon URL resolution | `humanlayer-wui/src/lib/daemon/http-config.ts` |
| Fuzzy file search UI | `humanlayer-wui/src/components/internal/SessionDetail/components/FuzzyFileMentionList.tsx` |
| Force-include config | `.claude/fuzzy-include` (per workingDir) |

## Related Skills

| Skill | When to Use |
|---|---|
| `test-daemon-changes` | Restart daemon after HLD code changes. Invoke this skill directly. |
| `humanlayer-sessions` | Query SQLite DB for session/event data when debugging features. |

## Example Plans

For concrete examples of how this dev loop is used in practice:

- **HLD-only change**: `thoughts/shared/plans/2026-04-22-fuzzy-include-force-override.md` (scanner feature with unit tests + browser verification)
- **WUI-only change**: `thoughts/shared/plans/2026-04-15-in-session-conversation-search.md` (React components, hooks, Zustand state, hotkeys)

## References

- Build guide: `thoughts/shared/research/2026-04-22-building-codelayer-apps-howto.md`
- Setup guide: `thoughts/global/itissid/2025-11-06-humanlayer-setup-guide.md`
