# Fase 0 en un VPS compartido con Nginx — instalación aislada, prueba y desinstalación

Para el VPS que ya corre **Guardian** (Ubuntu 24.04.5, 4 vCPU, 15 GiB, Nginx 1.24 en 80/443, MySQL en 127.0.0.1:3306, sin Docker ni Node). Este documento **no instala Caddy ni Docker, no reemplaza Nginx, no toca los sitios ni los servicios de Guardian**. Voice Traductor Fase 0 queda en una carpeta, un usuario, un puerto interno, una unidad `systemd` y un archivo de vhost propios, y se desinstala por completo al final (Parte E).

Qué corre: el **código original de Google** (`gemini-live-translate-livekit`, commit `26d9a620a85410ad8c902106d3a4d3a4edfd2968`) sin modificaciones funcionales, construido y ejecutado **exactamente como su `Dockerfile`** (`npm ci` → `npm run build` → `node server.js` del build standalone con `PORT` y `NODE_ENV=production`), pero sin contenedor: Node 22.22.0 autocontenido en la carpeta del proyecto y una unidad `systemd` que escucha solo en `127.0.0.1`. Nginx publica `https://fase0.<tu-dominio>`.

Formato: cada paso dice **Ejecuta**, **Resultado esperado** y **Si sale otra cosa**. Regla general: si sale otra cosa, **no improvises**: copia la salida completa (sin claves) y envíamela.

Reutilización: para el VPS definitivo cambian solo las variables del PASO 0 (dominio, puerto, carpeta, usuario) y la Parte E no se ejecuta. Para un VPS limpio sin Nginx existe la variante Docker + Caddy en `README.md` de esta carpeta.

---

## PASO 0 · Variables de esta instalación (repetir al inicio de cada sesión SSH)

Cada vez que abras una sesión SSH nueva, pega este bloque primero. Son los únicos valores que cambian entre este VPS y el definitivo.

Ejecuta:
```bash
export VT_DOMAIN="fase0.TU-DOMINIO"          # subdominio de la prueba (registro A → IP del VPS)
export VT_EMAIL="tu-correo@ejemplo.org"      # para los avisos de Let's Encrypt
export VT_PORT="3020"                        # puerto interno exclusivo (se verifica libre en el PASO 3)
export VT_BASE="/opt/vt-fase0"               # carpeta exclusiva
export VT_USER="vtfase0"                     # usuario de servicio exclusivo
export VT_NODE_VER="22.22.0"                 # Node autocontenido (misma versión mayor que node:22-slim de Google)
export VT_NODE_SHA="9aa8e9d2298ab68c600bd6fb86a6c13bce11a4eca1ba9b39d79fa021755d7c37"
export VT_APP_COMMIT="26d9a620a85410ad8c902106d3a4d3a4edfd2968"
export VT_LAB_BRANCH="claude/happy-lovelace-7x2zam"
export VT_RESPALDO="/root/respaldos-fase0"
echo "dominio=$VT_DOMAIN puerto=$VT_PORT base=$VT_BASE usuario=$VT_USER"
```

Resultado esperado: una línea `dominio=... puerto=3020 base=/opt/vt-fase0 usuario=vtfase0` con tu dominio real.

Si sale otra cosa: revisa que no haya espacios en los valores y repite.

---

# PARTE A · Diagnóstico SOLO LECTURA y respaldo (nada cambia en el VPS)

Todos los comandos de esta parte solo leen. Al terminar la Parte A, **envíame las salidas** (puedes tachar nombres de usuario o rutas de Guardian si lo prefieres; no contienen claves) y espera mi confirmación antes de la Parte B.

## PASO 1 · Identidad del servidor

Ejecuta:
```bash
hostnamectl; echo; id; echo; lsb_release -ds; uname -rm; nproc; free -h | head -2; df -h / /opt 2>/dev/null
```

Resultado esperado: Ubuntu 24.04.x, x86_64, 4 CPU, ≈ 15 GiB, y ≥ 20 GB libres en `/` (o en `/opt`). El `id` debe decir `uid=0(root)`.

Si sale otra cosa: si no eres root, antepón `sudo -i` y repite; si hay menos de 10 GB libres, envíame la salida de `df -h`.

## PASO 2 · Puertos en uso (para elegir uno libre y no tocar los de Guardian)

Ejecuta:
```bash
ss -tlnp | awk 'NR==1 || /LISTEN/' | sort -k4
```

Resultado esperado: una tabla con `0.0.0.0:80` y `0.0.0.0:443` (nginx), `127.0.0.1:3306` (mysqld), `:22` (sshd) y los puertos internos que use Guardian (por ejemplo `127.0.0.1:3000`, `127.0.0.1:8000`, etc.). **Anota todos los puertos que aparezcan.**

Si sale otra cosa: envíame la tabla completa; con ella confirmo el puerto `VT_PORT`.

## PASO 3 · Confirmar que el puerto elegido está libre

Ejecuta:
```bash
ss -tln | grep -q ":${VT_PORT} " && echo "OCUPADO: cambia VT_PORT" || echo "LIBRE: ${VT_PORT}"
```

Resultado esperado: `LIBRE: 3020`.

Si sale otra cosa: elige otro puerto entre 3021 y 3099 que no esté en la tabla del PASO 2, cambia `VT_PORT` en el PASO 0 y repite.

## PASO 4 · Servicios en ejecución y herramientas presentes (lo que no debemos tocar)

