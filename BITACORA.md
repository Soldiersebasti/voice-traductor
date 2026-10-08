# BITACORA.md — Registro cronológico de Voice Traductor

**Este archivo es APPEND-ONLY.** Nunca se borra ni se reescribe el historial. Cada sesión de trabajo agrega una entrada al final de la sección "Entradas". Si algo falla, también se registra. Una sesión que no produjo código sigue teniendo valor si descubrió un riesgo.

## Formato de cada entrada

```
### AAAA-MM-DD HH:MM UTC — <título corto>
FASE:
BRANCH:
COMMIT INICIAL:
OBJETIVO DE LA SESIÓN:
QUÉ SE HIZO:
ARCHIVOS MODIFICADOS:
PRUEBAS EJECUTADAS:
COMANDOS IMPORTANTES:
RESULTADOS:
ERRORES ENCONTRADOS:
RIESGOS DESCUBIERTOS:
DECISIONES TOMADAS:
COSAS NO RESUELTAS:
ESTADO AL TERMINAR:
COMMIT FINAL:
SIGUIENTE PASO EXACTO:
```

Reglas: fechas en UTC; los errores se registran como `error detectado → diagnóstico → corrección → prueba → resultado`; la evidencia se enlaza a `evidencia/<fecha>-<nombre>/`; los estados usan el vocabulario de `PROJECT_CONTRACT.md` §K.

---

## Historial reconstruido (antes de que existiera esta bitácora)

Entradas reconstruidas el 2026-10-08 a partir de `git log` y de la conversación con el propietario. Las horas son aproximadas; las cifras citadas son las que el propietario o los documentos reportaron. **Todas las entradas de esta sección son HISTÓRICO RECONSTRUIDO; cada una indica su fuente (conversación, git, artefacto local o evidencia reproducible). Las métricas de PS4 son RESULTADOS HISTÓRICOS REPORTADOS: `runs/` está vacío y no existe la evidencia local original. Desde el 2026-10-08, cada prueba nueva apunta a su evidencia real en `evidencia/`.**

### 2026-10-05 — Nacimiento del laboratorio
ETIQUETA: **HISTÓRICO RECONSTRUIDO** · FUENTE: git (commits `4e9fd50` a `51afc0e`) + documentos del repositorio (`docs/estado-del-arte-latencia.md`, `docs/alternativas-proveedores.md`) + conversación. Evidencia reproducible: pruebas unitarias (`npm test`). Artefacto local de la corrida OpenAI: **no** (`runs/` vacío).
FASE: Laboratorio (previo al plan por fases)
BRANCH: `claude/happy-lovelace-7x2zam`
COMMITS: `4e9fd50` initial · `ff9ed92` README con visión y requisitos · `ad3aa07` adaptadores de motores y banco offline · `6137587` latencia como criterio de aprobación (retraso percibido y pruebas interactivas) · `23c8039` opciones de voz de OpenAI y lecciones de Glossa y LiveVoice · `51afc0e` medición de interpretación continua
QUÉ SE HIZO: Monorepo npm (TypeScript, tsx, Node 22, `ws` como única dependencia de runtime). Contrato `TranslationEngine`; adaptadores OpenAI (`gpt-realtime-translate`), Gemini (`gemini-3.5-live-translate-preview`) y mock. Banco `run` con `eventos.jsonl`, `metricas.json`, `resumen.md`, WAV de comparación. Juez automático (`judge`) con retraso percibido frase a frase y deriva. Umbral del MVP: 3 s.
PRUEBAS EJECUTADAS: Pruebas unitarias con motor simulado (retraso conocido medido exactamente). Corrida real OpenAI con prédica PS1 (15 min).
RESULTADOS HISTÓRICOS REPORTADOS (fuente: `docs/`; sin artefacto local): OpenAI: calidad 4,91/5, cero omisiones, 65 % de frases empiezan antes de que el pastor termine; **fin→fin mediana 4,15 s, p90 7,27 s, 80 % del tiempo sobre 3 s, huecos de hasta 10,5 s, 9 saltos** → `FALLÓ` el criterio de latencia.
DECISIONES: Latencia como criterio de aprobación; una sesión por idioma como principio (README).
ESTADO AL TERMINAR: Laboratorio funcional; OpenAI descartado como motor principal.

### 2026-10-06 — Diagnóstico, estado del arte, Hibiki, proveedores, Qwen
ETIQUETA: **HISTÓRICO RECONSTRUIDO** · FUENTE: git (commits `270b46f` a `0584372`) + conversación. Evidencia reproducible: pruebas unitarias (`npm test`).
FASE: Laboratorio
COMMITS: `270b46f` diagnóstico de latencia y simulación de reproducción adaptativa · `a9d2e24` estado del arte y forense de huecos de llegada · `3c154cd` Hibiki-Zero vía puente Python · `c5b7413` mapa de proveedores y alternativas · `0584372` Qwen3.8-LiveTranslate como motor del banco
QUÉ SE HIZO: `diagnose` (de dónde viene el retraso: modelo vs cola vs reproducción), `replay` (simulación de reproducción acelerada sin volver a llamar al modelo). Documento de estado del arte. Adaptador Hibiki-Zero (requiere GPU; puente `tools/hibiki_bridge.py`). Documento de alternativas de proveedores. Adaptador Qwen con `session.update`, ping RTT, `audio.first_output`, rotación a 110 min, reconexión con búfer de 10 s, registro crudo por fragmento.
PRUEBAS EJECUTADAS: `replay` sobre la corrida OpenAI: inicio→inicio 7,59 → 6,15 s; fin→fin sigue en 4,15 s; 74 % del tiempo sobre 3 s → acelerar la reproducción no resuelve. Pruebas unitarias de Qwen (la primera versión falló porque `stop()` retornaba antes del evento de cierre; se corrigió esperando el cierre con tope de 1 s; pasan).
ERRORES ENCONTRADOS: Qwen `session.closed` ausente → diagnóstico: `stop()` no esperaba el cierre → corrección: esperar `close` con `sleep(1000)` de tope → prueba: unitaria → resultado: pasa.
RESULTADOS: 43 pruebas pasan. Qwen y Hibiki quedan `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` (sin corrida real).
COSAS NO RESUELTAS: Cuenta de Alibaba Model Studio no activada; GPU para Hibiki no confirmada.

