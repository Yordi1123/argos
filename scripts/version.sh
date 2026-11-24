#!/usr/bin/env bash
# Sincroniza la versión de ARGOS (SemVer) en frontend y backend. Política: docs/versionado.md
# Uso:
#   ./scripts/version.sh              muestra las versiones actuales y si coinciden
#   ./scripts/version.sh 1.0.0-alpha.2   fija la nueva versión en todos los archivos
set -euo pipefail
cd "$(dirname "$0")/.."

FRONT=frontend/argos-glass
BACK=backend/app/main.py
SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$'

v_front() { node -p "require('./$FRONT/package.json').version"; }
v_back()  { sed -nE 's/^VERSION = "([^"]+)"/\1/p' "$BACK"; }
v_log()   { sed -nE 's/^## \[([0-9][^]]*)\].*/\1/p' CHANGELOG.md | head -1; }

if [[ $# -eq 0 ]]; then
  f=$(v_front); b=$(v_back); c=$(v_log)
  printf 'frontend   %s\nbackend    %s\nchangelog  %s\n' "$f" "$b" "$c"
  if [[ "$f" == "$b" && "$b" == "$c" ]]; then echo "✓ coinciden"; else echo "✗ no coinciden"; exit 1; fi
  exit 0
fi

nueva="$1"
if ! [[ "$nueva" =~ $SEMVER ]]; then
  echo "✗ '$nueva' no es válida. Formato: X.Y.Z o X.Y.Z-(alpha|beta|rc).N" >&2
  exit 2
fi

(cd "$FRONT" && npm version "$nueva" --no-git-tag-version --allow-same-version >/dev/null)
sed -i -E "s/^VERSION = \"[^\"]+\"/VERSION = \"$nueva\"/" "$BACK"

echo "✓ frontend y backend en $nueva"
if [[ "$(v_log)" != "$nueva" ]]; then
  echo "⚠ CHANGELOG.md no tiene la sección '## [$nueva] - $(date +%F)'. Muévela desde [Sin publicar] antes de publicar."
fi