Ejecuta:
```bash
systemctl list-units --type=service --state=running --no-pager --no-legend | awk '{print $1}'
echo "--- herramientas"; for b in node npm pm2 docker certbot acme.sh nginx mysql; do printf "%-9s %s\n" "$b" "$(command -v $b || echo 'no instalado')"; done
echo "--- node del sistema"; command -v node >/dev/null && node --version || echo "sin node"
echo "--- pm2"; command -v pm2 >/dev/null && pm2 list 2>/dev/null | head -20 || echo "sin pm2"
echo "--- usuario vtfase0"; id "${VT_USER}" 2>/dev/null || echo "no existe (bien)"
echo "--- carpeta"; ls -ld "${VT_BASE}" 2>/dev/null || echo "no existe (bien)"
```

Resultado esperado: la lista de servicios (nginx, mysql, ssh, los de Guardian); `node`, `npm`, `docker` "no instalado" (según tu inspección); `nginx` en `/usr/sbin/nginx`; `certbot` instalado o no (lo decide el PASO 6); el usuario `vtfase0` y la carpeta `/opt/vt-fase0` **no existen**.

Si sale otra cosa: si existe `node` o `pm2`, **no se tocan**: Fase 0 usa su propio Node en `/opt/vt-fase0/node`. Si el usuario o la carpeta ya existen, detente y envíame la salida.

## PASO 5 · Configuración de Nginx relevante (solo lectura)

Ejecuta:
```bash
nginx -v; nginx -t
echo "--- sitios habilitados"; ls -la /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
echo "--- resumen de vhosts"; nginx -T 2>/dev/null | grep -E "^\s*(server_name|listen|ssl_certificate |root |proxy_pass|include /etc/nginx/sites)" | sed 's/^\s*//' | sort | uniq -c | sort -rn | head -60
echo "--- fase0 ya existe?"; grep -rl "${VT_DOMAIN}\|vt-fase0" /etc/nginx/ 2>/dev/null || echo "no hay rastro de fase0 (bien)"
```

Resultado esperado: `nginx/1.24.0`, `syntax is ok` y `test is successful`; archivos de los sitios de Guardian en `sites-enabled/`; en el resumen, `server_name` de `guardianrank.com`, `app.guardianrank.com`, `master.guardianrank.com`, sus `listen 443 ssl`, sus `ssl_certificate` (rutas `/etc/letsencrypt/live/...` u otras) y sus `proxy_pass`; `include /etc/nginx/sites-enabled/*` presente en `nginx.conf`; ningún rastro de fase0.

Si sale otra cosa: si `nginx -t` falla, **detente**: Nginx ya tiene un problema previo que no es nuestro; envíame la salida. Si no existe `include /etc/nginx/sites-enabled/*`, envíame la salida: habría que ubicar el vhost en `conf.d/`.

## PASO 6 · Cómo se administran hoy los certificados

Ejecuta:
```bash
echo "--- certbot"; command -v certbot && certbot --version 2>/dev/null
echo "--- certificados"; certbot certificates 2>/dev/null || echo "(certbot no instalado o sin certificados)"
echo "--- renovaciones"; ls -la /etc/letsencrypt/renewal/ 2>/dev/null || echo "(sin /etc/letsencrypt/renewal)"
echo "--- temporizadores"; systemctl list-timers --all --no-pager 2>/dev/null | grep -iE "certbot|acme|snap" || echo "(sin temporizador de certbot)"
echo "--- otros"; ls -la ~/.acme.sh 2>/dev/null | head -3 || echo "(sin acme.sh)"
echo "--- cloudflare?"; grep -rl "cloudflare\|CF-Connecting-IP" /etc/nginx/ 2>/dev/null || echo "(sin rastro de Cloudflare en nginx)"
```

Resultado esperado (caso más común en Ubuntu con Nginx): `certbot` instalado (`/usr/bin/certbot` o `/snap/bin/certbot`), `certbot certificates` listando los dominios de Guardian con sus fechas, archivos `.conf` en `/etc/letsencrypt/renewal/`, y un temporizador `certbot.timer` o `snap.certbot.renew.timer` activo. Eso significa: **los certificados de Guardian los renueva certbot solo; nosotros emitiremos uno más, para `fase0.<dominio>`, por el método `webroot`, que no toca la configuración de Nginx; se renovará con el mismo temporizador y se borrará en la desinstalación.**

Si sale otra cosa:
- Si **no hay certbot** y los certificados de Guardian están en otra ruta (panel de Hostinger, `acme.sh`, Cloudflare Origin): envíame la salida completa antes de seguir; adaptaré el PASO 19.
- Si certbot existe pero no hay temporizador: envíame `systemctl status certbot.timer` y `cat /etc/cron.d/certbot 2>/dev/null`.

## PASO 7 · Firewall y salida a internet (UDP para WebRTC, HTTPS para Gemini)

Ejecuta:
```bash
echo "--- ufw"; ufw status verbose 2>/dev/null || echo "(ufw no activo o no instalado)"
echo "--- iptables (solo conteo)"; iptables -S 2>/dev/null | wc -l
echo "--- HTTPS a Gemini"; curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 "https://generativelanguage.googleapis.com/\$discovery/rest?version=v1beta"
echo "--- HTTPS a LiveKit"; curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 https://cloud.livekit.io/
echo "--- UDP de salida (STUN)"; python3 - <<'EOF'
import socket, os
m=b"\x00\x01\x00\x00\x21\x12\xa4\x42"+os.urandom(12); s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(4)
try:
    s.sendto(m,("stun.l.google.com",19302)); d,a=s.recvfrom(1024); print("UDP OK:",a)
except Exception as e: print("UDP SIN RESPUESTA:",type(e).__name__)
EOF
```

