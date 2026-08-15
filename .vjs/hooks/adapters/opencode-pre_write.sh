#!/usr/bin/env bash
# Thin adapter (REG-HOOKS-001). Runtime: opencode Event: pre_write
root="$(git rev-parse --show-toplevel 2>/dev/null)"
args=(); for p in "$@"; do args+=(--path "$p"); done
[ -x "$root/bin/vjs" ] && exec "$root/bin/vjs" hook --event pre_write "${args[@]}"
exec vjs hook --event pre_write "${args[@]}"
