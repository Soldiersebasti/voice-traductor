# Fase 0 — Código original de Google, de punta a punta, sin modificar

Objetivo: demostrar que `google-gemini/gemini-live-translate-livekit` funciona ES→EN de punta a punta **antes** de tocarlo, con una prueba continua de **15 a 25 minutos (objetivo 20–25)** que atraviese las renovaciones de Gemini y muestre qué ocurre **después del minuto 15**, que es el límite documentado por Google para sesiones solo de audio sin `contextWindowCompression`. El código original no se modifica. **Si aparece una limitación por la falta de compresión, no se oculta ni se corrige durante la Fase 0: se registra como resultado.** Criterios en `PROJECT_STATUS.md` §9 (Fase 0). **Nunca** se guardan claves ni handles completos.

La prueba debe dejar registrado: inicio; primera traducción; cada `goAway`; cada reanudación (`sessionResumption`: el código original no imprime las actualizaciones, así que la evidencia es la reconexión "with handle: presente" y que la traducción continúe); cualquier reconexión; pérdida perceptible; repetición; silencio; aumento de retraso; qué ocurre después del minuto 15; duración total alcanzada.

## Qué hay en esta carpeta

| Archivo | Qué es | Quién lo produce |
|---|---|---|
| `README.md` | Este protocolo | — |
| `00-instalacion-linux.md` | Instalación con dependencias exactas, build y arranque de humo en Linux, sin claves | Sesión de Claude Code (2026-10-08) |
| `entorno-pc.txt` | Versiones del PC Windows donde corre la prueba real | Propietario (paso 3) |
| `consola-dev.txt` | Consola del servidor de Google con marca de tiempo y handles redactados | `tools/fase0-run.ps1` (paso 5) |
| `analisis-consola.md` | Línea de tiempo, renovaciones y criterios comprobables | `npm.cmd run fase0:analizar` (paso 8) |
| `observacion-oyente.md` | Lo que oyó la persona en el teléfono | Quien escucha (paso 7) |

## Dónde corre el servidor de la prueba

| Opción | Dónde corre la app de Google | Guion |
|---|---|---|
| **A. VPS de Hostinger** (elegida el 2026-10-08) | En el VPS que ya corre Guardian con Nginx: carpeta, usuario, puerto interno, unidad `systemd` y vhost propios; sin Docker ni Caddy; desinstalación completa al final | **`deploy/fase0/instalacion-vps-nginx.md`** (pasos 0–37). Para un VPS limpio existe la variante Docker + Caddy en `deploy/fase0/README.md`. El vocabulario y la plantilla de observación de esta carpeta siguen aplicando. |
| B. PC Windows | En tu PC con `npm.cmd run dev` y un túnel para el teléfono | Pasos 1–8 de este archivo |

El entorno web de Claude Code **no** puede correr el servidor (sin UDP ni entrada desde internet; verificado el 2026-10-08).

## Lo que debe existir antes (lo crea el propietario; las claves nunca van al chat)

1. **LiveKit Cloud**: proyecto en cloud.livekit.io (plan Build). Anotar `LIVEKIT_URL` (`wss://<proyecto>.livekit.cloud`), `LIVEKIT_API_KEY` y `LIVEKIT_API_SECRET`. No hay región que elegir; la región de datos queda en EE. UU.
2. **Gemini**: clave de Google AI Studio creada en un proyecto **con facturación** (la cuota gratuita limita a 3–5 WebSockets y no sirve para pruebas largas).
3. Un **sermón grabado en español** de al menos 25 minutos seguidos (por ejemplo la prédica completa de la que salieron PS1 o PS4), o un micrófono con alguien hablando. No debe haber silencios largos: Gemini solo cuenta como "sesión con audio" mientras entra audio.
4. Un **teléfono real** con audífonos de cable y una persona que escuche.
5. Opcional, para el teléfono: `cloudflared` instalado (`winget install Cloudflare.cloudflared`) para exponer el PC por HTTPS sin cuenta.

## Procedimiento (CMD, en el PC del propietario)

Las rutas son de ejemplo. `%LAB%` es la carpeta del laboratorio `voice-traductor`; `%APP%` la del clon de Google, **fuera** del laboratorio.

```cmd
set LAB=C:\dev\voice-traductor
set APP=C:\dev\gemini-live-translate-livekit
```

### 1. Clonar el repositorio oficial en el commit exacto

```cmd
cd C:\dev
git clone https://github.com/google-gemini/gemini-live-translate-livekit.git
cd %APP%
git checkout 26d9a620a85410ad8c902106d3a4d3a4edfd2968
git status
```

`git status` debe decir que no hay cambios. **No modificar ningún archivo de este clon.**

