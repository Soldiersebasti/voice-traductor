# INFRAESTRUCTURA.md — Cuentas, servidores, claves, seguridad y operación

Versión 1.0 · 2026-10-08 · Complementa `PROJECT_CONTRACT.md` §Q y `DECISIONS.md` ADR-009. Todo lo marcado **[por validar]** se confirma al desplegar en la Fase 5; nada de este documento ha sido ejecutado todavía.

---

## 1. Decisión y respuesta directa: ¿VPS o nube?

**Para esta instalación: VPS Linux propio (Hostinger) para la aplicación y el puente, y LiveKit Cloud para la distribución.** No es una preferencia: es lo que sale de comparar los requisitos reales de un culto de hasta 90 minutos (§2).

Tres aclaraciones que evitan expectativas equivocadas:

1. **La nube no "permite más canales" que el VPS.** La capacidad de canales (idiomas simultáneos) depende de los vCPU y la RAM del servidor, no de si es VPS o nube. El README de Google mide ≈ 10 % de un vCPU y 20–30 MiB por puente. Un VPS de 2 vCPU y un contenedor de Cloud Run de 2 vCPU sostienen los mismos canales. Google recomienda 4 vCPU / 4 GiB para 15–20 idiomas en cualquiera de los dos.
2. **Los oyentes no consumen recursos de nuestro servidor.** Los sirve LiveKit Cloud. Con 1 o con 98 oyentes, el VPS hace el mismo trabajo. El límite de oyentes lo pone el plan de LiveKit (100 conexiones en el gratuito; ilimitadas en los de pago).
3. **La elección VPS/nube no cambia la latencia de forma apreciable.** La latencia la dominan el modelo (≈ 2,5–3 s medidos con sesgo) y la región (todo en la costa este de EE. UU.). El tramo de distribución completo (cabina → LiveKit → puente → Gemini → puente → LiveKit → celular) se estima en 0,15–0,4 s en cualquiera de las dos opciones. Se mide en Fase 2 y Fase 5.

Cuándo pasar a la nube: cuando haga falta más de una instancia (muchas iglesias simultáneas) y el estado viva en Redis o en una base de datos. El mismo contenedor sirve para ambos; el cambio es de despliegue, no de código de audio.

## 2. Tabla comparativa con los requisitos reales

