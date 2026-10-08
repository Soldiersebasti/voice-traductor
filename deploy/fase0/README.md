# Fase 0 en el VPS de Hostinger — guion paso a paso (variante VPS limpio: Docker + Caddy)

> **Dos variantes según el VPS.** Esta es la variante para un VPS **limpio** (sin Nginx ni otros servicios), con Docker y Caddy. Para el VPS **compartido con Guardian** (Nginx ya ocupa 80/443; sin Docker; aislamiento total y desinstalación completa) usa **`instalacion-vps-nginx.md`** de esta carpeta, que es el documento vigente para la prueba del 2026-10. Ambas variantes corren el mismo código original de Google en el mismo commit.

Objetivo: correr el **código original de Google** (`gemini-live-translate-livekit`, commit `26d9a620a85410ad8c902106d3a4d3a4edfd2968`, sin modificaciones funcionales) en un VPS con HTTPS, para la prueba continua ES→EN de **20–25 minutos** con un oyente en un teléfono real. Criterios, vocabulario del resultado y plantilla de observación: `evidencia/fase-0/README.md` y `observacion-oyente.md`. Nada de esto adapta el producto: solo pone a correr el código original en otra máquina.

Qué hace cada archivo de esta carpeta:

| Archivo | Para qué |
|---|---|
| `docker-compose.yml` | Construye la imagen con el `Dockerfile` de Google y la pone detrás de Caddy |
| `Caddyfile` | HTTPS automático para el dominio de la prueba y proxy al puerto 8080 de la app |
| `.env.example` | Plantilla de las variables; el `.env` real se escribe solo en el VPS |
| `fase0-logs.sh` | Captura la consola de la app con marca de tiempo y redacción, para la evidencia |

Los secretos nunca se pegan en el chat ni se commitean. Se escriben con `nano` en el VPS.

## 0. Lo que necesitas antes de empezar

| Qué | Detalle |
|---|---|
| VPS | Hostinger KVM 2 (2 vCPU, 8 GB), **Ubuntu 24.04**, centro de datos **Boston**, con tu clave SSH pública cargada al crearlo. Anota la IP. |
| Subdominio | Por ejemplo `fase0.<tu-dominio>`. Registro **A** → IP del VPS. Hazlo primero: el certificado de Caddy se emite solo cuando el DNS ya apunta al VPS. |
| Credenciales | `GEMINI_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` y una `BROADCAST_PASSWORD` nueva de 20+ caracteres |
| Para devolver la evidencia | Un **token de GitHub** con permiso de escritura sobre `soldiersebasti/voice-traductor` (Settings → Developer settings → Personal access tokens → Fine-grained; repositorio: solo ese; permiso *Contents: Read and write*). Se escribe una sola vez cuando git lo pida; no se guarda en archivos. |
| Audio y oyente | Un sermón en español de **≥ 25 min seguidos** para reproducir en una pestaña de tu PC; un teléfono con audífonos de cable y una persona que escuche |

Tiempo estimado: 45–60 min de preparación, 30 min de prueba.

## 1. Entrar al VPS y preparar el sistema

Desde tu PC (PowerShell o cualquier cliente SSH), con la IP del VPS:

```bash
ssh root@IP_DEL_VPS
```

En el VPS, todo lo que sigue se ejecuta como `root` (es un VPS de prueba; en la Fase 5 se crea el usuario de servicio del runbook de `INFRAESTRUCTURA.md` §9):

```bash
apt-get update && apt-get upgrade -y
apt-get install -y git curl ufw ca-certificates
timedatectl set-timezone UTC
```

Firewall del sistema (y las **mismas tres reglas** en el firewall del panel de Hostinger: TCP 22, 80, 443; el panel descarta todo lo demás por defecto):

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

## 2. Instalar Docker y Node

Docker (script oficial de Docker; en la Fase 5 se pasa al repositorio apt):

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