### 2026-10-06 (antes de 21:27 UTC) — Corridas reales de Gemini con PS4 (en el PC del propietario)
ETIQUETA: **HISTÓRICO RECONSTRUIDO** · FUENTE: conversación. Artefacto local: **no** (`runs/` vacío). Evidencia reproducible: **no**.
FASE: Laboratorio
QUÉ SE HIZO: El propietario corrió dos veces el motor Gemini con la prédica PS4 (`runs/ps4-gemini-gemini`, `runs/ps4-gemini-2-gemini`) con referencia `samples/PS4.referencia.json`.
RESULTADOS HISTÓRICOS REPORTADOS (fuente: conversación; `runs/` vacío, sin artefacto local): primer audio 3,50 s; fin→fin mediana 2,88 s; p90 4,63 s; 95 % de las frases empiezan a oírse antes de que el pastor termine; calidad ≈ 4,74/5. `goAway` hacia 09:48 con reconexión. La corrida #2 tuvo un incidente de latencia después de ≈ 11:30 y terminó peor que la #1.
ERRORES ENCONTRADOS: Incidente de latencia en #2 → diagnóstico: **pendiente** (artefactos no compartidos) → corrección: ninguna → estado: `FALLÓ` sin diagnóstico.
EVIDENCIA: Solo en el PC del propietario (`runs/` está ignorado por git).

### 2026-10-06 21:27 UTC — Análisis por ventanas de PS4 (solicitado; bloqueado)
ETIQUETA: **HISTÓRICO RECONSTRUIDO** · FUENTE: conversación.
FASE: Laboratorio
OBJETIVO: Comparar Gemini #1 y #2 por ventanas de tiempo (0–10, 0–11:30, 11:30–fin) y explicar el incidente y el `goAway` de 09:48, en modo solo lectura.
QUÉ SE HIZO: Se confirmó estado de git (sin checkout, pull ni reset). No fue posible analizar: las carpetas de corrida no están en el contenedor. Se entregaron comandos CMD para que el propietario comparta los artefactos.
ESTADO AL TERMINAR: `BLOQUEADO` por artefactos. El propietario no dio seguimiento.
SIGUIENTE PASO: Si se retoma, el propietario copia las dos carpetas de corrida y `PS4.referencia.json` a una carpeta commiteable (`evidencia/`), sin los WAV.

### 2026-10-08 02:37 UTC — Arquitectura para la primera prueba humana (análisis)
ETIQUETA: **HISTÓRICO RECONSTRUIDO** · FUENTE: conversación.
FASE: Diseño
OBJETIVO: Propuesta para la primera prueba en vivo (1 pastor, 1 oyente, ES→EN), 27 preguntas, sin implementar.
QUÉ SE HIZO: Análisis entregado mediante workflows de agentes (el propietario después prohibió agentes). Propuesta inicial: hub propio por WebSocket + estación emisora en la iglesia.
RIESGOS DESCUBIERTOS: **Sesgo de arranque del banco** (`run.ts`: `t0` antes de `engine.start()`, `tStart` después; 1000 ms de arranque simulado llevaron el retraso medido de 800 a 1820 ms) → las cifras de PS4 están infladas por un monto desconocido. Defectos del adaptador Gemini del laboratorio (reconexión break-before-make, descarga del búfer de golpe, sin timeouts, errores HTTP fatales, 6 intentos, `stop()` durante reconexión, `usageMetadata` perdido). Realidades de iOS/Android (categoría de audio `playback`, Wake Lock, HTTPS, Bluetooth +0,1–0,3 s).
DECISIONES: Ninguna aprobada aún.

### 2026-10-08 04:52 UTC — Objetivo revisado por el propietario
ETIQUETA: **HISTÓRICO RECONSTRUIDO** · FUENTE: conversación.
FASE: Diseño
OBJETIVO: "Reducir la ESCALA de la prueba, no cambiar la ARQUITECTURA"; sin prototipos desechables; usar el mecanismo oficial de Gemini de sesión y reanudación salvo limitación demostrada; sin agentes.
QUÉ SE HIZO: Propuesta revisada (servidor en la nube, estación emisora en la iglesia, reanudación oficial). Se retiró la estrategia de "sesión nueva por defecto".
ERRORES ENCONTRADOS: La propuesta anterior sobreestimaba (afirmaciones sin medir, números de Bluetooth, placeholders que rompen CMD). Corregidos en la revisión.

