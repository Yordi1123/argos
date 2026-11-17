#!/usr/bin/env bash
# Respaldo al cierre de cada sesión: volcado de la base + copia de evidencias.
# Uso: ./scripts/respaldo.sh [carpeta_destino]
set -euo pipefail
cd "$(dirname "$0")/.."

destino="${1:-respaldos}"
marca="$(date +%Y%m%d_%H%M%S)"
carpeta="$destino/argos_$marca"
mkdir -p "$carpeta"

set -a; source .env; set +a

echo "→ Volcando base de datos…"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$carpeta/argos.dump"

echo "→ Copiando evidencias…"
tar -czf "$carpeta/evidencias.tar.gz" -C data evidencias

echo "→ Calculando sumas de verificación…"
( cd "$carpeta" && sha256sum argos.dump evidencias.tar.gz > SHA256SUMS )

echo "✓ Respaldo listo en $carpeta"
echo "  Restaurar base: docker compose exec -T db pg_restore -U \$POSTGRES_USER -d \$POSTGRES_DB --clean < $carpeta/argos.dump"
