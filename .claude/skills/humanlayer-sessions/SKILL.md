---
name: humanlayer-sessions
description: Retrieve and analyze past Claude Code conversations from the HumanLayer daemon's local SQLite DB (~/.humanlayer/daemon-dev.db). Use whenever the user asks about a previous session, a past conversation, a session by title, "what did we discuss about X", "find the session where...", "show me the transcript of...", "what tools did that session call", session history, approvals history, or anything that requires reading HumanLayer's on-disk session store. Also trigger when the user mentions HumanLayer daemon, hld, session IDs, or daemon-dev.db directly.
allowed-tools: Bash, Read, Grep
---

# HumanLayer Sessions Skill

Query the HumanLayer daemon's SQLite conversation store to find sessions, retrieve transcripts, and answer questions grounded in prior Claude Code conversations.

**DB path**: `~/.humanlayer/daemon-dev.db` (dev daemon, default). If the user explicitly asks about production, use `~/.humanlayer/daemon.db` and pass it with `--db`.

**Access mode**: the helper always opens the DB read-only (`mode=ro`), so it is safe to run while the daemon is live.

## When to use this skill

- User names a past session by a keyword from its title or initial prompt and asks a follow-up question about it.
- User asks "what did I ask about X last week", "find the conversation about Y", "show me the session that did Z".
- User wants a full transcript of a specific session.
- User asks about tool approvals, errors, or token/cost stats for past sessions.
- User explicitly references the HumanLayer daemon DB, `hld`, or `daemon-dev.db`.

Do **not** use this skill for questions that have nothing to do with HumanLayer's stored conversations.

## Workflow

Given a user question, follow these steps. Stop and answer as soon as you have enough context.

### 1. Map the question to session IDs

Start from whatever hook the user gave you:

- **Title / keyword** → use `search` to find candidate sessions. Search matches against `title`, `summary`, and `query` (the initial prompt).
- **"Most recent"** → use `recent`.
- **Known session ID (or prefix)** → skip to step 2. All session arguments accept a unique prefix of the UUID.

```bash
python ${CLAUDE_SKILL_DIR}/scripts/query.py search "choose_language" --limit 20
python ${CLAUDE_SKILL_DIR}/scripts/query.py recent --limit 10
```

If `search` returns multiple plausible matches, show the user the short list (id + title + status + last_activity_at) and ask which one, unless the user's question is clearly about all of them.

### 2. Inspect session metadata

Before reading the transcript, look at the session record so you know its shape (status, model, cost, parent, error message):

```bash
python ${CLAUDE_SKILL_DIR}/scripts/query.py show 47b161a6
```

If `parent_session_id` is set, the full conversation may span multiple resumed Claude sessions. Use `parents` to see the chain:

```bash
python ${CLAUDE_SKILL_DIR}/scripts/query.py parents 47b161a6
```

### 3. Read the transcript — target what you actually need

Transcripts can be very large. Filter aggressively.

- **Default**: last N events of whatever types are relevant.
- **Resumed session**: add `--follow-parents` to replay the entire parent-chain conversation in order.
- **Just the messages** (skip tool noise): `--types message,thinking`.
- **Just tool activity**: `--types tool_call,tool_result`.
- **Truncate long events**: `--max-content 800` (default 2000; pass 0 for no truncation).

```bash
# Full messages only, full content, following parent chain:
python ${CLAUDE_SKILL_DIR}/scripts/query.py transcript 47b161a6 \
    --types message --max-content 0 --follow-parents

# Just the tool calls, truncated:
python ${CLAUDE_SKILL_DIR}/scripts/query.py transcript 47b161a6 \
    --types tool_call,tool_result --max-content 400 --limit 50
```

Use `--json` on any command when you want structured output you will pipe into another tool (e.g. `jq`). Avoid `--json` when you are reading the output yourself — the table format is denser in context.

### 4. Specialized lookups

| Question | Command |
|---|---|
| What tool approvals did this session have? | `approvals <session>` |
| How many sessions overall, by status? | `stats` |
| Is this a resumed/branched session? | `parents <session>` |

### 5. Answer the user

- Ground every claim in the events you read. Cite the session id (short prefix is fine) and event `#sequence` when you quote or summarize content.
- If a user asks "did we ever decide X?" and you cannot find a definitive event, say so — do not guess.
- Prefer direct quotes from `message` events for decisions/requirements; use `tool_call` events for "what did we actually do".

## Schema cheat sheet

Only the columns you will read most often — full schema is in `hld/store/sqlite.go`.

**`sessions`** — one row per Claude Code session
- `id` (TEXT, UUID) — the canonical session ID
- `parent_session_id` — set when this is a resume/branch
- `claude_session_id` — Claude's own session ID; NULL for drafts
- `title`, `summary`, `query` — searchable text (query = initial prompt)
- `status` — `draft`, `starting`, `running`, `completed`, `failed`, `waiting_input`, `interrupting`, `interrupted`, `discarded`
- `archived` — soft-delete flag; filtered out of `search` and `recent` by default

**`conversation_events`** — one row per message / tool call / tool result
- `session_id` FK → `sessions.id`
- `sequence` — ordering within a claude_session_id
- `event_type` — `message`, `thinking`, `tool_call`, `tool_result`, `system`
- `role`, `content` — populated for `message` / `thinking`
- `tool_name`, `tool_input_json` — populated for `tool_call`
- `tool_result_content` — populated for `tool_result`
- `approval_status` — NULL, `pending`, `approved`, `denied`

**`approvals`** — tool-call approval decisions
- `session_id`, `tool_name`, `status`, `comment`

## Gotchas

- **`title` is often empty.** `search` matches `title` OR `summary` OR `query` precisely because the daemon fills these asynchronously; don't search only the title column by hand.
- **Two DB paths exist.** `daemon-dev.db` (dev, default here) vs `daemon.db` (production). Ask the user if it's unclear; they are separate stores.
- **Transcripts for resumed sessions**: the rows you want may live under a *different* `claude_session_id` than this session's. Use `--follow-parents` for those.
- **WAL files present**: `.db-wal` / `.db-shm` are daemon-managed — don't touch them, and don't `cp` the DB while the daemon is running. The script opens read-only so queries are fine.
- **Raw SQL fallback**: if a question needs something the script does not cover, it is fine to call `sqlite3 ~/.humanlayer/daemon-dev.db '.headers on' '<query>'` directly. Keep read-only behavior by not passing `-readonly off` equivalents (there is none — sqlite3 CLI default is read-write, so be careful not to issue UPDATE/DELETE).

## Examples

**"What did the session about choose_language conclude?"**
1. `search "choose_language" --limit 10`
2. `show <id>` to confirm status
3. `transcript <id> --types message --max-content 0`
4. Summarize, citing `#N message` events.

**"Find the session where we discussed MinIO volumes and list every tool call."**
1. `search "minio" --limit 20`
2. Ask user to confirm if multiple match.
3. `transcript <id> --types tool_call --max-content 200`

**"How much has the daemon stored?"**
1. `stats` — answer from the output directly.