### 2026-10-08 10:48 UTC — Adopción del repositorio oficial de Google
ETIQUETA: **HISTÓRICO RECONSTRUIDO** · FUENTE: conversación + clon local del repositorio de Google en el entorno de la sesión (no está en este repositorio).
FASE: Diseño
OBJETIVO: El propietario pidió detener el plan y evaluar `google-gemini/gemini-live-translate-livekit` como base.
QUÉ SE HIZO: Clon del repositorio (54 commits; último `26d9a62`, 2026-09-01; Apache 2.0; Next.js 16.2.6, React 19.2.4, `@livekit/rtc-node ^0.13.27`, `livekit-client ^2.19.0`, `livekit-server-sdk ^2.15.2`). Lectura completa de `translation-bridge.ts` (825 líneas), `translation-session-manager.ts` (256), páginas de cabina y oyente, rutas API, README y docs. Verificación de `@livekit/agents-plugin-google` 1.9.1: **no tiene `translationConfig`**, no sirve para el modelo de traducción. Investigación de LiveKit Cloud (planes, 100 conexiones en Build), LiveKit autoalojado (puertos UDP, TURN, Redis) y firewall de Hostinger.
RESULTADOS: Respuesta a las 5 preguntas del propietario. Admisión: debí proponer esta base desde el principio. Componentes reutilizables, faltantes, cuentas, programar vs configurar, camino más corto.
DECISIONES TOMADAS (por el propietario): **Base del producto = repositorio de Google. `voice-traductor` = laboratorio.** (ADR-001, ADR-002)

### 2026-10-08 ≈ 11:00 UTC — Plan de adaptación (14 puntos)
ETIQUETA: **HISTÓRICO RECONSTRUIDO** · FUENTE: conversación.
FASE: Diseño
QUÉ SE HIZO: Plan de adaptación: qué funciona sin cambios; cambios obligatorios O1–O9; mejoras futuras; ciclo del culto; sesiones largas; audio de consola; LiveKit como distribución; medición (5 puntos); conexión con el banco; infraestructura; decisión VPS vs Cloud Run; flujo final; partes demo a corregir; estrategia upstream.
ERRORES ENCONTRADOS (propios, corregidos): (1) Había afirmado que Cloud Run limita las sesiones a 1 hora; el límite de 60 min aplica a peticiones web entrantes, no a la conexión saliente del puente → corregido. (2) Había propuesto actualizar dependencias; retirado para mantener sincronización con Google. (3) Había afirmado "reanudación transparente solo en plataforma empresarial" sin explicar que se refería únicamente a la opción `transparent`; el propietario lo señaló → verificado y corregido (ver entrada siguiente).
DECISIONES TOMADAS (por el propietario): "La arquitectura general está aprobada." "El resto del plan queda aprobado conceptualmente."

### 2026-10-08 ≈ 11:20 UTC — Verificación del mecanismo oficial de sesiones de Gemini
ETIQUETA: **HISTÓRICO RECONSTRUIDO** · FUENTE: conversación + esquema v1beta de la API y SDK `@google/genai` 2.28.0 descargados en el entorno de la sesión.
FASE: Diseño
OBJETIVO: Verificar contra documentación oficial que la Developer API ofrece `sessionResumption`, `SessionResumptionUpdate`, handle, `goAway`, `contextWindowCompression`, 15 min solo audio sin compresión.
QUÉ SE HIZO: `ai.google.dev` bloqueado por el proxy del entorno. Verificado con: esquema público v1beta de la API (revisión 2026-10-06), SDK `@google/genai` 2.28.0 (última), guía oficial `gemini-live-api-dev/SKILL.md`, fragmentos de búsqueda de la página oficial.
RESULTADOS: Todo lo que el propietario enumeró **está** en la Developer API. Lo único que no está es la opción `transparent` / `lastConsumedClientMessageIndex` (el SDK lanza error en Developer API). El repositorio de Google ya implementa reanudación, guarda solo handles `resumable` y reconecta en `goAway`; solo le falta `contextWindowCompression`.
RIESGOS DESCUBIERTOS: Reporte en el foro de Google (sin respuesta oficial): con `gemini-3.8-live` las sesiones se cortan a los 58:00 (1011) y la reanudación falla (1007) aun con compresión. Otro modelo; pendiente de confirmar con nuestras pruebas de 60 y 90 min.
DECISIONES TOMADAS (por el propietario): **Probar primero el mecanismo oficial (> 20 min, ≥ 2 renovaciones). Solo si demuestra pérdida, duplicación o fallo real se implementa una estrategia adicional.** (ADR-005). Se retira del plan inicial la lógica de transición en pausa, drenaje, sesiones nuevas y vigilante.
ESTADO AL TERMINAR: Plan aprobado; nada implementado; repositorio del producto no creado.

---

## Entradas

