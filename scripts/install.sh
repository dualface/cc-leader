#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SKILLS_SOURCE_DIR="${REPO_ROOT}/skills"
CLAUDE_SKILLS_DIR="${HOME}/.claude/skills"
LOCAL_BIN_DIR="${HOME}/.local/bin"
WRAPPER_PATH="${LOCAL_BIN_DIR}/cc-leader"

log() {
  printf '%s\n' "$1"
}

warn() {
  printf '警告: %s\n' "$1" >&2
}

ensure_dir() {
  local dir_path="$1"
  if [[ ! -d "$dir_path" ]]; then
    mkdir -p "$dir_path"
    log "已创建目录: ${dir_path}"
  fi
}

ensure_skill_link() {
  local skill_dir="$1"
  local skill_name
  local source_path
  local target_path
  local current_path

  skill_name="$(basename "$skill_dir")"
  source_path="$(cd -- "$skill_dir" && pwd -P)"
  target_path="${CLAUDE_SKILLS_DIR}/cc-leader--${skill_name}"

  if [[ -L "$target_path" ]]; then
    current_path="$(cd -- "$target_path" && pwd -P)"
    if [[ "$current_path" == "$source_path" ]]; then
      log "skill 已存在, 跳过: cc-leader--${skill_name}"
      return
    fi
    rm -rf "$target_path"
    log "skill 链接已修正: cc-leader--${skill_name}"
  elif [[ -e "$target_path" ]]; then
    rm -rf "$target_path"
    log "skill 目标已重建: cc-leader--${skill_name}"
  else
    log "skill 已注册: cc-leader--${skill_name}"
  fi

  ln -s "$source_path" "$target_path"
}

ensure_wrapper() {
  local expected

  expected=$(cat <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec node "${REPO_ROOT}/scripts/cc-leader-harness.mjs" "\$@"
EOF
)

  if [[ -f "$WRAPPER_PATH" ]] && [[ "$(cat "$WRAPPER_PATH")" == "$expected" ]]; then
    chmod +x "$WRAPPER_PATH"
    log "wrapper 已存在, 跳过: ${WRAPPER_PATH}"
    return
  fi

  if [[ -e "$WRAPPER_PATH" || -L "$WRAPPER_PATH" ]]; then
    rm -rf "$WRAPPER_PATH"
  fi

  printf '%s\n' "$expected" >"$WRAPPER_PATH"
  chmod +x "$WRAPPER_PATH"
  log "wrapper 已写入: ${WRAPPER_PATH}"
}

check_path_warning() {
  case ":${PATH}:" in
    *":${LOCAL_BIN_DIR}:"*)
      return
      ;;
    *)
      warn "${LOCAL_BIN_DIR} 不在 PATH 中。请手动加入后再直接使用 cc-leader。"
      ;;
  esac
}

main() {
  local skill_count=0
  local skill_dir

  if [[ ! -d "$SKILLS_SOURCE_DIR" ]]; then
    printf '错误: 未找到 skills 目录: %s\n' "$SKILLS_SOURCE_DIR" >&2
    exit 1
  fi

  ensure_dir "$CLAUDE_SKILLS_DIR"
  ensure_dir "$LOCAL_BIN_DIR"

  shopt -s nullglob
  for skill_dir in "$SKILLS_SOURCE_DIR"/*; do
    [[ -d "$skill_dir" ]] || continue
    ensure_skill_link "$skill_dir"
    skill_count=$((skill_count + 1))
  done
  shopt -u nullglob

  if [[ "$skill_count" -eq 0 ]]; then
    printf '错误: skills/ 下没有可注册的 skill 目录\n' >&2
    exit 1
  fi

  ensure_wrapper
  check_path_warning

  log "开始校验仓库完整性: npm run validate"
  (
    cd "$REPO_ROOT"
    npm run validate
  )

  cat <<EOF
安装完成
- 已注册 skill: ${skill_count} 个
- wrapper 路径: ${WRAPPER_PATH}
- 使用方式:
  cd <目标项目根目录>
  cc-leader init --slug <project-slug>
  cc-leader state:set --set spec_path=<spec-file-path>
EOF
}

main "$@"