### 2. Instalar exactamente las dependencias del proyecto

```cmd
cd %APP%
npm.cmd ci
```

`npm ci` instala lo que fija `package-lock.json` (Next 16.2.6, React 19.2.4, `@livekit/rtc-node` 0.13.27, `livekit-client` 2.19.0, `livekit-server-sdk` 2.15.2, `ws` 8.20.1). No usar `npm install` ni `npm update`. Debe aparecer el binario nativo para Windows: `node_modules\@livekit\rtc-ffi-bindings-win32-x64-msvc\`.

### 3. Registrar el entorno del PC

```cmd
cd %APP%
(echo node: & node --version & echo npm: & npm.cmd --version & ver & echo. & npm.cmd ls --depth=0 & echo. & echo commit: & git rev-parse HEAD & dir /b node_modules\@livekit) > %LAB%\evidencia\fase-0\entorno-pc.txt 2>&1
type %LAB%\evidencia\fase-0\entorno-pc.txt
```

### 4. Claves, solo en el PC

Crear `%APP%\.env.local` (está en el `.gitignore` de Google) con:

```
GEMINI_API_KEY=...
LIVEKIT_URL=wss://<proyecto>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
BROADCAST_PASSWORD=<una contraseña larga>
```

### 5. Arrancar con captura de consola (marca de tiempo + redacción)

Desde el laboratorio, no desde el clon:

```cmd
cd %LAB%
powershell -NoProfile -ExecutionPolicy Bypass -File tools\fase0-run.ps1 -Dir %APP%
```

Eso ejecuta `npm run dev` de Google sin tocarlo, muestra la consola y la guarda en `evidencia\fase-0\consola-dev.txt` con cada línea fechada y los handles reducidos a 6 caracteres. Dejar esa ventana abierta todo el tiempo. Se detiene con Ctrl+C.

### 6. Prueba corta (2–3 minutos)

1. Abrir `http://localhost:3000`. Crear la sesión con identificador de evento `prueba` y, en idiomas permitidos, dejar solo **English**. Contraseña: la de `.env.local`.
2. En la página de cabina: activar **tab audio** y elegir la pestaña donde suena el sermón en español (o activar el micrófono y hablar en español).
3. En otra ventana del navegador del mismo PC, abrir el enlace del oyente (`/session/prueba/watch`), tocar **Start listening** y elegir **English**.
4. Confirmar que se oye inglés. Si no, anotar qué dice la consola y detenerse aquí; registrar en `BITACORA.md` como `FALLÓ` o `BLOQUEADO`.

### 7. Prueba continua de 15 a 25 minutos (objetivo: 20–25)

Con **una persona en un teléfono real**:

1. Opcional, para el teléfono, en otra ventana CMD: `cloudflared tunnel --url http://localhost:3000`. Copiar la URL `https://....trycloudflare.com` y abrir en el teléfono `https://....trycloudflare.com/session/prueba/watch`. Si no hay túnel, usar la IP del PC en la misma red Wi-Fi (`http://<ip-del-pc>:3000/session/prueba/watch`); la pantalla puede apagar el audio sin HTTPS, así que mantenerla encendida.
2. La persona toca **Start listening**, elige **English** y llena `observacion-oyente.md` mientras escucha, con la hora del teléfono en cada anotación y una fila cada 5 minutos.
3. **No cerrar la página del oyente** durante la prueba: el código original apaga el canal de Gemini cuando se va el último oyente, y eso anularía la prueba.
4. Dejar correr **entre 15 y 25 minutos**, idealmente **20–25**, con audio en español sonando todo el tiempo. Qué esperar y qué anotar:
   - **Minuto 9–10** desde que se creó el canal: primer `goAway` (`Received goAway message from Gemini`), reconexión con handle y `Gemini reconnect setup complete`. Anotar si el oyente notó algo.
   - **Minuto 15**: límite documentado por Google para sesiones solo de audio **sin** `contextWindowCompression`, que el código original no envía. Puede pasar cualquiera de estas cosas, y todas son resultado válido de la prueba: la sesión sigue normal; Gemini cierra la conexión (anotar código y razón); la reconexión con handle falla o entra sin contexto; la traducción se degrada o se detiene. **No corregir nada.** Si la traducción se detiene, dejar la prueba correr 3 minutos más para ver si el código original se recupera solo, y luego detener.
   - **Minuto 19–20**: segundo `goAway` si la sesión sigue viva.
   - Durante toda la prueba: silencios mientras el pastor habla, repeticiones, pérdidas y si el retraso crece (anotar a ojo cada 5 min).
5. Al terminar: Ctrl+C en la ventana de la consola. Cerrar el túnel. Anotar la duración total alcanzada y por qué terminó (por decisión o por fallo).

