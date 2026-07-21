#!/usr/bin/env bash
# setup-symlinks.sh — agents-kit kit/ 을 각 클라이언트에 연결 (레거시)
set -euo pipefail

AGENTS_KIT="${AGENTS_KIT:-$(cd "$(dirname "$0")/.." && pwd)}"
KIT="${AGENTS_KIT}/kit"
HOME_DIR="${HOME}"

echo "agents-kit: $AGENTS_KIT"
echo "kit: $KIT"

link_file() {
  local src="$1"
  local dest="$2"
  if [[ -L "$dest" ]]; then
    echo "  skip (symlink exists): $dest"
  elif [[ -e "$dest" ]]; then
    echo "  WARN: $dest exists and is not a symlink — backup to ${dest}.bak"
    mv "$dest" "${dest}.bak"
    ln -s "$src" "$dest"
    echo "  linked: $dest -> $src"
  else
    mkdir -p "$(dirname "$dest")"
    ln -s "$src" "$dest"
    echo "  linked: $dest -> $src"
  fi
}

link_dir_merge() {
  local src_dir="$1"
  local dest_dir="$2"
  mkdir -p "$dest_dir"
  for skill in "$src_dir"/*/; do
    [[ -d "$skill" ]] || continue
    name="$(basename "$skill")"
    link_file "$skill" "$dest_dir/$name"
  done
}

echo ""
echo "== Codex =="
mkdir -p "$HOME_DIR/.codex"
link_file "$KIT/harness/AGENTS.md" "$HOME_DIR/.codex/AGENTS.md"
link_dir_merge "$KIT/skills" "$HOME_DIR/.codex/skills"
mkdir -p "$HOME_DIR/.codex/automations"
link_file "$KIT/adapters/codex/daily-docs-sweep.toml" \
  "$HOME_DIR/.codex/automations/daily-docs-sweep.toml"

echo ""
echo "== Cursor =="
mkdir -p "$HOME_DIR/.cursor/skills"
link_dir_merge "$KIT/skills" "$HOME_DIR/.cursor/skills"

echo ""
echo "== Antigravity (Gemini) =="
AG_DIR="$HOME_DIR/.gemini/config"
mkdir -p "$AG_DIR"
link_file "$KIT/harness/AGENTS.md" "$AG_DIR/AGENTS.md"

echo ""
echo "Done. Prefer: agents-kit apply"
echo "  Optional project symlinks:"
echo "  ln -s $KIT/loops ./loops"
echo "  ln -s $KIT/harness/AGENTS.md ./AGENTS.md"