Node 22 (solo para correr el analizador y la revisión de secretos del laboratorio en el VPS):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node --version && npm --version
```

## 3. Clonar el código original de Google en el commit exacto

```bash
mkdir -p /srv/fase0 && cd /srv/fase0
git clone https://github.com/google-gemini/gemini-live-translate-livekit.git app
cd app
git checkout 26d9a620a85410ad8c902106d3a4d3a4edfd2968
git status
cd ..
```

`git status` debe decir "nothing to commit, working tree clean". **No editar nada dentro de `app/`.**

## 4. Traer los archivos de despliegue del laboratorio

```bash
cd /srv
git clone https://github.com/soldiersebasti/voice-traductor.git lab
cd /srv/lab && git checkout claude/happy-lovelace-7x2zam && cd /srv/fase0
cp /srv/lab/deploy/fase0/docker-compose.yml /srv/lab/deploy/fase0/Caddyfile /srv/lab/deploy/fase0/fase0-logs.sh .
cp /srv/lab/deploy/fase0/.env.example .env
chmod +x fase0-logs.sh
chmod 600 .env
ls -la
```

Si el repositorio del laboratorio es privado, git pedirá usuario (tu usuario de GitHub) y contraseña (el token). Para no escribirlo cada vez durante esta sesión: `git config --global credential.helper 'cache --timeout=7200'` (lo guarda solo en memoria, dos horas).

## 5. Escribir los secretos, solo en el VPS

```bash
nano /srv/fase0/.env
```

Completar `FASE0_DOMAIN`, `GEMINI_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` y `BROADCAST_PASSWORD`. Guardar (Ctrl+O, Enter, Ctrl+X). Comprobar que no quedó ninguna variable vacía, sin mostrar valores:

```bash
awk -F= '/^[A-Z_]+=/{print $1": "(length($2)>0?"ok":"VACIA")}' /srv/fase0/.env
```

## 6. Construir y arrancar

```bash
cd /srv/fase0
docker compose up -d --build
docker compose ps
docker compose logs --tail=20 app
docker compose logs --tail=20 caddy
```

Esperado: `app` y `caddy` en estado `Up`; en los logs de `app`, `▲ Next.js 16.2.6` y `✓ Ready`; en los de `caddy`, la obtención del certificado para tu dominio sin errores. Si Caddy repite errores de certificado, el DNS todavía no apunta al VPS: esperar y `docker compose restart caddy`.

Prueba desde el VPS y luego desde tu PC:

```bash
curl -s https://fase0.TU-DOMINIO/api/auth/status
```

Esperado: `{"passwordRequired":true}`.

## 7. Registrar el entorno del VPS (evidencia)

```bash
mkdir -p /srv/fase0/evidencia
{
  echo "fecha: $(date -u +%FT%TZ)"; echo "so: $(lsb_release -ds) $(uname -rm)"; echo "docker: $(docker --version)"
  echo "node (host): $(node --version)"; echo "app commit: $(git -C /srv/fase0/app rev-parse HEAD)"
  echo "imagen: $(docker compose -f /srv/fase0/docker-compose.yml images app | tail -1)"
  echo "node en la imagen: $(docker compose -f /srv/fase0/docker-compose.yml exec -T app node --version)"
  echo "vcpu: $(nproc)  ram: $(free -h | awk '/Mem/{print $2}')"
} > /srv/fase0/evidencia/entorno-vps.txt
cat /srv/fase0/evidencia/entorno-vps.txt
```

## 8. Arrancar la captura de consola (antes de crear la sesión)

```bash
cd /srv/fase0
nohup ./fase0-logs.sh > /dev/null 2>&1 &
tail -f evidencia/consola-dev.txt
```

La captura sigue aunque cierres SSH. `Ctrl+C` solo cierra el `tail`, no la captura. Cada línea queda con hora UTC en milisegundos y los handles de Gemini reducidos a 6 caracteres.

## 9. La prueba (desde tu PC y el teléfono)

Sigue `evidencia/fase-0/README.md` pasos 6 y 7, con estas direcciones:

1. En tu PC: `https://fase0.TU-DOMINIO/` → crear sesión con identificador de evento `prueba`, idiomas permitidos solo **English**, contraseña `BROADCAST_PASSWORD`.
2. Cabina en tu PC: **tab audio** de la pestaña donde suena el sermón en español. Prueba corta de 2–3 min con el oyente en otra ventana del PC: confirmar inglés.
3. Teléfono: `https://fase0.TU-DOMINIO/session/prueba/watch` → **Start listening** → **English**. La persona llena `observacion-oyente.md` con una fila cada 5 minutos. **No cerrar la página del oyente** durante la prueba.
4. Dejar correr **20–25 minutos** con audio continuo. En `tail -f` verás hacia el minuto 9–10 `Received goAway message from Gemini` y luego `Gemini reconnect setup complete`; hacia el minuto 15, lo que ocurra se registra, **no se corrige**.
5. Al terminar: en la cabina, **End broadcast**. En el VPS: `pkill -f fase0-logs.sh`.