Resultado esperado: `ufw` con `Status: active`, `Default: deny (incoming), allow (outgoing)` y reglas para 22, 80 y 443 (o `ufw` inactivo si el firewall es el del panel de Hostinger); `200` para Gemini; `200` o `30x` para LiveKit; `UDP OK: (...)`.

Si sale otra cosa: si la salida HTTPS falla o `UDP SIN RESPUESTA`, el puente de Google no podrá unirse a LiveKit desde este VPS: envíame la salida antes de seguir. **No hay que abrir ningún puerto de entrada nuevo**: Nginx ya atiende 80 y 443.

## PASO 8 · DNS del subdominio de la prueba

Primero crea en tu DNS el registro **A** `fase0` → IP pública del VPS (sin proxy de Cloudflare si puedes elegir; con proxy también funciona). Luego:

Ejecuta:
```bash
echo "IP del VPS: $(curl -sS --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')"
echo "DNS de ${VT_DOMAIN}: $(getent hosts "${VT_DOMAIN}" | awk '{print $1}' || echo 'sin resolver')"
```

Resultado esperado: las dos IP iguales.

Si sale otra cosa: espera la propagación (5–30 min) y repite. Si usas el proxy de Cloudflare, el DNS mostrará una IP de Cloudflare; en ese caso dímelo.

## PASO 9 · Línea base de Guardian y respaldo de lo que se va a tocar

Lo único que se tocará de Nginx es **agregar** un archivo nuevo en `sites-available` y su enlace en `sites-enabled`, y hacer un `reload` (recarga suave: Nginx termina las peticiones en curso y aplica la configuración nueva sin cortar los sitios). Aun así, respaldamos todo y guardamos huellas para comprobar al final que nada cambió.

Ejecuta:
```bash
mkdir -p "${VT_RESPALDO}" && chmod 700 "${VT_RESPALDO}"
tar czf "${VT_RESPALDO}/nginx-y-letsencrypt-ANTES-$(date -u +%Y%m%dT%H%M%SZ).tgz" /etc/nginx /etc/letsencrypt 2>/dev/null
find /etc/nginx -type f -exec sha256sum {} \; | sort -k2 > "${VT_RESPALDO}/nginx-sha256-ANTES.txt"
systemctl list-units --type=service --state=running --no-pager --no-legend | awk '{print $1}' | sort > "${VT_RESPALDO}/servicios-ANTES.txt"
ss -tln | awk 'NR>1{print $4}' | sort > "${VT_RESPALDO}/puertos-ANTES.txt"
for u in https://guardianrank.com https://app.guardianrank.com https://master.guardianrank.com; do printf "%s -> %s\n" "$u" "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$u")"; done | tee "${VT_RESPALDO}/guardian-http-ANTES.txt"
ls -la "${VT_RESPALDO}"
```

Resultado esperado: un `.tgz`, los tres archivos de huellas y `guardian-http-ANTES.txt` con códigos `200` (o `30x`) para los tres sitios.

Si sale otra cosa: si algún sitio de Guardian no responde `200`/`30x` **antes** de empezar, anótalo: no es nuestro, pero conviene saberlo para la comparación final.

**FIN DE LA PARTE A → envíame las salidas de los pasos 1 a 9 y espera mi confirmación.** Hasta aquí no se cambió nada en el VPS (solo se creó `/root/respaldos-fase0`).

---

# PARTE B · Instalación aislada (solo después de mi confirmación)

## PASO 10 · Usuario y carpetas exclusivos

Ejecuta:
```bash
useradd --system --home-dir "${VT_BASE}" --shell /usr/sbin/nologin --user-group "${VT_USER}"
mkdir -p "${VT_BASE}"/{node,app,run,env,www,evidencia,lab}
chown -R "${VT_USER}:${VT_USER}" "${VT_BASE}"
chmod 750 "${VT_BASE}"; chmod 700 "${VT_BASE}/env"; chown root:root "${VT_BASE}/env"
chown -R "www-data:www-data" "${VT_BASE}/www"; chmod 755 "${VT_BASE}" "${VT_BASE}/www"
id "${VT_USER}"; ls -la "${VT_BASE}"
```

Resultado esperado: `uid=...(vtfase0) gid=...(vtfase0)`; carpetas `node app run env www evidencia lab`; `env` propiedad de `root` con `drwx------`; `www` propiedad de `www-data`.

Si sale otra cosa: si `useradd` dice que el usuario ya existe, detente y envíame `id vtfase0`.

## PASO 11 · Node 22.22.0 autocontenido (no toca el sistema)

Ejecuta:
```bash
cd /tmp && curl -fsSL -o node.tar.xz "https://nodejs.org/dist/v${VT_NODE_VER}/node-v${VT_NODE_VER}-linux-x64.tar.xz"
echo "${VT_NODE_SHA}  node.tar.xz" | sha256sum -c -
tar -xJf node.tar.xz -C "${VT_BASE}/node" --strip-components=1 && rm -f node.tar.xz
chown -R "${VT_USER}:${VT_USER}" "${VT_BASE}/node"
"${VT_BASE}/node/bin/node" --version; "${VT_BASE}/node/bin/npm" --version
command -v node || echo "el sistema sigue sin node (bien)"
```

Resultado esperado: `node.tar.xz: OK`, `v22.22.0`, `10.9.x`, y "el sistema sigue sin node (bien)" (o la versión de Guardian, intacta, si existía).

Si sale otra cosa: si la suma no coincide (`FAILED`), **no continúes**: borra el archivo y envíame la salida.

## PASO 12 · Código original de Google en el commit exacto

