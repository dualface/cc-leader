#!/usr/bin/env bash
set -euo pipefail

CLAUDE_SKILLS_DIR="${HOME}/.claude/skills"
LOCAL_BIN_DIR="${HOME}/.local/bin"
WRAPPER_PATH="${LOCAL_BIN_DIR}/cc-leader"

log() {
  printf '%s\n' "$1"
}

warn() {
  printf '警告: %s\n' "$1" >&2
}

main() {
  local removed_skills=0
  local candidate
  local wrapper_removed="否"

  if [[ -d "$CLAUDE_SKILLS_DIR" ]]; then
    shopt -s nullglob
    for candidate in "${CLAUDE_SKILLS_DIR}"/cc-leader--*; do
      if [[ -L "$candidate" ]]; then
        rm -f "$candidate"
        removed_skills=$((removed_skills + 1))
        log "已删除 skill 链接: $(basename "$candidate")"
      elif [[ -e "$candidate" ]]; then
        warn "$(basename "$candidate") 不是 symlink, 已跳过"
      fi
    done
    shopt -u nullglob
  fi

  if [[ -e "$WRAPPER_PATH" || -L "$WRAPPER_PATH" ]]; then
    rm -rf "$WRAPPER_PATH"
    wrapper_removed="是"
    log "已删除 wrapper: ${WRAPPER_PATH}"
  fi

  cat <<EOF
卸载完成
- 已删除 skill 链接: ${removed_skills} 个
- 已删除 wrapper: ${wrapper_removed}
- wrapper 路径: ${WRAPPER_PATH}
EOF
}

main "$@"