## 10. Analizar, revisar secretos y devolver la evidencia

```bash
cd /srv/lab
npm ci
mkdir -p evidencia/fase-0
cp /srv/fase0/evidencia/consola-dev.txt /srv/fase0/evidencia/entorno-vps.txt evidencia/fase-0/
npm run fase0:analizar -- evidencia/fase-0/consola-dev.txt
```

Revisa `evidencia/fase-0/analisis-consola.md` (resultado sugerido y sección "Después del minuto 15"). Escribe lo que oyó la persona en `evidencia/fase-0/observacion-oyente.md` (`nano`). Luego, **la revisión de secretos antes del commit**:

```bash
git add evidencia/fase-0
npm run secretos
```

Solo si dice "Sin secretos":

```bash
git -c user.name="Sebastian" -c user.email="tiansolarte1@gmail.com" commit -m "Fase 0: evidencia de la prueba con el codigo original de Google en el VPS"
git push origin claude/happy-lovelace-7x2zam
```

Avísame en el chat. Yo vuelvo a correr la revisión de secretos sobre lo que llegue, decido el resultado con el vocabulario de la Fase 0 y actualizo `BITACORA.md` y `PROJECT_STATUS.md`.

## 11. Después de la prueba

```bash
cd /srv/fase0 && docker compose down
```

Apagar los contenedores evita que un canal olvidado siga consumiendo Gemini. El VPS se queda para la Fase 1.

## Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `curl` al dominio no responde | DNS sin propagar o puertos 80/443 cerrados en el panel de Hostinger | `dig +short fase0.TU-DOMINIO` debe dar la IP; revisar el firewall del panel |
| Caddy: errores de certificado en bucle | DNS aún no apunta al VPS | Esperar la propagación; `docker compose restart caddy` |
| `/api/token` devuelve `LiveKit credentials not configured` | `.env` incompleto | Paso 5; `docker compose up -d` para recargar |
| Consola: `Gemini WebSocket closed before setup` o error 403/429 | Clave de Gemini inválida, sin facturación, o cuota | Revisar la clave y la facturación del proyecto en AI Studio |
| Consola: `Failed to start` del puente con error de LiveKit | `LIVEKIT_URL`/clave/secreto incorrectos o de otro proyecto | Revisar `.env`; la URL es `wss://…livekit.cloud` |
| El oyente no oye nada y la consola dice `Waiting for organizer` | La cabina no está publicando (tab audio no activado o pestaña sin sonido) | En la cabina, activar tab audio y comprobar el medidor de la pestaña |
| El canal se apaga solo (`No more subscribers`) | El oyente cerró la página | Es el comportamiento del código original (cambio O1 en la Fase 4); repetir sin cerrar la página |