Ejecuta:
```bash
sudo -u "${VT_USER}" -H bash -c "cd '${VT_BASE}' && git clone -q https://github.com/google-gemini/gemini-live-translate-livekit.git app && cd app && git checkout -q '${VT_APP_COMMIT}' && git rev-parse HEAD && git status --short | wc -l"
```

Resultado esperado: el hash `26d9a620a85410ad8c902106d3a4d3a4edfd2968` y un `0` (ningún archivo modificado).

Si sale otra cosa: si `git` no está instalado: `apt-get install -y git` y repite (git es la única herramienta del sistema que puede faltar).

## PASO 13 · Dependencias exactas y build (igual que el Dockerfile de Google)

Ejecuta:
```bash
sudo -u "${VT_USER}" -H bash -c "export PATH='${VT_BASE}/node/bin:'\$PATH; cd '${VT_BASE}/app' && npm ci --no-audit --no-fund 2>&1 | tail -3 && npm run build 2>&1 | tail -15"
ls -d "${VT_BASE}"/app/node_modules/@livekit/rtc-ffi-bindings-linux-x64-gnu && echo "binario nativo linux-x64 ok"
```

Resultado esperado: `added 413 packages`, luego el resumen del build con las rutas `/`, `/api/...`, `/session/[id]/broadcast`, `/session/[id]/watch`, y "binario nativo linux-x64 ok". Tarda 1–3 minutos.

Si sale otra cosa: envíame las últimas 40 líneas (`npm run build 2>&1 | tail -40`).

## PASO 14 · Armar la carpeta de ejecución como lo hace el Dockerfile

El `Dockerfile` de Google copia `.next/standalone` → `/app`, `.next/static` → `/app/.next/static` y `public` → `/app/public`, y ejecuta `node server.js`. Hacemos lo mismo en `${VT_BASE}/run`.

Ejecuta:
```bash
rm -rf "${VT_BASE}/run" && mkdir -p "${VT_BASE}/run"
cp -a "${VT_BASE}/app/.next/standalone/." "${VT_BASE}/run/"
mkdir -p "${VT_BASE}/run/.next" && cp -a "${VT_BASE}/app/.next/static" "${VT_BASE}/run/.next/static"
cp -a "${VT_BASE}/app/public" "${VT_BASE}/run/public"
chown -R "${VT_USER}:${VT_USER}" "${VT_BASE}/run"
ls "${VT_BASE}/run"; ls "${VT_BASE}/run/.next"
```

Resultado esperado: en `run`: `node_modules  package.json  public  server.js  .next`; en `run/.next`: `static` (y lo que el build dejó dentro de `standalone/.next`).

Si sale otra cosa: envíame la salida de los dos `ls`.

## PASO 15 · Secretos: escribirlos SOLO aquí, nunca en el chat

Ejecuta:
```bash
cat > "${VT_BASE}/env/fase0.env" <<'EOF'
GEMINI_API_KEY=
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
BROADCAST_PASSWORD=
EOF
chmod 600 "${VT_BASE}/env/fase0.env"; chown root:root "${VT_BASE}/env/fase0.env"
nano "${VT_BASE}/env/fase0.env"
```

En `nano`, completa cada línea después del `=` (sin comillas ni espacios): tu clave de Gemini, `wss://<tu-proyecto>.livekit.cloud`, la clave y el secreto de LiveKit, y una contraseña nueva de 20+ caracteres para la cabina. Guarda con `Ctrl+O`, `Enter`, `Ctrl+X`. Luego comprueba sin mostrar valores:

Ejecuta:
```bash
awk -F= '/^[A-Z_]+=/{print $1": "(length($2)>0?"ok":"VACIA")}' "${VT_BASE}/env/fase0.env"; ls -la "${VT_BASE}/env/"
```

Resultado esperado: las cinco variables con `ok` y el archivo con `-rw------- root root`.

Si sale otra cosa: vuelve a `nano` y completa la que diga `VACIA`.

## PASO 16 · Unidad systemd (escucha solo en 127.0.0.1)

Ejecuta:
```bash
cd /tmp && curl -fsSL -o vt-fase0.service.template "https://raw.githubusercontent.com/soldiersebasti/voice-traductor/${VT_LAB_BRANCH}/deploy/fase0/vt-fase0.service.template" \
  || echo "DESCARGA FALLIDA (repositorio privado): usa el PASO 16-bis"
sed -e "s#__VT_BASE__#${VT_BASE}#g" -e "s#__VT_USER__#${VT_USER}#g" -e "s#__VT_PORT__#${VT_PORT}#g" vt-fase0.service.template > /etc/systemd/system/vt-fase0.service
rm -f vt-fase0.service.template
systemctl daemon-reload && systemctl enable --now vt-fase0 && sleep 4 && systemctl --no-pager --lines=8 status vt-fase0
```

Resultado esperado: `Active: active (running)`, y en las líneas del journal `▲ Next.js 16.2.6`, `- Local: http://127.0.0.1:3020` y `✓ Ready`.

Si sale otra cosa: `journalctl -u vt-fase0 -n 50 --no-pager` y envíame la salida (sin claves: el servicio no las imprime).