### 2026-10-08 12:30 UTC — Creación del contrato de trabajo y la memoria técnica
FASE: Previa a Fase 0 (documentación)
BRANCH: `claude/happy-lovelace-7x2zam`
COMMIT INICIAL: `0584372`
OBJETIVO DE LA SESIÓN: Crear la documentación oficial del proyecto (contrato, estado, bitácora, decisiones, infraestructura) basada en el estado real, sin implementar, sin instalar dependencias, sin crear el fork, sin agentes.
QUÉ SE HIZO: Revisión del repositorio (`git status` limpio, HEAD `0584372`), ejecución de las pruebas y del typecheck, inventario de `runs/` (vacío), `samples/` (solo README), `docs/`, motores y comandos del banco. Relectura del clon del repositorio de Google. Búsqueda en el registro de la sesión de las cifras reales de PS4 y OpenAI. Verificación de especificaciones de Hostinger VPS (KVM 2: 2 vCPU, 8 GB, 100 GB NVMe, 8 TB; centros de datos en EE. UU.: Boston y Phoenix) y de los requisitos de recursos del README de Google (≈ 20–30 MiB y ≈ 10 % de vCPU por puente). Redacción de los documentos.
ARCHIVOS MODIFICADOS: Nuevos: `PROJECT_CONTRACT.md`, `PROJECT_STATUS.md`, `BITACORA.md`, `DECISIONS.md`, `INFRAESTRUCTURA.md`, `CLAUDE.md`. Modificado: `README.md` (enlace a la documentación de proyecto).
PRUEBAS EJECUTADAS: `npm test` → 43 pasan, 0 fallan (28 s). `npm run typecheck` → sin errores.
COMANDOS IMPORTANTES: `npm test`; `npm run typecheck`; `git log --format='%h %ad %s' --date=short`.
RESULTADOS: Documentación creada. Ninguna fase marcada HECHA (no existe evidencia de ejecución del código de Google).
ERRORES ENCONTRADOS: Ninguno en código. Contradicciones documentales encontradas y registradas en `PROJECT_STATUS.md` §4 y en la respuesta al propietario: (1) la meta "promedio de 2 s" del propietario no coincide con la única línea base registrada de Gemini (mediana fin→fin 2,88 s con sesgo de arranque; p90 4,63 s); (2) las cifras de PS4 no tienen artefactos en el repositorio; (3) el README del laboratorio habla de "Español → Inglés, Inglés → Español" y el objetivo actual aprobado es solo ES→EN; (4) el cupo gratuito de LiveKit Cloud difiere entre el README de Google y fuentes de terceros.
RIESGOS DESCUBIERTOS: `GET /api/sessions` del código de Google lista todas las sesiones sin autenticación (fuga de información; se suma a O2). El código de Google no imprime la URL con la clave de Gemini, pero un error del WebSocket podría incluirla en logs: añadir a la revisión de O2.
DECISIONES TOMADAS: Ninguna arquitectónica nueva. Se registran en `DECISIONS.md` las ya aprobadas (ADR-001 a ADR-014) y las rechazadas.
COSAS NO RESUELTAS: Cuentas externas sin crear. Artefactos PS4 sin compartir. Marca de la consola de la iglesia desconocida.
ESTADO AL TERMINAR: Documentación creada, pendiente de revisión del propietario. FASE 0 `PENDIENTE`.
COMMIT FINAL: El commit que contiene esta entrada (ver `git log -1`).
SIGUIENTE PASO EXACTO: El propietario revisa estos documentos y aprueba. Luego Fase 0 según `PROJECT_STATUS.md` §5: crear cuenta LiveKit Cloud y clave Gemini de pago (en `.env.local`), clonar el repositorio de Google sin cambios, `npm.cmd install`, `npm.cmd run dev`, prueba ≥ 12 min con un `goAway` registrado, evidencia en `evidencia/`.

### 2026-10-08 13:30 UTC — Revisión documental final antes de Fase 0
FASE: Previa a Fase 0 (documentación)
BRANCH: `claude/happy-lovelace-7x2zam`
COMMIT INICIAL: `af16dfd`
OBJETIVO DE LA SESIÓN: Cerrar la decisión de infraestructura con evidencia clasificada (hecho documentado / inferencia técnica / estimación pendiente de validación), justificar cultos de 60 y 90 min, detallar latencia por tramo, región, capacidad y costos; dejar explícita la separación PRODUCTO vs LABORATORIO; documentar el stack canónico y la fuente de verdad documental; etiquetar el historial reconstruido; reducir `CLAUDE.md`. Sin implementar, sin agentes, sin iniciar Fase 0.
QUÉ SE HIZO: Consulta de fuentes adicionales (contrato de runtime de Cloud Run y página de WebSockets, migración en vivo de Compute Engine, planes y uptime de Hostinger, malla y regiones de LiveKit Cloud) a través del buscador, porque `docs.cloud.google.com`, `docs.livekit.io` y `hostinger.com` están bloqueados por el proxy del entorno. Reescritura de `INFRAESTRUCTURA.md` (v1.1) con §1 decisión y evidencia (opciones, fuentes, criterios, hallazgos, clasificación), §2 cultos largos con riesgos por responsable, §3 latencia por tramo con qué se mide en cada fase, §4 región Boston como RECOMENDADA PARA PRUEBA, §5 requisito mínimo / recomendación / estimación y protocolo de medición de capacidad, §6 costos fijos / variables / únicos con el dominio como costo de plataforma. Contrato v1.1: §D producto vs laboratorio explícito, §I dominio y regla de capacidad, §S stack canónico, §T fuente de verdad y migración. `DECISIONS.md`: ADR-009 reescrita con evidencia clasificada; nuevas ADR-015 (fuente de verdad), ADR-016 (stack canónico), ADR-017 (dominio de plataforma); PEN-004 y PEN-010. `PROJECT_STATUS.md`: métricas PS4 marcadas como RESULTADOS HISTÓRICOS REPORTADOS, tabla producto vs laboratorio, riesgos R12 y R13. `BITACORA.md`: etiqueta HISTÓRICO RECONSTRUIDO y FUENTE en cada entrada reconstruida. `CLAUDE.md` reducido a puerta de entrada.
ARCHIVOS MODIFICADOS: `INFRAESTRUCTURA.md`, `PROJECT_CONTRACT.md`, `PROJECT_STATUS.md`, `DECISIONS.md`, `BITACORA.md`, `CLAUDE.md`.
PRUEBAS EJECUTADAS: Ninguna de código (no hubo cambios de código). Las 43 pruebas siguen siendo las de la entrada anterior.
COMANDOS IMPORTANTES: búsquedas web (ver `INFRAESTRUCTURA.md` §15).
RESULTADOS: Decisión de infraestructura cerrada como ADR-009 con sus tres categorías de evidencia. Corrección registrada: el límite de 60 min de Cloud Run aplica a WebSockets entrantes, no a la conexión saliente con Gemini. Hallazgo nuevo: LiveKit Cloud no permite elegir región de sesión sin el plan Scale; conecta al borde más cercano. Afirmación de un tercero, no verificada, sobre un umbral de CPU no documentado en Hostinger: registrada como riesgo R12.
ERRORES ENCONTRADOS: Ninguno en código. Afirmación mía anterior corregida: "LiveKit Cloud, región US East" → la región de sesión no se elige.
RIESGOS DESCUBIERTOS: R12 (umbral de CPU en Hostinger, afirmación de tercero); R13 (región Boston sin evidencia medida).
DECISIONES TOMADAS: ADR-015, ADR-016, ADR-017 (registro de decisiones del propietario en esta revisión). ADR-009 pasa a tener evidencia clasificada; sigue `APROBADA CONCEPTUALMENTE` hasta la Fase 5.
COSAS NO RESUELTAS: Las mismas de la entrada anterior (cuentas externas, artefactos PS4, consola de la iglesia). Región y capacidad del VPS pendientes de medición (Fase 5).
ESTADO AL TERMINAR: Documentación revisada. FASE 0 `PENDIENTE`.
COMMIT FINAL: El commit que contiene esta entrada (ver `git log -1`).
SIGUIENTE PASO EXACTO: Aprobación del propietario de esta revisión. Luego Fase 0 según `PROJECT_STATUS.md` §5.

