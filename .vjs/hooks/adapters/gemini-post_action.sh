#!/usr/bin/env bash
# Thin adapter (REG-HOOKS-001). Runtime: gemini Event: post_action
root="$(git rev-parse --show-toplevel 2>/dev/null)"
args=(); for p in "$@"; do args+=(--path "$p"); done
[ -x "$root/bin/vjs" ] && exec "$root/bin/vjs" hook --event post_action "${args[@]}"
exec vjs hook --event post_action "${args[@]}"