**PASO 16-bis (solo si la descarga falló porque el laboratorio es privado):** clona el laboratorio una vez con tu token y toma las plantillas de ahí:
```bash
git -C "${VT_BASE}/lab" clone -q -b "${VT_LAB_BRANCH}" https://github.com/soldiersebasti/voice-traductor.git . 2>/dev/null || git clone -q -b "${VT_LAB_BRANCH}" https://github.com/soldiersebasti/voice-traductor.git "${VT_BASE}/lab"
cp "${VT_BASE}/lab/deploy/fase0/vt-fase0.service.template" /tmp/vt-fase0.service.template
```
y repite las líneas `sed ...`, `systemctl ...` del PASO 16. (Al pedir credenciales: usuario de GitHub y el token como contraseña; para no repetirlo: `git config --global credential.helper 'cache --timeout=7200'`.)

## PASO 17 · Comprobar la app por el puerto interno

Ejecuta:
```bash
curl -s "http://127.0.0.1:${VT_PORT}/api/auth/status"; echo
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:${VT_PORT}/"
ss -tlnp | grep ":${VT_PORT} "
```

Resultado esperado: `{"passwordRequired":true}`, `200`, y una línea `127.0.0.1:3020 ... users:(("node",...))`. **Solo** `127.0.0.1`: desde fuera no se ve.

Si sale otra cosa: si dice `"passwordRequired":false`, el archivo de secretos no se cargó (revisa el PASO 15 y `systemctl restart vt-fase0`).

## PASO 18 · Vhost provisional HTTP (solo para emitir el certificado)

Ejecuta:
```bash
cd /tmp && curl -fsSL -o paso1.template "https://raw.githubusercontent.com/soldiersebasti/voice-traductor/${VT_LAB_BRANCH}/deploy/fase0/nginx-fase0-paso1-http.conf.template" 2>/dev/null || cp "${VT_BASE}/lab/deploy/fase0/nginx-fase0-paso1-http.conf.template" paso1.template
sed -e "s#__VT_DOMAIN__#${VT_DOMAIN}#g" paso1.template > /etc/nginx/sites-available/vt-fase0.conf && rm -f paso1.template
ln -s /etc/nginx/sites-available/vt-fase0.conf /etc/nginx/sites-enabled/vt-fase0.conf
nginx -t && systemctl reload nginx && echo "RECARGADO"
mkdir -p "${VT_BASE}/www/.well-known/acme-challenge" && echo ok > "${VT_BASE}/www/.well-known/acme-challenge/prueba.txt" && chown -R www-data:www-data "${VT_BASE}/www"
curl -s "http://${VT_DOMAIN}/.well-known/acme-challenge/prueba.txt"; rm -f "${VT_BASE}/www/.well-known/acme-challenge/prueba.txt"
```

Resultado esperado: `syntax is ok`, `test is successful`, `RECARGADO`, y `ok` (Nginx sirve el webroot del subdominio). Los sitios de Guardian siguen igual: `reload` no corta conexiones.

Si sale otra cosa: si `nginx -t` falla, **quita el enlace** (`rm /etc/nginx/sites-enabled/vt-fase0.conf`) para no dejar Nginx con un archivo malo y envíame el error. Si el `curl` no devuelve `ok`, revisa el DNS (PASO 8).

## PASO 19 · Certificado HTTPS para el subdominio (webroot; no toca Nginx)

Si `certbot` no estaba instalado (PASO 6), instálalo primero: `apt-get install -y certbot` (paquete de Ubuntu, sin plugin de Nginx; no cambia nada de Guardian).

Ejecuta:
```bash
certbot certonly --webroot -w "${VT_BASE}/www" -d "${VT_DOMAIN}" --non-interactive --agree-tos -m "${VT_EMAIL}" --no-eff-email
ls -la "/etc/letsencrypt/live/${VT_DOMAIN}/"
```

Resultado esperado: `Successfully received certificate` y los archivos `fullchain.pem` y `privkey.pem` en `/etc/letsencrypt/live/fase0.<dominio>/`. La renovación queda a cargo del temporizador de certbot ya existente (PASO 6) con el mismo método webroot.

Si sale otra cosa: envíame la salida completa de certbot (no contiene claves). Causas típicas: DNS aún no propagado; puerto 80 bloqueado en el panel de Hostinger para ese subdominio (no debería: Guardian usa el mismo 80).

## PASO 20 · Vhost definitivo HTTPS

Ejecuta:
```bash
cd /tmp && curl -fsSL -o final.template "https://raw.githubusercontent.com/soldiersebasti/voice-traductor/${VT_LAB_BRANCH}/deploy/fase0/nginx-fase0-final.conf.template" 2>/dev/null || cp "${VT_BASE}/lab/deploy/fase0/nginx-fase0-final.conf.template" final.template
sed -e "s#__VT_DOMAIN__#${VT_DOMAIN}#g" -e "s#__VT_PORT__#${VT_PORT}#g" final.template > /etc/nginx/sites-available/vt-fase0.conf && rm -f final.template
nginx -t && systemctl reload nginx && echo "RECARGADO"
```

Resultado esperado: `syntax is ok`, `test is successful`, `RECARGADO`.

Si sale otra cosa: si `nginx -t` falla, vuelve al vhost provisional (`sed ... paso1.template` del PASO 18) y envíame el error. **No edites los archivos de Guardian.**

## PASO 21 · Comprobaciones desde el VPS

Ejecuta:
```bash
curl -s "https://${VT_DOMAIN}/api/auth/status"; echo
curl -s -o /dev/null -w "HTTPS raíz: %{http_code}\n" "https://${VT_DOMAIN}/"
curl -s -o /dev/null -w "HTTP→HTTPS: %{http_code}\n" "http://${VT_DOMAIN}/"
echo "--- Guardian sigue igual:"; for u in https://guardianrank.com https://app.guardianrank.com https://master.guardianrank.com; do printf "%s -> %s\n" "$u" "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$u")"; done
```

