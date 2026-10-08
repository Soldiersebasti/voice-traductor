# Fase 0 — Evidencia parcial: instalación, build y arranque de humo en Linux (sin claves)

Fecha: 2026-10-08 13:24–13:28 UTC · Ejecutado por: sesión de Claude Code en el contenedor del entorno de trabajo · **Sin claves de Gemini ni de LiveKit** (no existen en este entorno), por lo que esto **no** demuestra traducción ni conexión con los servicios. Demuestra solo que el código original, con sus dependencias exactas, instala, construye y arranca en Linux.

## Qué se probó

| Paso | Comando | Resultado |
|---|---|---|
| Clon del repositorio oficial en un lugar separado | `git clone https://github.com/google-gemini/gemini-live-translate-livekit.git` + `git checkout 26d9a620a85410ad8c902106d3a4d3a4edfd2968` | Commit `26d9a620a85410ad8c902106d3a4d3a4edfd2968` (2026-09-01, autor Thor Schaeff, Google). `git status` limpio: **no se modificó ningún archivo**. Es el HEAD actual de `origin/main` (verificado con `git fetch` el 2026-10-08). |
| Instalación con las dependencias exactas | `npm ci --no-audit --no-fund` | `added 413 packages in 19s`, sin errores |
| Binario nativo de LiveKit | `find node_modules/@livekit -name "*.node"` | `@livekit/rtc-ffi-bindings-linux-x64-gnu/rtc-node.linux-x64-gnu.node` (lo trae `@livekit/rtc-ffi-bindings` 0.12.52-patch.0 como dependencia opcional por plataforma) |
| Build de producción | `npm run build` | Correcto, 12 s. `output: "standalone"` en `next.config.ts`. Rutas: `/`, `/api/auth/status`, `/api/sessions`, `/api/sessions/[sessionId]`, `/api/token`, `/api/translate`, `/api/translate/status`, `/api/translate/unsubscribe`, `/session/[id]/broadcast`, `/session/[id]/watch` |
| Arranque de humo | `PORT=3100 node .next/standalone/server.js` | `▲ Next.js 16.2.6 … ✓ Ready` |
| `GET /api/auth/status` | curl | `{"passwordRequired":false}` [200] |
| `GET /` | curl | página de 28 009 bytes [200] |
| `GET /api/sessions` | curl | `{"sessions":[]}` [200] (nota: ruta pública que lista sesiones; hueco S8) |
| `POST /api/sessions` con `eventId=prueba`, `allowedLanguages=["en"]` | curl | `{"sessionId":"prueba","organizerIdentity":"organizer-host","joinUrl":".../session/prueba/watch","broadcastUrl":".../session/prueba/broadcast"}` [200]; consola: `[SessionManager] Created session prueba for organizer organizer-host with allowed languages: en` |
| `GET /api/token?room=prueba&identity=attendee-x&role=attendee` | curl | `{"error":"LiveKit credentials not configured"}` [500] — **esperado** sin claves |

## Entorno del contenedor

| Elemento | Valor |
|---|---|
| Sistema | Ubuntu 24.04.4 LTS, Linux 6.18.44, x86_64 |
| Node | v22.22.0 |
| npm | 10.9.4 |
| Versiones instaladas (de `package-lock.json`, lockfileVersion 3) | next 16.2.6 · react 19.2.4 · react-dom 19.2.4 · @livekit/rtc-node 0.13.27 · @livekit/rtc-ffi-bindings 0.12.52-patch.0 · livekit-client 2.19.0 · livekit-server-sdk 2.15.2 · @livekit/components-react 2.9.21 · @livekit/components-styles 1.2.0 · ws 8.20.1 · uuid 14.0.0 · qrcode.react 4.2.0 · typescript 5.9.3 · eslint 9.39.4 |
| Modelo Gemini fijado en el código | `gemini-3.5-live-translate-preview` (`src/lib/translation-bridge.ts:70`); entrada 48 kHz PCM en tramas de 100 ms; salida 24 kHz |
| Configuración LiveKit fijada en el código | Puente: `autoSubscribe: false`, `dynacast: false`, identidad `translator-<idioma>`, publica `translated-audio-<idioma>` como `SOURCE_MICROPHONE`. Oyente: `autoSubscribe: false`, se suscribe solo a la pista del idioma elegido. Tokens JWT con TTL 4 h (`/api/token`). URL, clave y secreto de LiveKit Cloud: por `.env.local`, no en el código. |

## Verificación para Windows (sin ejecutar en Windows)

`@livekit/rtc-ffi-bindings` 0.12.52-patch.0 declara como dependencias opcionales los binarios `darwin-x64`, `darwin-arm64`, `linux-x64-gnu`, `linux-arm64-gnu` y **`win32-x64-msvc`**; el paquete `@livekit/rtc-ffi-bindings-win32-x64-msvc@0.12.52-patch.0` existe en el registro de npm (consultado con `npm view`). La instalación en el PC Windows se confirma en el paso 2 del `README.md`.

## Lo que esto NO demuestra

- Conexión con LiveKit Cloud ni con Gemini.
- Traducción ES→EN.
- Audio en un teléfono.
- Ninguna renovación (`goAway`).

Todo eso es la prueba real del `README.md`, en el PC del propietario, con sus cuentas.