### 8. Analizar la consola y guardar la evidencia

```cmd
cd %LAB%
npm.cmd run fase0:analizar -- evidencia\fase-0\consola-dev.txt
```

Escribe `evidencia\fase-0\analisis-consola.md` con la línea de tiempo (conexión inicial, primera traducción, cada `goAway`, reconexión, confirmación, cierres con código, huecos de audio que el código original reporta, errores), la tabla de criterios comprobables y un **resultado sugerido** con el vocabulario de abajo. Si avisa de un posible secreto sin redactar, **no commitear** hasta corregir la línea.

**Regla obligatoria antes de cualquier commit de evidencia: revisión de secretos.** Primero preparar los archivos y luego ejecutar la revisión; solo se commitea si dice "Sin secretos":

```cmd
cd %LAB%
git add evidencia\fase-0
npm.cmd run secretos
```

La revisión recorre lo preparado para commit y toda la carpeta `evidencia\` y falla (código 2) si encuentra: `.env` o `.env.local`, claves de API (Google `AIza…`, OpenAI/DashScope `sk-…`, LiveKit `API…`), asignaciones `LIVEKIT_API_SECRET=…`, `GEMINI_API_KEY=…`, `BROADCAST_PASSWORD=…`, URLs con credenciales (`usuario:clave@` o `?key=`/`?token=`), handles completos de Gemini, tokens JWT (`eyJ….eyJ….…`) o bloques de llave privada. Si falla, corregir la línea (o quitar el archivo con `git reset evidencia\fase-0\<archivo>`) y repetir. `.env.local` vive en `%APP%`, fuera del laboratorio, y nunca se agrega a git. Nunca usar `git add -A` dentro del clon de Google.

Solo con la revisión limpia:

```cmd
git commit -m "Fase 0: evidencia de la prueba con el codigo original de Google"
git push
```

y avisar en el chat. Antes de aceptar la evidencia se vuelve a ejecutar `npm run secretos` del lado de la revisión. Con esos archivos se actualizan `BITACORA.md` y `PROJECT_STATUS.md` y se decide el resultado.

## Vocabulario del resultado de la Fase 0

Esta prueba evalúa el **código original de Google**, no a Voice Traductor. El resultado se escribe con uno de estos rótulos, y nunca como "Voice Traductor no funciona":

| Rótulo | Cuándo |
|---|---|
| **FASE 0 ORIGINAL GOOGLE: PASS** | Todo el flujo funciona, ≥ 15 min, al menos una renovación, la traducción continúa, pasa del minuto 15 con audio, sin error fatal, y la persona oyó inglés sin cortes ni repeticiones relevantes |
| **FASE 0 ORIGINAL GOOGLE: FAIL EN SESIÓN LARGA / LIMITACIÓN IDENTIFICADA** | El código original funciona correctamente ES→EN y renueva la conexión, pero se detiene o se degrada alrededor del minuto 15 por no enviar `contextWindowCompression`. Es el resultado que justifica directamente la **Fase 1**: agregar `contextWindowCompression` y volver a probar |
| **FASE 0 ORIGINAL GOOGLE: FAIL** | El código original no completa el flujo (no traduce, el teléfono no recibe audio, error fatal, la renovación no continúa) |
| **FASE 0: INCOMPLETA** | La prueba no llegó a 15 minutos por una causa ajena al código (se detuvo antes, se cerró el oyente, se acabó el audio); repetir |
| **FASE 0: BLOQUEADO** | No se pudo ejecutar por cuentas, claves, equipo o persona |

## Qué registra la consola original (y qué no)

El código de Google imprime, sin modificarlo: conexión y `setupComplete` de Gemini; los fragmentos de audio #1–3 y luego cada 100 (recibidos) o cada 500 (enviados); `goAway` con `timeLeft`; inicio de reconexión con el handle (que el script redacta); apertura y confirmación de la conexión nueva; cierre de la vieja; código y razón de cada cierre; huecos de audio **mayores de 2 s**; transcripciones finales; altas y bajas de oyentes. **No** imprime `SessionResumptionUpdate` (la única evidencia de la reanudación es "with handle: presente" y que la traducción continúe), ni huecos menores de 2 s, ni mide latencia ni retraso creciente (eso lo anota la persona). Todo eso se agrega en la Fase 1; en la Fase 0 no se modifica la aplicación para medirlo.

El analizador marca por separado lo que ocurre **después del minuto 15** desde la creación del canal y señala cierres con códigos o razones que sugieran un límite de sesión (`1008`, `1011`, "deadline", "expired", "limit", "session"). Si aparece, es el resultado que esta prueba busca, no un fallo a corregir aquí.