Resultado esperado: `{"passwordRequired":true}`, `HTTPS raíz: 200`, `HTTP→HTTPS: 301`, y los tres sitios de Guardian con los mismos códigos que en `guardian-http-ANTES.txt`.

Si sale otra cosa: envíame la salida y `tail -20 /var/log/nginx/vt-fase0.error.log`.

## PASO 22 · Comprobación desde tu navegador

Abre en el PC: `https://fase0.TU-DOMINIO/`.

Resultado esperado: la página de inicio de la app de Google ("Live Translate"), con candado de HTTPS válido.

Si sale otra cosa: captura de pantalla del error y `tail -20 /var/log/nginx/vt-fase0.error.log`.

## PASO 23 · Registrar el entorno (evidencia) y preparar la captura de consola

Ejecuta:
```bash
{
  echo "fecha: $(date -u +%FT%TZ)"; echo "vps: $(hostname) | $(lsb_release -ds) $(uname -rm) | vcpu $(nproc) | ram $(free -h | awk '/Mem/{print $2}')"
  echo "nginx: $(nginx -v 2>&1)"; echo "node fase0: $("${VT_BASE}/node/bin/node" --version) (autocontenido en ${VT_BASE}/node)"
  echo "app commit: $(git -C "${VT_BASE}/app" rev-parse HEAD)"; echo "unidad: vt-fase0 en 127.0.0.1:${VT_PORT}; vhost: ${VT_DOMAIN}"
  echo "dependencias:"; "${VT_BASE}/node/bin/npm" --prefix "${VT_BASE}/app" ls --depth=0 2>/dev/null | sed 's/^/  /'
} > "${VT_BASE}/evidencia/entorno-vps.txt"; cat "${VT_BASE}/evidencia/entorno-vps.txt"
cd /tmp && curl -fsSL -o "${VT_BASE}/fase0-logs-journal.sh" "https://raw.githubusercontent.com/soldiersebasti/voice-traductor/${VT_LAB_BRANCH}/deploy/fase0/fase0-logs-journal.sh" 2>/dev/null || cp "${VT_BASE}/lab/deploy/fase0/fase0-logs-journal.sh" "${VT_BASE}/fase0-logs-journal.sh"
chmod +x "${VT_BASE}/fase0-logs-journal.sh"; bash -n "${VT_BASE}/fase0-logs-journal.sh" && echo "script ok"
```

Resultado esperado: el archivo `entorno-vps.txt` con sistema, Nginx, Node, commit y dependencias (next 16.2.6, @livekit/rtc-node 0.13.27, etc.), y `script ok`.

Si sale otra cosa: envíame la salida.

**FIN DE LA PARTE B.** La app original de Google corre en `https://fase0.<tu-dominio>`, aislada: carpeta `/opt/vt-fase0`, usuario `vtfase0`, puerto `127.0.0.1:3020`, unidad `vt-fase0`, archivo `/etc/nginx/sites-available/vt-fase0.conf`, certificado `fase0.<dominio>`. Nada más cambió.

---

# PARTE C · La prueba en la iglesia (20–25 minutos)

## URLs

| Quién | URL |
|---|---|
| Inicio (crear el culto de prueba) | `https://fase0.TU-DOMINIO/` |
| **Cabina** | `https://fase0.TU-DOMINIO/session/prueba/broadcast` (la crea el paso 1 de abajo) |
| **Oyente (teléfono)** | `https://fase0.TU-DOMINIO/session/prueba/watch` |

## PASO 24 · Arrancar la captura de consola ANTES de crear el culto (en el VPS)

Ejecuta:
```bash
nohup "${VT_BASE}/fase0-logs-journal.sh" > /dev/null 2>&1 &
sleep 1; tail -f "${VT_BASE}/evidencia/consola-dev.txt"
```

Resultado esperado: la primera línea `# consola-dev.txt | inicio ...` y, a medida que uses la app, líneas con hora UTC. `Ctrl+C` cierra solo el `tail`; la captura sigue aunque cierres SSH.

Si sale otra cosa: `pgrep -af fase0-logs-journal` debe mostrar el proceso; si no, repite el primer comando y envíame la salida.

## PASO 25 · Qué hace la persona de cabina (PC o portátil en la iglesia, con Chrome o Edge)

1. Abre `https://fase0.TU-DOMINIO/`. Escribe en "Event ID" **`prueba`**; en idiomas permitidos deja solo **English**; cuando pida contraseña, escribe la `BROADCAST_PASSWORD`. Pulsa crear.
2. Se abre la página de cabina. Aparece un QR y el enlace del oyente; es la URL de la tabla de arriba.
3. **Cómo entra el audio del sermón.** Dos formas válidas para la Fase 0:
   - **Ensayo con grabación:** abre en otra pestaña el sermón en español (archivo o video, ≥ 25 min seguidos) y dale play. En la cabina pulsa **tab audio** y elige esa pestaña (marca "compartir audio de la pestaña"). Así el audio va directo, sin micrófono.
   - **Pastor en vivo:** en Windows, Configuración → Sonido → **Entrada**: elige la interfaz USB o la entrada de línea donde llega la mezcla de la consola (solo voces; antes del fader). Luego en la cabina pulsa **micrófono**. Aviso honesto: el código original aplica cancelación de eco y supresión de ruido del navegador (se corrige en la Fase 5, cambio O5); para esta prueba es aceptable.
4. Comprueba en la misma página que el medidor de nivel se mueve cuando hay voz, y que en "translators" aparece **English** como activo en cuanto el teléfono elige el idioma (paso 26).
5. No cierres esta página en toda la prueba. Si pide volver a conectar, acepta.

