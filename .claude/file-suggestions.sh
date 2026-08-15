#!/bin/bash
QUERY=$(jq -r '.query // ""')
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 1

{
  # Main search - respects .gitignore
  rg --files --follow --hidden . 2>/dev/null
  
  # Include specific gitignored paths
  [ -e logs ] && rg --files --follow --hidden --no-ignore-vcs logs 2>/dev/null
  [ -e thoughts/searchable ] && rg --files --follow --hidden --no-ignore-vcs thoughts/searchable 2>/dev/null
} | sort -u | fzf --filter "$QUERY" | head -15
