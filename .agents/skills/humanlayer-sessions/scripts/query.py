#!/usr/bin/env python3
"""Read-only introspection for the HumanLayer daemon SQLite database.

Subcommands:
    recent      List most recently active sessions.
    search      Find sessions by text in title / summary / query.
    show        Show full metadata for one session.
    transcript  Dump the conversation events for one session.
    parents     Walk the parent-session chain.
    approvals   List tool approvals for a session.
    stats       Summary counts.

All session-id arguments accept a unique prefix (not just full UUIDs).
Default DB path is ~/.humanlayer/daemon-dev.db and it is always opened
read-only (WAL-safe while the daemon is running).
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable

DEFAULT_DB = Path(os.path.expanduser("~/.humanlayer/daemon-dev.db"))

# Matches SearchSessionsByTitle in hld/store/sqlite.go: exclude soft-deleted
# and non-user-facing states so searches behave like the UI.
LIVE_FILTER = "(archived IS NULL OR archived = 0) AND status NOT IN ('draft','discarded')"


def open_db(path: Path) -> sqlite3.Connection:
    if not path.exists():
        sys.exit(f"error: database not found at {path}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def resolve_session_id(conn: sqlite3.Connection, id_or_prefix: str) -> str:
    row = conn.execute("SELECT id FROM sessions WHERE id = ?", (id_or_prefix,)).fetchone()
    if row:
        return row["id"]
    rows = conn.execute(
        "SELECT id FROM sessions WHERE id LIKE ? LIMIT 6",
        (f"{id_or_prefix}%",),
    ).fetchall()
    if not rows:
        sys.exit(f"error: no session matches '{id_or_prefix}'")
    if len(rows) > 1:
        sample = ", ".join(r["id"] for r in rows)
        sys.exit(f"error: prefix '{id_or_prefix}' is ambiguous ({len(rows)}+ matches): {sample}")
    return rows[0]["id"]


def truncate(s: str | None, n: int) -> str:
    s = (s or "").replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "\u2026"


def emit(rows: Iterable[dict[str, Any]], *, as_json: bool, columns: list[str] | None = None) -> None:
    rows = list(rows)
    if as_json:
        print(json.dumps(rows, indent=2, default=str))
        return
    if not rows:
        print("(no rows)")
        return
    cols = columns or list(rows[0].keys())
    widths = {c: max(len(c), *(len(str(r.get(c, ""))) for r in rows)) for c in cols}
    print(" | ".join(c.ljust(widths[c]) for c in cols))
    print("-+-".join("-" * widths[c] for c in cols))
    for r in rows:
        print(" | ".join(str(r.get(c, "")).ljust(widths[c]) for c in cols))


# ---------- Subcommands ----------


def cmd_recent(conn: sqlite3.Connection, args: argparse.Namespace) -> None:
    sql = f"""
        SELECT id, title, summary, query, status, model_id,
               created_at, last_activity_at, num_turns, cost_usd
          FROM sessions
         WHERE {LIVE_FILTER}
         ORDER BY last_activity_at DESC
         LIMIT ?
    """
    rows = [dict(r) for r in conn.execute(sql, (args.limit,))]
    for r in rows:
        r["title"] = truncate(r["title"] or r["summary"] or r["query"] or "(untitled)", 60)
    emit(
        [{k: r[k] for k in ("id", "title", "status", "last_activity_at", "num_turns", "cost_usd")} for r in rows],
        as_json=args.json,
    )


def cmd_search(conn: sqlite3.Connection, args: argparse.Namespace) -> None:
    pattern = f"%{args.term}%"
    filter_clause = "1=1" if args.include_archived else LIVE_FILTER
    sql = f"""
        SELECT id, title, summary, query, status, last_activity_at,
               num_turns, cost_usd
          FROM sessions
         WHERE {filter_clause}
           AND (title   LIKE ?
             OR summary LIKE ?
             OR query   LIKE ?)
         ORDER BY last_activity_at DESC
         LIMIT ?
    """
    rows = [dict(r) for r in conn.execute(sql, (pattern, pattern, pattern, args.limit))]
    for r in rows:
        r["title"] = truncate(r["title"] or r["summary"] or r["query"] or "(untitled)", 70)
    emit(
        [{k: r[k] for k in ("id", "title", "status", "last_activity_at")} for r in rows],
        as_json=args.json,
    )


def cmd_show(conn: sqlite3.Connection, args: argparse.Namespace) -> None:
    sid = resolve_session_id(conn, args.session)
    row = conn.execute("SELECT * FROM sessions WHERE id = ?", (sid,)).fetchone()
    data = dict(row)
    if args.json:
        print(json.dumps(data, indent=2, default=str))
        return
    # Human-readable fixed-order layout.
    order = [
        "id", "run_id", "claude_session_id", "parent_session_id",
        "title", "summary", "status", "model_id", "working_dir",
        "created_at", "last_activity_at", "completed_at",
        "num_turns", "cost_usd",
        "input_tokens", "output_tokens",
        "cache_creation_input_tokens", "cache_read_input_tokens",
        "effective_context_tokens",
        "auto_accept_edits", "dangerously_skip_permissions",
        "archived", "error_message",
    ]
    for key in order:
        if key in data and data[key] not in (None, ""):
            print(f"{key:>32}: {data[key]}")
    # query and result_content last, full, multi-line.
    if data.get("query"):
        print("\n--- query ---")
        print(data["query"])
    if data.get("result_content"):
        print("\n--- result_content ---")
        print(data["result_content"])


def collect_claude_session_ids(conn: sqlite3.Connection, sid: str) -> list[str]:
    """Walk parent_session_id chain, return claude_session_ids in chain order."""
    chain: list[str] = []
    current: str | None = sid
    seen: set[str] = set()
    while current and current not in seen:
        seen.add(current)
        row = conn.execute(
            "SELECT claude_session_id, parent_session_id FROM sessions WHERE id = ?",
            (current,),
        ).fetchone()
        if row is None:
            break
        if row["claude_session_id"]:
            chain.append(row["claude_session_id"])
        current = row["parent_session_id"]
    return list(reversed(chain))


def cmd_transcript(conn: sqlite3.Connection, args: argparse.Namespace) -> None:
    sid = resolve_session_id(conn, args.session)

    if args.follow_parents:
        claude_ids = collect_claude_session_ids(conn, sid)
        if not claude_ids:
            # Fall back to direct session_id join.
            rows = conn.execute(
                "SELECT * FROM conversation_events WHERE session_id = ? ORDER BY sequence",
                (sid,),
            ).fetchall()
        else:
            placeholders = ",".join("?" * len(claude_ids))
            # Order by position in the chain, then by sequence within that claude session.
            chain_order = " ".join(
                f"WHEN ? THEN {i}" for i in range(len(claude_ids))
            )
            sql = f"""
                SELECT *,
                       CASE claude_session_id {chain_order} END AS _chain_pos
                  FROM conversation_events
                 WHERE claude_session_id IN ({placeholders})
                 ORDER BY _chain_pos, sequence
            """
            params: list[Any] = list(claude_ids) + list(claude_ids)
            rows = conn.execute(sql, params).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM conversation_events WHERE session_id = ? ORDER BY sequence",
            (sid,),
        ).fetchall()

    types = set(args.types.split(",")) if args.types else None
    rendered = 0
    for r in rows:
        if types and r["event_type"] not in types:
            continue
        rendered += 1
        if args.limit and rendered > args.limit:
            break
        render_event(r, max_content=args.max_content, as_json=args.json)

    if args.json:
        return
    if rendered == 0:
        print("(no events matched)")


def render_event(r: sqlite3.Row, *, max_content: int, as_json: bool) -> None:
    etype = r["event_type"]
    seq = r["sequence"]
    if as_json:
        print(json.dumps({k: r[k] for k in r.keys()}, default=str))
        return

    header = f"[#{seq} {etype}"
    if r["role"]:
        header += f" role={r['role']}"
    if r["tool_name"]:
        header += f" tool={r['tool_name']}"
    if r["approval_status"]:
        header += f" approval={r['approval_status']}"
    header += "]"
    print(header)

    if etype == "message" or etype == "thinking":
        body = r["content"] or ""
        print(truncate(body, max_content) if max_content else body)
    elif etype == "tool_call":
        raw = r["tool_input_json"] or "{}"
        try:
            parsed = json.dumps(json.loads(raw), indent=2)
        except json.JSONDecodeError:
            parsed = raw
        print(truncate(parsed, max_content) if max_content else parsed)
    elif etype == "tool_result":
        body = r["tool_result_content"] or ""
        print(truncate(body, max_content) if max_content else body)
    else:
        # system / unknown — dump whatever content fields exist.
        for key in ("content", "tool_result_content", "tool_input_json"):
            if r[key]:
                print(truncate(r[key], max_content) if max_content else r[key])
                break
    print()


def cmd_parents(conn: sqlite3.Connection, args: argparse.Namespace) -> None:
    sid = resolve_session_id(conn, args.session)
    chain: list[dict[str, Any]] = []
    current: str | None = sid
    seen: set[str] = set()
    while current and current not in seen:
        seen.add(current)
        row = conn.execute(
            "SELECT id, parent_session_id, title, summary, query, status, created_at "
            "FROM sessions WHERE id = ?",
            (current,),
        ).fetchone()
        if not row:
            break
        item = dict(row)
        item["title"] = truncate(item["title"] or item["summary"] or item["query"] or "(untitled)", 70)
        chain.append(item)
        current = row["parent_session_id"]
    # Root first.
    chain.reverse()
    emit(
        [{k: c[k] for k in ("id", "title", "status", "created_at")} for c in chain],
        as_json=args.json,
    )


def cmd_approvals(conn: sqlite3.Connection, args: argparse.Namespace) -> None:
    sid = resolve_session_id(conn, args.session)
    rows = [
        dict(r) for r in conn.execute(
            "SELECT id, tool_name, status, created_at, responded_at, comment "
            "FROM approvals WHERE session_id = ? ORDER BY created_at",
            (sid,),
        )
    ]
    emit(rows, as_json=args.json)


def cmd_stats(conn: sqlite3.Connection, args: argparse.Namespace) -> None:
    status_rows = [
        dict(r) for r in conn.execute(
            "SELECT status, COUNT(*) AS n FROM sessions GROUP BY status ORDER BY n DESC"
        )
    ]
    totals = {
        "sessions": conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0],
        "conversation_events": conn.execute("SELECT COUNT(*) FROM conversation_events").fetchone()[0],
        "approvals": conn.execute("SELECT COUNT(*) FROM approvals").fetchone()[0],
        "file_snapshots": conn.execute("SELECT COUNT(*) FROM file_snapshots").fetchone()[0],
        "questions": conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0],
    }
    version = conn.execute(
        "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
    ).fetchone()[0]

    if args.json:
        print(json.dumps({"totals": totals, "by_status": status_rows, "schema_version": version}, indent=2))
        return
    print(f"schema_version: {version}")
    print("totals:")
    for k, v in totals.items():
        print(f"  {k:>22}: {v}")
    print("sessions by status:")
    for r in status_rows:
        print(f"  {r['status']:>22}: {r['n']}")


# ---------- CLI ----------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--db", type=Path, default=DEFAULT_DB,
                   help=f"Path to daemon SQLite DB (default: {DEFAULT_DB})")
    p.add_argument("--json", action="store_true", help="Emit JSON instead of tables")
    sub = p.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("recent", help="List most recently active sessions")
    pr.add_argument("--limit", type=int, default=15)
    pr.set_defaults(func=cmd_recent)

    ps = sub.add_parser("search", help="Find sessions by text in title/summary/query")
    ps.add_argument("term")
    ps.add_argument("--limit", type=int, default=30)
    ps.add_argument("--include-archived", action="store_true",
                    help="Include archived/draft/discarded sessions")
    ps.set_defaults(func=cmd_search)

    psh = sub.add_parser("show", help="Show full metadata for a session")
    psh.add_argument("session", help="Session ID or unique prefix")
    psh.set_defaults(func=cmd_show)

    pt = sub.add_parser("transcript", help="Dump conversation events for a session")
    pt.add_argument("session", help="Session ID or unique prefix")
    pt.add_argument("--types", help="Comma-sep event_type filter (message,tool_call,tool_result,thinking)")
    pt.add_argument("--limit", type=int, default=0, help="Max events rendered (0 = all)")
    pt.add_argument("--max-content", type=int, default=2000,
                    help="Truncate each event body to N chars (0 = no truncation)")
    pt.add_argument("--follow-parents", action="store_true",
                    help="Include events from parent/resumed Claude sessions in chain order")
    pt.set_defaults(func=cmd_transcript)

    pp = sub.add_parser("parents", help="Show parent-session chain (root first)")
    pp.add_argument("session")
    pp.set_defaults(func=cmd_parents)

    pa = sub.add_parser("approvals", help="List tool approvals for a session")
    pa.add_argument("session")
    pa.set_defaults(func=cmd_approvals)

    pst = sub.add_parser("stats", help="Global row counts and schema version")
    pst.set_defaults(func=cmd_stats)

    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    conn = open_db(args.db)
    try:
        args.func(conn, args)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