## PASO 26 · Qué hace la persona del teléfono (audífonos de cable)

1. Abre `https://fase0.TU-DOMINIO/session/prueba/watch` (o escanea el QR).
2. Pulsa **Start listening** y elige **English**.
3. En cuanto oiga la primera frase en inglés, anota la hora del teléfono en `observacion-oyente.md` (fila "0 (inicio)"). **Desde ese momento se mide.**
4. **No cierra la página ni bloquea el teléfono** durante la prueba: el código original apaga el canal de Gemini cuando se va el último oyente.

## PASO 27 · Qué observar cada 5 minutos (la persona del teléfono, en `observacion-oyente.md`)

| Minuto | Anota |
|---|---|
| 0, 5, 10, 15, 20, 25 | hora del teléfono · ¿se oye inglés? · retraso a ojo (1, 2, 3 o más segundos desde que el pastor termina una frase hasta que sale en inglés) · silencios mientras el pastor habla · frases repetidas · frases perdidas · si tuvo que tocar Play |
| Minuto 9–10 | Momento esperado de la primera renovación de Gemini. ¿Notó corte, repetición o silencio? |
| **Minuto 15** | Límite documentado de Google para sesiones solo de audio sin `contextWindowCompression` (el código original no lo envía). Anota exactamente qué pasa: sigue igual, se detiene, vuelve solo, cambia la voz. **No se corrige nada.** |
| Minuto 19–20 | Momento esperado de la segunda renovación. |

Mientras tanto, en el VPS, `tail -f` mostrará `Received goAway message from Gemini` y `Gemini reconnect setup complete` en cada renovación, y los cierres con su código.

## PASO 28 · Cómo terminar

1. Llegados a 20–25 minutos (o si la traducción se detuvo y pasaron 3 minutos más sin recuperarse), la persona del teléfono anota la hora final y por qué terminó.
2. En la cabina: **End broadcast**.
3. En el VPS:

Ejecuta:
```bash
pkill -f fase0-logs-journal.sh; sleep 1; pgrep -af fase0-logs-journal || echo "captura detenida"
wc -l "${VT_BASE}/evidencia/consola-dev.txt"; grep -c "goAway" "${VT_BASE}/evidencia/consola-dev.txt"
```

Resultado esperado: `captura detenida`, un número de líneas de cientos o miles, y el número de `goAway` (≥ 1; idealmente 2).

Si sale otra cosa: si `goAway` es `0` y la prueba duró más de 12 minutos, envíame la salida de `grep -n "TranslationBridge" "${VT_BASE}/evidencia/consola-dev.txt" | head -40`.

---

# PARTE D · Análisis, revisión de secretos y entrega de la evidencia

## PASO 29 · Laboratorio en el VPS (con el Node autocontenido)

Ejecuta:
```bash
[ -d "${VT_BASE}/lab/.git" ] || git clone -q -b "${VT_LAB_BRANCH}" https://github.com/soldiersebasti/voice-traductor.git "${VT_BASE}/lab"
export PATH="${VT_BASE}/node/bin:$PATH"; cd "${VT_BASE}/lab" && git pull -q && npm ci --no-audit --no-fund 2>&1 | tail -1
mkdir -p evidencia/fase-0 && cp "${VT_BASE}/evidencia/consola-dev.txt" "${VT_BASE}/evidencia/entorno-vps.txt" evidencia/fase-0/
npm run fase0:analizar -- evidencia/fase-0/consola-dev.txt | head -60
```

Resultado esperado: la tabla de criterios de la Fase 0 y el **resultado sugerido** (`PASS`, `FAIL EN SESIÓN LARGA / LIMITACIÓN IDENTIFICADA`, `FAIL` o `INCOMPLETA`), más la sección "Después del minuto 15". Se escribe `evidencia/fase-0/analisis-consola.md`.

Si sale otra cosa: si avisa `posible(s) secreto(s) sin redactar`, **no sigas**: envíame el número de línea que indica (no la línea).

## PASO 30 · Observación humana

Ejecuta:
```bash
nano "${VT_BASE}/lab/evidencia/fase-0/observacion-oyente.md"
```

Resultado esperado: la plantilla rellenada con lo que anotó la persona del teléfono (preguntas 1–13 y la tabla de cada 5 minutos). Guarda con `Ctrl+O`, `Enter`, `Ctrl+X`.

## PASO 31 · Revisión de secretos obligatoria y push

Ejecuta:
```bash
export PATH="${VT_BASE}/node/bin:$PATH"; cd "${VT_BASE}/lab"
git add evidencia/fase-0
npm run secretos
```

Resultado esperado: `Sin secretos. Se puede commitear.`

Si sale otra cosa: **no commitees**. Envíame los números de línea y el tipo de hallazgo que imprime (nunca el contenido).

Solo con la revisión limpia:

Ejecuta:
```bash
git -c user.name="Sebastian" -c user.email="tiansolarte1@gmail.com" commit -q -m "Fase 0: evidencia de la prueba con el codigo original de Google en VPS con Nginx" && git push origin "${VT_LAB_BRANCH}" && echo "EVIDENCIA ENVIADA"
```

Resultado esperado: `EVIDENCIA ENVIADA` (git pedirá tu usuario de GitHub y el token como contraseña si no están en caché).

Luego avísame en el chat. Yo vuelvo a correr la revisión de secretos sobre lo que llegue, decido el resultado con el vocabulario de la Fase 0 y actualizo `BITACORA.md` y `PROJECT_STATUS.md`.