### 2026-10-08 13:45 UTC — Fase 0: registro previo, instalación en Linux y herramientas de evidencia
FASE: 0 (código original de Google, sin modificar)
BRANCH: `claude/happy-lovelace-7x2zam`
COMMIT INICIAL: `3944b18`
OBJETIVO DE LA SESIÓN: Iniciar la Fase 0 aprobada por el propietario: registrar el entorno, verificar que el código original instala y arranca con sus dependencias exactas, y preparar la captura de evidencia para la prueba real (que requiere claves, un teléfono y una persona, y por eso corre en el PC del propietario). Sin agentes. Sin modificar el código de Google.
REGISTRO PREVIO EXIGIDO:
- Laboratorio: branch `claude/happy-lovelace-7x2zam`, commit `3944b18`, árbol limpio.
- Upstream de Google que se prueba: `26d9a620a85410ad8c902106d3a4d3a4edfd2968` (HEAD de `origin/main`, 2026-09-01, verificado con `git fetch` hoy).
- Node: v22.22.0 y npm 10.9.4 en el contenedor de esta sesión. Los del PC Windows del propietario se registran en `evidencia/fase-0/entorno-pc.txt` (paso 3 del protocolo).
- Sistema operativo: contenedor Ubuntu 24.04.4 LTS x86_64; PC del propietario: Windows (versión pendiente de registrar).
- Modelo Gemini: `gemini-3.5-live-translate-preview` (fijado en `src/lib/translation-bridge.ts:70`), entrada 48 kHz en tramas de 100 ms, salida 24 kHz.
- Dependencias que instala el proyecto (`package-lock.json`, lockfileVersion 3): next 16.2.6, react 19.2.4, react-dom 19.2.4, @livekit/rtc-node 0.13.27 (+ @livekit/rtc-ffi-bindings 0.12.52-patch.0 con binario por plataforma), livekit-client 2.19.0, livekit-server-sdk 2.15.2, @livekit/components-react 2.9.21, @livekit/components-styles 1.2.0, ws 8.20.1, uuid 14.0.0, qrcode.react 4.2.0, typescript 5.9.3, eslint 9.39.4.
- Configuración LiveKit: la del código original (puente con `autoSubscribe: false`, `dynacast: false`, identidad `translator-en`; oyente con `autoSubscribe: false`; JWT con TTL 4 h). Proyecto de LiveKit Cloud: por crear por el propietario (plan Build; sin región de sesión que elegir).
QUÉ SE HIZO: (1) Clon del repositorio oficial en un lugar separado, en el commit exacto; `npm ci` (413 paquetes, 19 s); `npm run build` (12 s, `output: standalone`); arranque de humo sin claves con curl a `/`, `/api/auth/status`, `/api/sessions` (GET y POST) y `/api/token` (500 esperado sin claves). (2) Verificado que el binario nativo para Windows x64 (`@livekit/rtc-ffi-bindings-win32-x64-msvc@0.12.52-patch.0`) existe en npm. (3) Herramientas del laboratorio, sin tocar la app de Google: `tools/fase0-run.ps1` (envuelve `npm run dev`, fecha cada línea, redacta handles y claves, guarda copia) y `tools/analizar-consola-fase0.ts` (línea de tiempo, renovaciones, errores, criterios comprobables, detector de secretos), con el script `npm run fase0:analizar`. (4) Protocolo paso a paso para el PC en `evidencia/fase-0/README.md` y plantilla `observacion-oyente.md`. (5) Corrección pedida por el propietario en `INFRAESTRUCTURA.md`: Hostinger no documenta CPU dedicada; queda "2 vCPU" y `steal` como métrica de validación.
ARCHIVOS MODIFICADOS: Nuevos: `tools/fase0-run.ps1`, `tools/analizar-consola-fase0.ts`, `evidencia/fase-0/README.md`, `evidencia/fase-0/00-instalacion-linux.md`, `evidencia/fase-0/observacion-oyente.md`. Modificados: `package.json` (script `fase0:analizar`), `INFRAESTRUCTURA.md`, `PROJECT_STATUS.md`, `BITACORA.md`, `CLAUDE.md`.
PRUEBAS EJECUTADAS: Instalación, build y arranque de humo del código de Google en Linux (resultados en `evidencia/fase-0/00-instalacion-linux.md`). Analizador probado con dos logs sintéticos con el formato exacto de los mensajes del código de Google: log limpio → línea de tiempo con una renovación, código de salida 0; log con un handle completo → aviso y código de salida 2. `npm test` del laboratorio y `npm run typecheck`.
COMANDOS IMPORTANTES: `git checkout 26d9a620a85410ad8c902106d3a4d3a4edfd2968`; `npm ci`; `npm run build`; `PORT=3100 node .next/standalone/server.js`; `npm run fase0:analizar -- <log>`.
RESULTADOS: El código original instala, construye y arranca en Linux con sus dependencias exactas. Nada más se puede afirmar: sin claves no hay conexión con LiveKit ni con Gemini.
ERRORES ENCONTRADOS: Analizador, primera versión: marcaba como "secreto sin redactar" el handle ya redactado en el JSON del setup, tomaba una línea sin fecha como fin del log y contaba el cierre normal al detener el puente como cierre inesperado → diagnóstico: expresiones regulares demasiado amplias → corrección: excluir `[redactado`, exigir marca de tiempo y descontar cierres dentro de 5 s de `Stopping bridge` → prueba: logs sintéticos → resultado: corregido.
RIESGOS DESCUBIERTOS: El código original de Google imprime el handle de reanudación **completo** en dos lugares (`Reconnecting Gemini WebSocket with handle: …` y el JSON del setup). El script de captura lo redacta; para la Fase 1 queda anotado que el producto no debe imprimirlo (se suma a O2/S5). `[TokenAPI]` imprime el objeto de la sesión (sin secretos).
DECISIONES TOMADAS: Ninguna arquitectónica.
COSAS NO RESUELTAS: La prueba real completa (conexión con LiveKit y Gemini, ES→EN, teléfono, ≥ 12 min, un `goAway`, observación humana). Cuentas y claves no creadas.
ESTADO AL TERMINAR: FASE 0 `BLOQUEADO`: preparación hecha; la prueba real depende de cuentas, claves, PC, teléfono y una persona, todo del lado del propietario. No se marca HECHA ni EN CURSO.
COMMIT FINAL: El commit que contiene esta entrada (ver `git log -1`).
SIGUIENTE PASO EXACTO: El propietario ejecuta `evidencia/fase-0/README.md` pasos 1 a 8 en su PC (clon en el commit exacto, `npm.cmd ci`, `.env.local`, `tools\fase0-run.ps1`, prueba corta, prueba ≥ 12 min con teléfono y `observacion-oyente.md`, `npm.cmd run fase0:analizar`), commitea `evidencia/fase-0` y avisa. Con esa evidencia se decide PASS o FAIL y se actualizan `BITACORA.md` y `PROJECT_STATUS.md`.

