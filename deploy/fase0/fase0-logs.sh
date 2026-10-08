#!/usr/bin/env bash
# Fase 0 — captura la consola del contenedor `app` (código original de Google)
# con marca de tiempo UTC en milisegundos y redacción de handles y claves,
# y la guarda para la evidencia. No toca la aplicación: solo lee sus logs.
#
# Uso (en el VPS, dentro de /srv/fase0):
#   nohup ./fase0-logs.sh > /dev/null 2>&1 &      # arranca la captura en segundo plano
#   tail -f evidencia/consola-dev.txt              # ver en vivo
#   pkill -f fase0-logs.sh                         # detener la captura
#
# Salida: /srv/fase0/evidencia/consola-dev.txt (o la ruta pasada como primer argumento).
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-evidencia/consola-dev.txt}"
mkdir -p "$(dirname "$OUT")"

{
  echo "# consola-dev.txt | inicio $(date -u +%Y-%m-%dT%H:%M:%S.%3NZ) | vps=$(hostname) | docker=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ,) | app=$(git -C app rev-parse HEAD 2>/dev/null || echo '?')"
} >> "$OUT"

# -t: marca de tiempo RFC3339 con nanosegundos; se recorta a milisegundos.
# sed -u: sin búfer, para ver cada línea al instante.
docker compose logs -f -t --no-log-prefix app 2>&1 \
  | sed -u -E \
      -e 's/^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3})[0-9]*Z/\1Z/' \
      -e 's/(with handle: )([^ .]{6})[^ .]*/\1\2...[redactado]/' \
      -e 's/("(handle|newHandle)"[[:space:]]*:[[:space:]]*")([^"]{6})[^"]*"/\1\3...[redactado]"/' \
      -e 's/(key=)[A-Za-z0-9_-]{8,}/\1[redactado]/g' \
      -e 's/AIza[A-Za-z0-9_-]{20,}/AIza[redactado]/g' \
  | tee -a "$OUT"
