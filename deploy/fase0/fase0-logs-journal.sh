#!/usr/bin/env bash
# Voice Traductor Fase 0 — captura la consola de la unidad systemd `vt-fase0`
# (código original de Google) con marca de tiempo UTC en milisegundos y redacción
# de handles y claves, y la guarda para la evidencia. No toca la aplicación.
#
# Uso (en el VPS, como root):
#   nohup /opt/vt-fase0/fase0-logs-journal.sh > /dev/null 2>&1 &   # arranca en segundo plano
#   tail -f /opt/vt-fase0/evidencia/consola-dev.txt                 # ver en vivo
#   pkill -f fase0-logs-journal.sh                                   # detener la captura
set -euo pipefail
BASE="${VT_BASE:-/opt/vt-fase0}"
OUT="${1:-$BASE/evidencia/consola-dev.txt}"
mkdir -p "$(dirname "$OUT")"

echo "# consola-dev.txt | inicio $(date -u +%Y-%m-%dT%H:%M:%S.%3NZ) | vps=$(hostname) | unidad=vt-fase0 | node=$("$BASE/node/bin/node" --version 2>/dev/null || echo '?') | app=$(git -C "$BASE/app" rev-parse HEAD 2>/dev/null || echo '?')" >> "$OUT"

# -o short-iso-precise: 2026-10-08T15:05:01.123456+0000 node[1234]: mensaje
# Se recorta a milisegundos y se quita "node[pid]: " para que el analizador lo lea.
journalctl --utc -u vt-fase0 -n 0 -f -o short-iso-precise --no-hostname 2>&1 \
  | sed -u -E \
      -e 's/^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3})[0-9]*\+0000 [^ ]+\[[0-9]+\]: /\1Z /' \
      -e 's/(with handle: )([^ .]{6})[^ .]*/\1\2...[redactado]/' \
      -e 's/("(handle|newHandle)"[[:space:]]*:[[:space:]]*")([^"]{6})[^"]*"/\1\3...[redactado]"/' \
      -e 's/(key=)[A-Za-z0-9_-]{8,}/\1[redactado]/g' \
      -e 's/AIza[A-Za-z0-9_-]{20,}/AIza[redactado]/g' \
  | tee -a "$OUT"