### 2026-10-08 14:20 UTC — Fase 0: duración 15–25 min y requisito del medidor de consumo
FASE: 0 (sin iniciar la prueba real)
BRANCH: `claude/happy-lovelace-7x2zam`
COMMIT INICIAL: `50c7db3`
OBJETIVO DE LA SESIÓN: Aplicar dos ajustes del propietario antes de la prueba real: (1) la prueba continua de la Fase 0 pasa de ≥ 12 min a 15–25 min (objetivo 20–25) para atravesar renovaciones y observar el comportamiento después del minuto 15 sin `contextWindowCompression`, sin corregir nada durante la fase; (2) registrar como requisito del producto un MASTER de consumo de infraestructura (LiveKit mensual con barra y alertas 80/90/95 %; capacidad simultánea; Gemini), con medición propia como fuente primaria y separación entre PROVIDER LIMITS y CUSTOMER PLAN LIMITS, sin implementar billing. Sin agentes. Sin modificar el código de Google.
QUÉ SE HIZO: Investigación de fuentes de datos de consumo (LiveKit: cuotas y límites, facturación, Analytics API, webhooks, RoomService; Gemini: `usageMetadata` en el SDK oficial). Hallazgos: la Analytics API de LiveKit exige plan Scale y no devuelve minutos-participante; el plan Build tiene 5 000 minutos-participante WebRTC al mes con **tope duro** (las conexiones nuevas fallan al agotarse); los webhooks `participant_joined`/`participant_left`/`participant_connection_aborted`/`room_finished` y las API `ListRooms`/`ListParticipants` están disponibles con la clave de API; LiveKit redondea cada conexión hacia arriba al minuto; los agentes autoalojados cuentan como minutos-participante (nuestro puente cuenta); `LiveServerMessage.usageMetadata` existe en el SDK 2.28.0 (no lo lee ni el puente de Google ni el adaptador del laboratorio). Documentado en `PROJECT_CONTRACT.md` §U, `INFRAESTRUCTURA.md` §16, `DECISIONS.md` ADR-018, PEN-012 y PEN-013, `PROJECT_STATUS.md` (START HERE punto 12, riesgo R14, tarea 8 de la Fase 1). Fase 0: `evidencia/fase-0/README.md` (objetivo, sermón de ≥ 25 min, paso 7 con qué esperar en los minutos 9–10, 15 y 19–20 y la regla de no corregir), `observacion-oyente.md` (preguntas 11–13 y una fila cada 5 min), `tools/analizar-consola-fase0.ts` (criterio ≥ 15 min, criterio "la sesión pasó del minuto 15 con audio", sección "Después del minuto 15" y marca de "posible límite de sesión" en cierres 1008/1011 o con razones de límite), `PROJECT_STATUS.md` (criterios y tareas de la Fase 0 con la nueva duración).
ARCHIVOS MODIFICADOS: `PROJECT_CONTRACT.md`, `INFRAESTRUCTURA.md`, `DECISIONS.md`, `PROJECT_STATUS.md`, `BITACORA.md`, `evidencia/fase-0/README.md`, `evidencia/fase-0/observacion-oyente.md`, `tools/analizar-consola-fase0.ts`.
PRUEBAS EJECUTADAS: Analizador sobre el log sintético de 13 min: los criterios nuevos de duración salen `NO CUMPLE` como corresponde y la sección "Después del minuto 15" informa que la consola termina antes del minuto 15 del canal; código de salida 0. No hubo cambios en el código del laboratorio (`packages/`, `apps/`).
COMANDOS IMPORTANTES: `npm run fase0:analizar -- <log>`.
RESULTADOS: Protocolo y herramientas de la Fase 0 ajustados a 15–25 min. Requisito del medidor registrado con fuentes.
ERRORES ENCONTRADOS: Afirmación mía errónea detectada antes de commitear: "nuestro adaptador de laboratorio ya lee `usageMetadata`" → verificación con `grep` → no lo lee → corregido en `INFRAESTRUCTURA.md` §16.
RIESGOS DESCUBIERTOS: R14: tope duro del plan Build de LiveKit (5 000 min/mes); un culto de 90 min con un oyente consume ≈ 270 min (cabina + puente + oyente). Discrepancia de cupo: 5 000 min (LiveKit, oct-2026) frente a 50 horas-participante (README de Google); se cierra con el panel tras la Fase 0 (PEN-012).
DECISIONES TOMADAS: ADR-018 (medición propia como fuente primaria; proveedor reconcilia; PROVIDER LIMITS separados de CUSTOMER PLAN LIMITS; sin billing ahora).
COSAS NO RESUELTAS: La prueba real de la Fase 0 sigue pendiente del lado del propietario.
ESTADO AL TERMINAR: FASE 0 `BLOQUEADO` (igual que antes; protocolo actualizado).
COMMIT FINAL: El commit que contiene esta entrada (ver `git log -1`).
SIGUIENTE PASO EXACTO: El propietario ejecuta `evidencia/fase-0/README.md` pasos 1–8 con la prueba continua de 15–25 min (objetivo 20–25), commitea `evidencia/fase-0` y avisa. No se avanza a la Fase 1 sin su aprobación.