## PASO 32 · Dejar la app detenida hasta la siguiente decisión (sin desinstalar)

Ejecuta:
```bash
systemctl stop vt-fase0; systemctl --no-pager status vt-fase0 | head -3
```

Resultado esperado: `Active: inactive (dead)`. Así ningún canal olvidado consume Gemini. Para volver a probar: `systemctl start vt-fase0`.

---

# PARTE E · Desinstalación COMPLETA de la Fase 0 (deja Guardian exactamente como antes)

Ejecutar solo cuando ya no haga falta la instalación de prueba (o para repetirla desde cero). Cada paso borra únicamente lo que la Fase 0 creó. Pega antes el PASO 0.

## PASO 33 · Detener y eliminar la unidad systemd

Ejecuta:
```bash
pkill -f fase0-logs-journal.sh 2>/dev/null || true
systemctl disable --now vt-fase0 2>/dev/null || true
rm -f /etc/systemd/system/vt-fase0.service && systemctl daemon-reload
systemctl status vt-fase0 2>&1 | head -2
```

Resultado esperado: `Unit vt-fase0.service could not be found.`

## PASO 34 · Quitar el vhost de Nginx (solo el archivo nuestro) y recargar

Ejecuta:
```bash
rm -f /etc/nginx/sites-enabled/vt-fase0.conf /etc/nginx/sites-available/vt-fase0.conf
nginx -t && systemctl reload nginx && echo "RECARGADO"
rm -f /var/log/nginx/vt-fase0.access.log* /var/log/nginx/vt-fase0.error.log*
```

Resultado esperado: `syntax is ok`, `test is successful`, `RECARGADO`.

Si sale otra cosa: envíame el error de `nginx -t` sin tocar nada más.

## PASO 35 · Borrar el certificado del subdominio

Ejecuta:
```bash
certbot delete --cert-name "${VT_DOMAIN}" --non-interactive
ls /etc/letsencrypt/live/ 2>/dev/null
```

Resultado esperado: `Deleted all files relating to certificate fase0...` y la lista de `live/` con solo los certificados de Guardian.

## PASO 36 · Borrar usuario y carpeta exclusivos

Ejecuta:
```bash
userdel "${VT_USER}" 2>/dev/null || true
rm -rf "${VT_BASE}"
id "${VT_USER}" 2>&1 | head -1; ls -ld "${VT_BASE}" 2>&1 | head -1
```

Resultado esperado: `id: 'vtfase0': no such user` y `ls: cannot access '/opt/vt-fase0': No such file or directory`.

Nota: si en el PASO 19 se instaló `certbot` porque no existía, puedes dejarlo (no hace nada sin certificados) o quitarlo con `apt-get remove -y certbot`. Si en el PASO 12 se instaló `git`, lo mismo. Ninguno afecta a Guardian.

## PASO 37 · Verificar que Guardian quedó exactamente como antes

Ejecuta:
```bash
cd "${VT_RESPALDO}"
echo "--- nginx: archivos con huella distinta a ANTES (debe estar vacío):"; find /etc/nginx -type f -exec sha256sum {} \; | sort -k2 | diff <(cat nginx-sha256-ANTES.txt) - || true
echo "--- servicios nuevos o faltantes (debe estar vacío):"; systemctl list-units --type=service --state=running --no-pager --no-legend | awk '{print $1}' | sort | diff servicios-ANTES.txt - || true
echo "--- puertos nuevos o faltantes (debe estar vacío):"; ss -tln | awk 'NR>1{print $4}' | sort | diff puertos-ANTES.txt - || true
echo "--- Guardian:"; for u in https://guardianrank.com https://app.guardianrank.com https://master.guardianrank.com; do printf "%s -> %s\n" "$u" "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$u")"; done; echo "--- antes:"; cat guardian-http-ANTES.txt
```

Resultado esperado: las tres comparaciones **vacías** y los códigos de Guardian iguales a los de antes.

Si sale otra cosa: envíame la salida completa; el respaldo `.tgz` del PASO 9 permite restaurar cualquier archivo de Nginx (`tar xzf ... -C / etc/nginx/...`), aunque con este procedimiento no debería haber diferencias.

Por último, borra el registro DNS `fase0` si no lo vas a reutilizar, y opcionalmente `rm -rf /root/respaldos-fase0` (contiene una copia de `/etc/letsencrypt`; conviene conservarlo en `/root` con permisos 700 o borrarlo).

---

# PARTE F · Reutilizar este documento en el VPS definitivo de Voice Traductor

| Qué cambia | Dónde |
|---|---|
| Dominio, correo, puerto, carpeta, usuario | Solo el PASO 0 (`VT_DOMAIN`, `VT_EMAIL`, `VT_PORT`, `VT_BASE`, `VT_USER`) |
| Rama o commit del código | `VT_LAB_BRANCH` y `VT_APP_COMMIT` del PASO 0; en el producto, el repositorio será el nuestro derivado de Google (ADR-011) en lugar del de Google |
| Nombres `vt-fase0` (unidad, vhost, logs) | Si prefieres otro nombre, sustitúyelo en las plantillas y en `fase0-logs-journal.sh`; o conserva el nombre y solo cambia las variables |
| Parte E | No se ejecuta en el VPS definitivo |
| VPS limpio sin Nginx | Usa la variante Docker + Caddy de `README.md` de esta carpeta |

Lo que no cambia: Node autocontenido, build idéntico al `Dockerfile`, unidad `systemd` en `127.0.0.1`, vhost propio, certificado por webroot, captura por `journalctl`, revisión de secretos antes de cada commit de evidencia.