| Requisito real (cultos de hasta 90 min, 1 canal, grabación para medir) | Cloud Run (recomendación de Google) | **VPS Hostinger KVM 2 + LiveKit Cloud** | Compute Engine (VM de Google) | VPS + LiveKit autoalojado |
|---|---|---|---|---|
| Un proceso que vive ≥ 2 h sin reinicios ajenos | No garantizado: la plataforma puede reemplazar la instancia con 10 s de aviso (SIGTERM) | **Sí**; los reinicios los controlamos | Sí | Sí |
| Estado en memoria (culto activo, handle de Gemini) se conserva durante el culto | Se pierde si reemplaza la instancia | **Sí** | Sí | Sí |
| Mantenerse activo sin peticiones entrantes | Requiere `--no-cpu-throttling` y que la cabina consulte cada 3 s (así lo hace el código de Google) | **Natural** | Natural | Natural |
| Disco para ≈ 0,5 GB de grabación por culto | El disco ocupa memoria; habría que subir a Cloud Storage | **100 GB NVMe** | Disco persistente | Disco |
| Instancia única (el gestor de sesiones es un singleton en memoria) | Hay que fijar `--max-instances 1` | **Natural** | Natural | Natural |
| HTTPS | Automático | Caddy con certificado automático (Let's Encrypt) | Hay que montarlo | Hay que montarlo |
| Puertos de entrada que hay que abrir | Ninguno | **TCP 22, 80, 443** | TCP 22, 80, 443 | Además UDP 3478, UDP 50000–60000, TCP 7881, TURN con certificado; Redis |
| Capacidad de canales (≈ 10 % vCPU y 25 MiB por canal; dejar 50 % de margen) | Según vCPU asignados (hasta 8 vCPU / 32 GiB) | **≈ 8 canales** (2 vCPU, 8 GB); KVM 4 ≈ 15–20 | Según la VM | Igual que VPS, menos lo que consuma LiveKit |
| Oyentes simultáneos | LiveKit Cloud: 100 gratis; ilimitados de pago | **Igual** | Igual | Los que aguante el servidor y su ancho de banda; TURN propio |
| Varias iglesias a la vez | 1 instancia hasta que haya Redis/BD | 1 VPS sostiene ≈ 8 canales entre todas las iglesias; luego VPS más grande o varios con Redis/BD | Igual | Igual |
| Latencia (región costa este) | Igual | **Igual** (Boston) | Igual | Igual |
| Operación | Google administra el runtime | **Nosotros**: actualizaciones, firewall, backups (el propietario ya administra hosting) | Nosotros | Nosotros + LiveKit + TURN + Redis |
| Costo mensual (1 iglesia, 1 canal, ≈ 5 cultos) | Centavos por culto + Secret Manager | **≈ 9–15 USD** fijos | ≈ 15–30 USD | ≈ 9–15 USD, pero más horas de operación |
| Costo con 50 oyentes | LiveKit Ship ≈ 50 USD/mes | Igual | Igual | 0 de LiveKit; ancho de banda y TURN propios |
| Riesgo específico | Reemplazo de instancia a mitad de culto | UDP de Hostinger **no aplica** (LiveKit está en su nube; el VPS solo hace conexiones de salida) | — | Sin reportes de LiveKit en Hostinger; UDP y TURN sin verificar |

**Veredicto:** VPS + LiveKit Cloud gana en las tres primeras filas, que son las que definen un culto. Es estable (proceso persistente), escalable (los oyentes escalan en LiveKit; los canales con el tamaño del VPS) y de operación conocida para el propietario. Compute Engine es equivalente si se quiere todo en Google. Cloud Run queda para la etapa comercial multiinstancia. LiveKit autoalojado queda para cuando el costo de LiveKit Cloud supere ≈ 100 USD/mes.

### Capacidad por tamaño de servidor [por validar con medición propia]

| Plan Hostinger (verificar en el panel) | vCPU / RAM | Canales de idioma simultáneos con margen del 50 % | Para qué alcanza |
|---|---|---|---|
| KVM 1 | 1 / 4 GB | ≈ 3–4 | Pruebas; una iglesia con 1–2 idiomas |
| **KVM 2** (propuesto) | 2 / 8 GB / 100 GB NVMe / 8 TB | **≈ 8** | Una iglesia con varios idiomas, o ≈ 5 iglesias con 1 idioma a la misma hora |
| KVM 4 | 4 / 16 GB | ≈ 15–20 | Varias iglesias con varios idiomas |
| KVM 8 | 8 / 32 GB | ≈ 30–40 | Antes de llegar aquí conviene repartir en varios servidores con Redis/BD |

Base de cálculo: README de Google (≈ 10 % vCPU y 20–30 MiB por puente), más ≈ 300 MB y ≈ 10 % de vCPU para Next.js. **Se confirma midiendo `top`/`docker stats` en la Fase 5 con 1 y con 3 canales.** El VPS debe ser **dedicado** a Voice Traductor: compartirlo con sitios web agrega variaciones de CPU que se oyen como cortes.

## 3. Topología y puertos

```
IGLESIA (costa este EE. UU.)             LIVEKIT CLOUD (región US East)      VPS HOSTINGER (Boston)             GOOGLE
consola → USB → PC de cabina            sala "iglesia-<id>"                 Next.js + puente translator-en     Gemini Live Translate
  navegador ──WebRTC (443/UDP·TCP)──▶    pista del pastor ──WebRTC──▶          │  wss 443 (salida) ──────────▶   gemini-3.5-live-translate-preview
  HTTPS (443) ─────────────────────────────────────────────────────────────▶  Caddy → app:8080
celular del oyente ◀──WebRTC────────     pista en inglés + subtítulos ◀──────  │ publica la traducción
celular del oyente ──HTTPS (443)──────────────────────────────────────────▶  Caddy → app:8080
```

| Elemento | Entrada (abrir) | Salida (debe estar permitida) |
|---|---|---|
| VPS | TCP 22 (SSH; limitar a la IP del propietario si es fija), TCP 80 (solo redirección a 443 y Let's Encrypt), TCP 443 | TCP 443 a `generativelanguage.googleapis.com` (Gemini), TCP 443 y **UDP** a `*.livekit.cloud` (el puente es un participante WebRTC; si UDP de salida está bloqueado, LiveKit cae a TCP/TLS con algo más de latencia) |
| PC de cabina | Nada | TCP 443 y UDP a LiveKit Cloud; HTTPS al VPS |
| Celulares | Nada | TCP 443 y UDP a LiveKit Cloud; HTTPS al VPS |

Hostinger tiene dos firewalls que deben coincidir: el del panel (por defecto descarta todo lo entrante; reglas en formato `inicio:fin`) y el del sistema operativo (`ufw`). El de salida no se filtra por defecto; si alguna vez se filtra, permitir UDP de salida hacia LiveKit.

## 4. Cuentas, servicios y claves

Para cada servicio: qué cuenta, qué región, qué cuota gratuita, qué credencial, qué activación. **El propietario crea las cuentas y guarda las claves en `.env` / `.env.local`; nunca en el chat.**

| Servicio | Cuenta | Región | Cuota gratuita | Credencial que se obtiene | Activación / notas |
|---|---|---|---|---|---|
| **Gemini (Google AI Studio)** | Cuenta Google + proyecto de Google Cloud **con facturación** | No se elige (Google enruta) | La gratuita permite 3–5 WebSockets simultáneos y no sirve para pruebas largas | `GEMINI_API_KEY` | En Google Cloud, restringir la clave a la API "Generative Language" (restricción de API). Crear **dos claves**: desarrollo (PC) y producción (VPS). |
| **LiveKit Cloud** | Cuenta en cloud.livekit.io; crear un proyecto | **US East** (la más cercana a la iglesia) | Plan Build: 100 conexiones simultáneas; cupo mensual de minutos que las fuentes reportan distinto (README de Google: 50 horas-participante; terceros: 5 000 minutos). **Confirmar en el panel.** | `LIVEKIT_URL` (`wss://<proyecto>.livekit.cloud`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Un proyecto para desarrollo y otro para producción (claves distintas). Plan Ship (≈ 50 USD/mes, 150 000 min incluidos) cuando se supere el cupo. |
| **Hostinger VPS** | La cuenta de hosting del propietario | **Boston** (EE. UU. costa este; la otra opción es Phoenix) | — | Acceso SSH por clave pública | Ubuntu 24.04 LTS; plan KVM 2; agregar clave SSH al crearlo. |
| **Dominio / DNS** | Registrador del propietario | — | — | Registro `A` del subdominio (p. ej. `traductor.<dominio-de-la-iglesia>`) → IP del VPS | Caddy obtiene el certificado solo cuando el DNS apunta al VPS. |
| **Túnel HTTPS temporal** (solo Fases 0–2, PC de desarrollo) | Ninguna (cloudflared "quick tunnel") o ngrok | — | Gratis | URL temporal | Para probar desde un celular sin VPS. |
| **OpenAI** (laboratorio) | Ya existe | — | — | `OPENAI_API_KEY` | Solo para `transcribe` y `judge` en el PC. |

### Variables de entorno

Del repositorio de Google (vigentes hoy):

| Variable | Dónde | Uso |
|---|---|---|
| `GEMINI_API_KEY` | Servidor | Conexión del puente con Gemini |
| `LIVEKIT_URL` | Servidor (se entrega al navegador como URL pública, es normal) | Sala |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Servidor **solamente** | Emitir JWT para cabina, oyentes y puente |
| `BROADCAST_PASSWORD` | Servidor | Contraseña de la cabina (fuerte; 20+ caracteres) |

Propuestas nuestras (aún no existen; se crean en las fases indicadas): `VT_CHURCH_ID` (sesión fija, Fase 4), `VT_RECORD_DIR` (carpeta de grabaciones, Fase 1), `VT_RETENTION_DAYS` (Fase 5), `VT_MAX_SERVICE_MINUTES` y `VT_BOOTH_ABSENT_MINUTES` (políticas de seguridad del ciclo, Fase 4).

Reglas: el archivo `.env` vive en `/srv/voice-traductor/.env`, propietario `root` o el usuario del servicio, permisos `600`, **nunca** dentro de la imagen Docker ni en git. Copia de respaldo en el gestor de contraseñas del propietario.

## 5. Preparación del VPS, paso a paso [por validar en Fase 5]

Secuencia de referencia para Ubuntu 24.04 (se ejecuta por SSH; el propietario conoce estos pasos por su trabajo de hosting):

1. **Crear el VPS** (KVM 2, Boston, Ubuntu 24.04) con la clave SSH pública del propietario. Anotar la IP.
2. **Primer acceso y usuario de servicio:** `adduser vt`, `usermod -aG sudo vt`, copiar la clave SSH a `vt`, desactivar login por contraseña y login de `root` en `/etc/ssh/sshd_config` (`PasswordAuthentication no`, `PermitRootLogin no`), reiniciar `ssh`.
3. **Firewall del sistema:** `ufw default deny incoming`, `ufw default allow outgoing`, `ufw allow 22/tcp` (o `ufw allow from <IP-fija> to any port 22`), `ufw allow 80/tcp`, `ufw allow 443/tcp`, `ufw enable`. **Firewall del panel de Hostinger:** las mismas tres reglas de entrada.
4. **Hardening básico:** `apt update && apt upgrade`, `unattended-upgrades` activado, `fail2ban` para SSH, hora sincronizada (`timedatectl`), swap de 2 GB (`fallocate`) como colchón de memoria.
5. **Docker:** instalar Docker Engine y el plugin `docker compose` desde el repositorio oficial de Docker; `usermod -aG docker vt`.
6. **Código:** `git clone` del repositorio privado del producto en `/srv/voice-traductor` con una **deploy key de solo lectura**.
7. **Secretos:** crear `/srv/voice-traductor/.env` con las variables de §4; `chmod 600`.
8. **DNS:** registro `A` del subdominio → IP del VPS. Esperar propagación antes de arrancar Caddy.
9. **Arranque:** `docker compose up -d --build`. Comprobar `docker compose ps`, `docker compose logs -f app`, y abrir `https://<subdominio>/`.
10. **Arranque automático tras reinicio:** `restart: unless-stopped` en ambos servicios (ya en el compose) y Docker habilitado en `systemd` (lo deja así la instalación).
11. **Registros:** rotación por tamaño en Docker (`max-size 50m`, `max-file 5`). Los registros de Gemini y LiveKit **no** deben contener claves (revisión en O2).
12. **Copias:** grabaciones en `/srv/vt-data/runs/` (volumen del contenedor); política de retención (§8); `.env` respaldado fuera del servidor.
13. **Monitoreo mínimo:** un chequeo externo de disponibilidad (UptimeRobot o similar) a `https://<subdominio>/api/auth/status` cada 5 min con aviso al correo del propietario; `docker stats` durante las pruebas de 90 min para registrar CPU y RAM por canal.

### `docker-compose.yml` de referencia [por validar]

```yaml
services:
  app:
    build: .                      # Dockerfile de Google (node:22-slim, standalone, puerto 8080)
    restart: unless-stopped
    env_file: /srv/voice-traductor/.env
    environment:
      - PORT=8080
      - HOSTNAME=0.0.0.0           # solo si el contenedor no responde desde Caddy
    expose: ["8080"]
    volumes:
      - /srv/vt-data/runs:/app/runs   # grabaciones y eventos (Fase 1)
    logging:
      driver: json-file
      options: { max-size: "50m", max-file: "5" }
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
volumes:
  caddy_data: {}
  caddy_config: {}
```

### `Caddyfile` de referencia [por validar]

```
traductor.ejemplo.org {
  encode gzip
  reverse_proxy app:8080
}
```

Caddy obtiene y renueva el certificado solo, maneja el `Upgrade` de WebSocket y agrega `X-Forwarded-Proto: https`, que el código de Google usa para construir la URL del QR.

### Actualización y vuelta atrás

1. En el PC: `git fetch upstream`, `git merge upstream/main`, pruebas automáticas, prueba real de ≈ 25 min, commit, push.
2. En el VPS: `git pull`, `docker compose build app`, `docker compose up -d app`, prueba de humo de 2 min (cabina + oyente).
3. Vuelta atrás: `git checkout <commit-anterior>` y repetir el paso 2. Las imágenes anteriores siguen en el servidor (`docker images`) hasta que se limpien.
4. **Nunca** actualizar el día del culto.

## 6. Modelo de procesos ("workers")

- **Un solo proceso Node** (`node server.js` del build standalone de Next.js) sirve las páginas, las rutas API y **los puentes**. Los puentes no son procesos aparte ni "workers": son objetos `TranslationBridge` dentro del mismo proceso, cada uno con su WebSocket a Gemini y su participante WebRTC (`@livekit/rtc-node`, con hilos nativos en C++).
- **Exactamente una instancia.** No usar PM2 en modo cluster, ni réplicas, ni balanceadores: el gestor de sesiones es un singleton en memoria. Dos instancias crearían dos bots `translator-en` en la misma sala.
- **Reinicio automático** por Docker (`unless-stopped`). Hasta la Fase 4 (O7), un reinicio del proceso pierde el culto activo y hay que iniciarlo de nuevo desde la cabina.
- **Consumo por canal** (README de Google; se confirma en Fase 5): ≈ 10 % de un vCPU y 20–30 MiB. Más ≈ 300 MB y ≈ 10 % de vCPU para Next.js en reposo.
- **Ancho de banda por canal:** hacia Gemini ≈ 1,0 Mbps (PCM 48 kHz mono en base64; bajaría a ≈ 0,35 Mbps con 16 kHz, PEN-001); desde Gemini ≈ 0,5 Mbps; LiveKit entrada y salida ≈ 0,05–0,1 Mbps cada una (Opus). Total ≈ 1,6 Mbps por canal; un culto de 90 min ≈ 1,1 GB. El cupo de 8 TB/mes del KVM 2 sobra.
- **Cuándo separar en procesos:** cuando un VPS deba sostener más de ≈ 8 canales o varias iglesias con aislamiento entre sí. Entonces un proceso "puente" por iglesia y coordinación por Redis/BD (etapa comercial).

### Presupuesto de latencia por tramo [estimado; se mide en Fases 2 y 5]

| Tramo | Estimación | Cómo se mide |
|---|---|---|
| Cabina → LiveKit (US East) | 10–30 ms + codificación Opus 20 ms | Estadísticas WebRTC de la cabina |
| LiveKit → puente (Boston) | 10–20 ms + bloque de 100 ms | Marcas del puente |
| Puente ↔ Gemini (ida y vuelta de red) | 15–50 ms | Ping del WebSocket |
| **Modelo** | **≈ 2,5–3 s** (PS4 con sesgo; nueva línea base en Fase 2) | `judge` capa 1 |
| Cola de salida del puente | 0–300 ms (sin límite hoy) | Telemetría de cola (Fase 1) |
| Puente → LiveKit → celular | 20–60 ms + búfer de jitter 40–200 ms | Estadísticas WebRTC del celular |
| Audífonos Bluetooth | 100–300 ms | Prueba acústica |

La suma de todo lo que no es el modelo es ≈ 0,2–0,7 s. **La meta de ≈ 2 s del propietario depende del modelo, no de la infraestructura.** Si el modelo queda en 2,5 s, ninguna infraestructura lo baja a 2 s.

## 7. Regiones

| Componente | Región elegida | Por qué |
|---|---|---|
| Iglesia | Carolina del Norte (costa este) | Dato del propietario |
| LiveKit Cloud | US East | Más cercana a la iglesia y al VPS; los celulares se conectan al borde más cercano |
| VPS | Hostinger Boston | Única opción de Hostinger en la costa este para VPS (la otra es Phoenix) |
| Gemini | No se elige | Google enruta al centro más cercano; el modelo puede estar en cualquier región |

Si en la Fase 5 el ping VPS→LiveKit o VPS→Gemini supera 60 ms de forma sostenida, se evalúa otro proveedor de VPS en Virginia (PEN-004).

## 8. Datos, grabaciones y retención

- Qué se graba (Fase 1): `pastor.wav` (audio recibido de la cabina), `traduccion_cruda.wav` (audio recibido de Gemini), `eventos.jsonl`, `corrida.json`. ≈ 0,5 GB por culto de 90 min a 24 kHz mono.
- Para qué: medir latencia, pérdida y duplicación con `judge` y `diagnose`. No para difusión.
- Dónde: `/srv/vt-data/runs/<fecha>-<iglesia>/` en el VPS. Se descargan al PC para analizarlas; en el repositorio solo entran los registros y resultados (`evidencia/`), nunca el audio.
- Retención propuesta: **30 días** y borrado automático (`VT_RETENTION_DAYS`), salvo que una prueba concreta pida conservar. Pendiente de acuerdo con la iglesia (PEN-005).
- La grabación debe poder **desactivarse** por configuración para cultos normales una vez validado el sistema.

## 9. Entorno de desarrollo en el PC del propietario (Windows, CMD) [Fases 0–2]

| Elemento | Valor |
|---|---|
| Node | 22 LTS (el repositorio de Google usa `node:22-slim`) |
| Gestor de paquetes | `npm.cmd` |
| Binarios nativos | `@livekit/rtc-node` trae binario para Windows x64; **se confirma en Fase 0** al correr `npm.cmd install` |
| Claves | `.env.local` en la carpeta del clon de Google (ignorado por git) |
| Arranque | `npm.cmd run dev` → `http://localhost:3000` |
| Oyente de prueba | Otra ventana del navegador en el mismo PC (suficiente para Fases 0–2) |
| Oyente en celular | Túnel HTTPS temporal: `cloudflared tunnel --url http://localhost:3000` (URL aleatoria `https://*.trycloudflare.com`, gratis, sin cuenta) o ngrok. La página del oyente necesita HTTPS en el celular para Wake Lock. |
| Audio de prueba | Sermón grabado reproducido en otra pestaña y capturado con "tab audio" de la cabina, o el micrófono del PC |
| Duración de pruebas largas | El PC no debe suspenderse (plan de energía) |
| Laboratorio | `voice-traductor` con `OPENAI_API_KEY` para `transcribe` y `judge` |

## 10. Seguridad: lista de verificación

| # | Control | Estado hoy | Cuándo |
|---|---|---|---|
| S1 | Claves solo en el servidor; el navegador recibe únicamente JWT de LiveKit de corta vida | Cumplido por el diseño de Google (`/api/token` emite JWT con TTL 4 h) | — |
| S2 | Claves distintas para desarrollo y producción; rotación inmediata si una se expone | Procedimiento | Al crear las cuentas |
| S3 | `.env` con permisos 600, fuera de la imagen y de git | Procedimiento | Fase 5 |
| S4 | Clave de Gemini restringida a la API Generative Language en Google Cloud | Procedimiento | Al crearla |
| S5 | Ninguna clave en registros (el código de Google no imprime la URL de Gemini; revisar que un error de `ws` no la incluya) | **Por revisar** | Fase 4 (O2) |
| S6 | Identidades asignadas por el servidor (hoy `/api/token` acepta cualquier `identity`; un oyente podría entrar como `organizer-host` o `translator-en` y expulsar al real) | **Hueco conocido** | Fase 4 (O2) |
| S7 | Terminar culto, bajar traducción y borrar sesión solo con contraseña (hoy `DELETE /api/sessions/:id`, `/api/translate/unsubscribe` y `DELETE /api/translate` están abiertos) | **Hueco conocido** | Fase 4 (O1/O2) |
| S8 | No listar sesiones públicamente (hoy `GET /api/sessions` devuelve todas) | **Hueco conocido** | Fase 4 (O2) |
| S9 | `BROADCAST_PASSWORD` fuerte; viaja solo por HTTPS; aceptable como único control de cabina en la primera instalación | Aceptado | — |
| S10 | HTTPS obligatorio con certificado automático; HTTP solo redirige | Caddy | Fase 5 |
| S11 | SSH solo con clave; sin root; `fail2ban`; `ufw`; actualizaciones automáticas | Procedimiento | Fase 5 |
| S12 | Límite de peticiones a `/api/token` (evitar que un script agote las 100 conexiones gratuitas de LiveKit) | No existe | Etapa comercial; antes, bastan la contraseña de cabina y el tamaño de la iglesia |
| S13 | Grabaciones: retención y borrado automático; nunca en repositorios | Política §8 | Fase 5 |
| S14 | TTL del JWT del oyente (4 h) suficiente para un culto; el de cabina igual | Cumplido | — |
| S15 | Copia de `.env` y del `Caddyfile` fuera del servidor | Procedimiento | Fase 5 |

## 11. Costos [precios consultados en octubre de 2026; verificar antes de contratar]

| Concepto | Base | Por culto de 90 min | Por mes (≈ 5 cultos, 1 idioma) |
|---|---|---|---|
| Gemini (modelo de traducción, pago por uso) | ≈ 2,2 USD/h/idioma | ≈ 3,3 USD | ≈ 17 USD |
| LiveKit Cloud (Build) | 0 USD hasta el cupo; 1 oyente ≈ 270 min-participante/culto | 0 | 0 (con 50 oyentes ≈ 4 700 min/culto → plan Ship ≈ 50 USD/mes) |
| VPS Hostinger KVM 2 | 9–15 USD/mes según plazo | — | ≈ 9–15 USD |
| Dominio | 0 si es subdominio del de la iglesia; 10–20 USD/año si es nuevo | — | ≈ 0–2 USD |
| Interfaz de audio (solo si la consola es analógica) | 70–180 USD una vez | — | — |
| Cables y aislador de tierra | 10–40 USD una vez | — | — |
| **Total recurrente primera instalación** | | | **≈ 26–35 USD/mes** |

Cada culto debe dejar registrados sus minutos de Gemini (tokens) y de LiveKit (minutos-participante) para poder facturar después (principio 19).

## 12. Guion operativo del día del culto [se completa en Fase 6]

| Cuándo | Qué |
|---|---|
| Día anterior | No actualizar nada. `docker compose ps` en verde. Chequeo externo en verde. |
| T−30 min | Encender PC de cabina (cable de red, corriente, sin suspensión). Abrir la página de cabina. Elegir dispositivo y canal. Comprobar el medidor de nivel con alguien hablando al micrófono del pastor. |
| T−15 min | "Iniciar culto". Confirmar en la cabina: traductor `en` activo. Oír la traducción en los audífonos de cabina. Un celular de prueba conectado al QR. |
| Durante | Vigilar el medidor (saturación o silencio largo) y el estado del traductor. No tocar nada más. |
| Fin | "Terminar culto". Anotar incidencias. |
| Después | Descargar la carpeta de grabación; `transcribe`, `judge`, `diagnose`; registrar evidencia y costo en `BITACORA.md`. |

## 13. Fuentes

- README de `google-gemini/gemini-live-translate-livekit` (recursos por puente, Cloud Run, planes): https://github.com/google-gemini/gemini-live-translate-livekit
- Hostinger, ubicación de servidores (Boston y Phoenix para VPS): https://support.hostinger.com/en/articles/1583267-where-are-your-servers-located
- Hostinger, planes VPS (KVM 2: 2 vCPU, 8 GB, 100 GB NVMe, 8 TB): https://www.hostinger.com/vps-hosting
- Hostinger, firewall de VPS: https://support.hostinger.com/en/articles/8172641-how-to-use-vps-firewall
- LiveKit Cloud, planes: https://livekit.com/pricing
- LiveKit, puertos y firewall para autoalojar: https://docs.livekit.io/transport/self-hosting/ports-firewall.md
- LiveKit, despliegue propio: https://docs.livekit.io/transport/self-hosting/deployment.md
- Gemini, gestión de sesiones: https://ai.google.dev/gemini-api/docs/live-session
- Cloud Run, ciclo de vida del contenedor (SIGTERM con 10 s): https://cloud.google.com/run/docs/container-contract