### 2026-10-08 14:45 UTC — Fase 0: regla de revisión de secretos y vocabulario del resultado
FASE: 0 (sin iniciar la prueba real)
BRANCH: `claude/happy-lovelace-7x2zam`
COMMIT INICIAL: `577e28f`
OBJETIVO DE LA SESIÓN: Agregar las dos reglas pedidas por el propietario antes de la prueba real, y nada más: (1) revisión de secretos obligatoria antes de cualquier commit de evidencia; (2) el resultado de la Fase 0 nombra lo que se probó: `FASE 0 ORIGINAL GOOGLE: FAIL EN SESIÓN LARGA / LIMITACIÓN IDENTIFICADA` si el código original funciona pero se detiene hacia el minuto 15 por no enviar `contextWindowCompression`, nunca "Voice Traductor no funciona". Sin agentes. Sin modificar el código de Google.
QUÉ SE HIZO: (1) `tools/revisar-secretos.ts` con el script `npm run secretos`: revisa lo preparado para commit y toda `evidencia/`; falla con código 2 ante `.env`/`.env.local` o llaves privadas preparadas, claves de API de Google/OpenAI/DashScope/LiveKit, asignaciones de secretos con valor, URLs con credenciales, handles completos de Gemini, tokens JWT y bloques de llave privada; nunca imprime el secreto completo. Regla escrita en `PROJECT_CONTRACT.md` §Q, `PROJECT_STATUS.md` Fase 0, `evidencia/fase-0/README.md` paso 8 y `CLAUDE.md`. (2) Vocabulario del resultado (PASS · FAIL EN SESIÓN LARGA / LIMITACIÓN IDENTIFICADA · FAIL · INCOMPLETA · BLOQUEADO) en `evidencia/fase-0/README.md`, `PROJECT_STATUS.md` Fase 0 y `PROJECT_CONTRACT.md` §Q; el analizador imprime un "resultado sugerido" con ese vocabulario, que el propietario confirma con la observación humana.
ARCHIVOS MODIFICADOS: Nuevo: `tools/revisar-secretos.ts`. Modificados: `package.json` (script `secretos`), `tools/analizar-consola-fase0.ts`, `evidencia/fase-0/README.md`, `PROJECT_CONTRACT.md`, `PROJECT_STATUS.md`, `CLAUDE.md`, `BITACORA.md`.
PRUEBAS EJECUTADAS: Revisión de secretos: repositorio actual limpio (3 archivos de `evidencia/`, código 0); carpeta con secretos falsos (clave `AIza…`, clave `API…` de LiveKit, secreto de LiveKit, JWT en URL, handle completo, URL `usuario:clave@`, `.env.local`) → 10 hallazgos, código 2; archivo falso preparado para commit con `BROADCAST_PASSWORD=` → detectado como preparado y en carpeta, código 2; después se quitó del índice y se borró. Analizador: log sintético de 13 min → "INCOMPLETA"; log sintético con cierre 1011 "Deadline expired" al minuto 15 y handle rechazado (1007) → "FASE 0 ORIGINAL GOOGLE: FAIL EN SESIÓN LARGA / LIMITACIÓN IDENTIFICADA" y sección "Después del minuto 15" con ambos cierres marcados como posible límite de sesión.
COMANDOS IMPORTANTES: `npm run secretos` · `npm run secretos -- --dir <carpeta>` · `npm run fase0:analizar -- <log>`.
RESULTADOS: Reglas registradas y herramientas probadas. Ningún otro cambio.
ERRORES ENCONTRADOS: Durante la prueba del revisor, dos patrones daban falsos positivos con los ejemplos de la propia documentación (`?key=`/`?token=` entre acentos graves) → corrección: excluir acentos graves y paréntesis de los valores → prueba: repositorio limpio → resultado: 0 hallazgos.
RIESGOS DESCUBIERTOS: Ninguno nuevo.
DECISIONES TOMADAS: Ninguna arquitectónica.
COSAS NO RESUELTAS: La prueba real de la Fase 0, del lado del propietario.
ESTADO AL TERMINAR: FASE 0 `BLOQUEADO` (protocolo completo; esperando la ejecución del propietario).
COMMIT FINAL: El commit que contiene esta entrada (ver `git log -1`).
SIGUIENTE PASO EXACTO: El propietario ejecuta `evidencia/fase-0/README.md` pasos 1–8 (prueba continua de 15–25 min, objetivo 20–25), corre `npm.cmd run secretos` antes del commit de `evidencia/fase-0`, hace push y avisa. Se vuelve a ejecutar la revisión de secretos al recibir la evidencia, se decide el resultado con el vocabulario de la Fase 0 y se actualizan `BITACORA.md` y `PROJECT_STATUS.md`. No se avanza a la Fase 1 sin aprobación.

### 2026-10-08 15:05 UTC — Fase 0: ¿puede el entorno web de Claude Code ejecutar la prueba real?
FASE: 0 (sin iniciar la prueba real)
BRANCH: `claude/happy-lovelace-7x2zam`
COMMIT INICIAL: `d354b61`
OBJETIVO DE LA SESIÓN: El propietario ya tiene `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` y `GEMINI_API_KEY` y usa Claude Code en la web, no CMD local. Determinar con evidencia si este contenedor puede correr la Fase 0 (LiveKit + Gemini + acceso desde el teléfono) y cómo configurar las credenciales sin pegarlas en el chat.
QUÉ SE HIZO: Pruebas de red desde el contenedor (sin claves): HTTPS vía proxy a `generativelanguage.googleapis.com` → 200 (y el endpoint WebSocket de Live API responde 404 de Google, es decir, alcanzable); HTTPS a `cloud.livekit.io`, `cloud-api.livekit.io` y `api.trycloudflare.com` → 000 (denegados por la política de red del entorno); TCP directo sin proxy a `cloud.livekit.io` → 403 del gateway (todo el egreso pasa por la política); UDP (STUN a `stun.l.google.com:19302`) → sin respuesta en 4 s (bloqueado); sin `cloudflared` ni `ngrok`; no existe ruta de entrada hacia el contenedor. Lectura de la documentación del entorno sobre secretos y red.
RESULTADOS: **Este entorno no puede ejecutar la Fase 0 de punta a punta.** Lo que impide la prueba: (1) sin UDP y sin TCP directo, el puente (`@livekit/rtc-node`, WebRTC) no puede unirse a la sala de LiveKit Cloud; (2) no hay forma de que el teléfono alcance un servidor dentro del contenedor (sin entrada, túneles bloqueados). Lo que sí puede hacer este entorno: hablar con Gemini por WebSocket (validar la clave y el modelo), construir y arrancar la app, preparar archivos de despliegue y analizar la evidencia. Permitir los dominios de LiveKit en la política de red serviría solo para validar las claves por HTTPS (`ListRooms`), no para el audio.
RIESGOS DESCUBIERTOS: Ninguno nuevo del producto. Para la Fase 0, el servidor debe correr donde haya UDP de salida y HTTPS de entrada: el PC del propietario (protocolo CMD ya escrito) o un VPS (Docker + Caddy con el código de Google sin modificar).
DECISIONES TOMADAS: Ninguna; se le presentan las dos opciones al propietario.
ESTADO AL TERMINAR: FASE 0 `BLOQUEADO`.
COMMIT FINAL: El commit que contiene esta entrada.
SIGUIENTE PASO EXACTO: El propietario guarda las credenciales como secretos del entorno (nombres: `GEMINI_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `BROADCAST_PASSWORD`) y elige dónde correrá el servidor de la prueba (PC o VPS). Con los secretos en una sesión nueva se valida la clave de Gemini desde aquí y se preparan los archivos de despliegue si elige VPS.
