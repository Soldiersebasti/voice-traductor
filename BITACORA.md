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

Entradas reconstruidas el 2026-10-08 a partir de `git log` y de la conversación con el propietario. Las horas son aproximadas; las cifras citadas son las que el propietario o los documentos reportaron.

### 2026-10-05 — Nacimiento del laboratorio
FASE: Laboratorio (previo al plan por fases)
BRANCH: `claude/happy-lovelace-7x2zam`
COMMITS: `4e9fd50` initial · `ff9ed92` README con visión y requisitos · `ad3aa07` adaptadores de motores y banco offline · `6137587` latencia como criterio de aprobación (retraso percibido y pruebas interactivas) · `23c8039` opciones de voz de OpenAI y lecciones de Glossa y LiveVoice · `51afc0e` medición de interpretación continua
QUÉ SE HIZO: Monorepo npm (TypeScript, tsx, Node 22, `ws` como única dependencia de runtime). Contrato `TranslationEngine`; adaptadores OpenAI (`gpt-realtime-translate`), Gemini (`gemini-3.5-live-translate-preview`) y mock. Banco `run` con `eventos.jsonl`, `metricas.json`, `resumen.md`, WAV de comparación. Juez automático (`judge`) con retraso percibido frase a frase y deriva. Umbral del MVP: 3 s.
PRUEBAS EJECUTADAS: Pruebas unitarias con motor simulado (retraso conocido medido exactamente). Corrida real OpenAI con prédica PS1 (15 min).
RESULTADOS: OpenAI: calidad 4,91/5, cero omisiones, 65 % de frases empiezan antes de que el pastor termine; **fin→fin mediana 4,15 s, p90 7,27 s, 80 % del tiempo sobre 3 s, huecos de hasta 10,5 s, 9 saltos** → `FALLÓ` el criterio de latencia.
DECISIONES: Latencia como criterio de aprobación; una sesión por idioma como principio (README).
ESTADO AL TERMINAR: Laboratorio funcional; OpenAI descartado como motor principal.

### 2026-10-06 — Diagnóstico, estado del arte, Hibiki, proveedores, Qwen
FASE: Laboratorio
COMMITS: `270b46f` diagnóstico de latencia y simulación de reproducción adaptativa · `a9d2e24` estado del arte y forense de huecos de llegada · `3c154cd` Hibiki-Zero vía puente Python · `c5b7413` mapa de proveedores y alternativas · `0584372` Qwen3.8-LiveTranslate como motor del banco
QUÉ SE HIZO: `diagnose` (de dónde viene el retraso: modelo vs cola vs reproducción), `replay` (simulación de reproducción acelerada sin volver a llamar al modelo). Documento de estado del arte. Adaptador Hibiki-Zero (requiere GPU; puente `tools/hibiki_bridge.py`). Documento de alternativas de proveedores. Adaptador Qwen con `session.update`, ping RTT, `audio.first_output`, rotación a 110 min, reconexión con búfer de 10 s, registro crudo por fragmento.
PRUEBAS EJECUTADAS: `replay` sobre la corrida OpenAI: inicio→inicio 7,59 → 6,15 s; fin→fin sigue en 4,15 s; 74 % del tiempo sobre 3 s → acelerar la reproducción no resuelve. Pruebas unitarias de Qwen (la primera versión falló porque `stop()` retornaba antes del evento de cierre; se corrigió esperando el cierre con tope de 1 s; pasan).
ERRORES ENCONTRADOS: Qwen `session.closed` ausente → diagnóstico: `stop()` no esperaba el cierre → corrección: esperar `close` con `sleep(1000)` de tope → prueba: unitaria → resultado: pasa.
RESULTADOS: 43 pruebas pasan. Qwen y Hibiki quedan `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` (sin corrida real).
COSAS NO RESUELTAS: Cuenta de Alibaba Model Studio no activada; GPU para Hibiki no confirmada.

### 2026-10-06 (antes de 21:27 UTC) — Corridas reales de Gemini con PS4 (en el PC del propietario)
FASE: Laboratorio
QUÉ SE HIZO: El propietario corrió dos veces el motor Gemini con la prédica PS4 (`runs/ps4-gemini-gemini`, `runs/ps4-gemini-2-gemini`) con referencia `samples/PS4.referencia.json`.
RESULTADOS (reportados por el propietario): primer audio 3,50 s; fin→fin mediana 2,88 s; p90 4,63 s; 95 % de las frases empiezan a oírse antes de que el pastor termine; calidad ≈ 4,74/5. `goAway` hacia 09:48 con reconexión. La corrida #2 tuvo un incidente de latencia después de ≈ 11:30 y terminó peor que la #1.
ERRORES ENCONTRADOS: Incidente de latencia en #2 → diagnóstico: **pendiente** (artefactos no compartidos) → corrección: ninguna → estado: `FALLÓ` sin diagnóstico.
EVIDENCIA: Solo en el PC del propietario (`runs/` está ignorado por git).

### 2026-10-06 21:27 UTC — Análisis por ventanas de PS4 (solicitado; bloqueado)
FASE: Laboratorio
OBJETIVO: Comparar Gemini #1 y #2 por ventanas de tiempo (0–10, 0–11:30, 11:30–fin) y explicar el incidente y el `goAway` de 09:48, en modo solo lectura.
QUÉ SE HIZO: Se confirmó estado de git (sin checkout, pull ni reset). No fue posible analizar: las carpetas de corrida no están en el contenedor. Se entregaron comandos CMD para que el propietario comparta los artefactos.
ESTADO AL TERMINAR: `BLOQUEADO` por artefactos. El propietario no dio seguimiento.
SIGUIENTE PASO: Si se retoma, el propietario copia las dos carpetas de corrida y `PS4.referencia.json` a una carpeta commiteable (`evidencia/`), sin los WAV.

### 2026-10-08 02:37 UTC — Arquitectura para la primera prueba humana (análisis)
FASE: Diseño
OBJETIVO: Propuesta para la primera prueba en vivo (1 pastor, 1 oyente, ES→EN), 27 preguntas, sin implementar.
QUÉ SE HIZO: Análisis entregado mediante workflows de agentes (el propietario después prohibió agentes). Propuesta inicial: hub propio por WebSocket + estación emisora en la iglesia.
RIESGOS DESCUBIERTOS: **Sesgo de arranque del banco** (`run.ts`: `t0` antes de `engine.start()`, `tStart` después; 1000 ms de arranque simulado llevaron el retraso medido de 800 a 1820 ms) → las cifras de PS4 están infladas por un monto desconocido. Defectos del adaptador Gemini del laboratorio (reconexión break-before-make, descarga del búfer de golpe, sin timeouts, errores HTTP fatales, 6 intentos, `stop()` durante reconexión, `usageMetadata` perdido). Realidades de iOS/Android (categoría de audio `playback`, Wake Lock, HTTPS, Bluetooth +0,1–0,3 s).
DECISIONES: Ninguna aprobada aún.

### 2026-10-08 04:52 UTC — Objetivo revisado por el propietario
FASE: Diseño
OBJETIVO: "Reducir la ESCALA de la prueba, no cambiar la ARQUITECTURA"; sin prototipos desechables; usar el mecanismo oficial de Gemini de sesión y reanudación salvo limitación demostrada; sin agentes.
QUÉ SE HIZO: Propuesta revisada (servidor en la nube, estación emisora en la iglesia, reanudación oficial). Se retiró la estrategia de "sesión nueva por defecto".
ERRORES ENCONTRADOS: La propuesta anterior sobreestimaba (afirmaciones sin medir, números de Bluetooth, placeholders que rompen CMD). Corregidos en la revisión.

### 2026-10-08 10:48 UTC — Adopción del repositorio oficial de Google
FASE: Diseño
OBJETIVO: El propietario pidió detener el plan y evaluar `google-gemini/gemini-live-translate-livekit` como base.
QUÉ SE HIZO: Clon del repositorio (54 commits; último `26d9a62`, 2026-09-01; Apache 2.0; Next.js 16.2.6, React 19.2.4, `@livekit/rtc-node ^0.13.27`, `livekit-client ^2.19.0`, `livekit-server-sdk ^2.15.2`). Lectura completa de `translation-bridge.ts` (825 líneas), `translation-session-manager.ts` (256), páginas de cabina y oyente, rutas API, README y docs. Verificación de `@livekit/agents-plugin-google` 1.9.1: **no tiene `translationConfig`**, no sirve para el modelo de traducción. Investigación de LiveKit Cloud (planes, 100 conexiones en Build), LiveKit autoalojado (puertos UDP, TURN, Redis) y firewall de Hostinger.
RESULTADOS: Respuesta a las 5 preguntas del propietario. Admisión: debí proponer esta base desde el principio. Componentes reutilizables, faltantes, cuentas, programar vs configurar, camino más corto.
DECISIONES TOMADAS (por el propietario): **Base del producto = repositorio de Google. `voice-traductor` = laboratorio.** (ADR-001, ADR-002)

### 2026-10-08 ≈ 11:00 UTC — Plan de adaptación (14 puntos)
FASE: Diseño
QUÉ SE HIZO: Plan de adaptación: qué funciona sin cambios; cambios obligatorios O1–O9; mejoras futuras; ciclo del culto; sesiones largas; audio de consola; LiveKit como distribución; medición (5 puntos); conexión con el banco; infraestructura; decisión VPS vs Cloud Run; flujo final; partes demo a corregir; estrategia upstream.
ERRORES ENCONTRADOS (propios, corregidos): (1) Había afirmado que Cloud Run limita las sesiones a 1 hora; el límite de 60 min aplica a peticiones web entrantes, no a la conexión saliente del puente → corregido. (2) Había propuesto actualizar dependencias; retirado para mantener sincronización con Google. (3) Había afirmado "reanudación transparente solo en plataforma empresarial" sin explicar que se refería únicamente a la opción `transparent`; el propietario lo señaló → verificado y corregido (ver entrada siguiente).
DECISIONES TOMADAS (por el propietario): "La arquitectura general está aprobada." "El resto del plan queda aprobado conceptualmente."

### 2026-10-08 ≈ 11:20 UTC — Verificación del mecanismo oficial de sesiones de Gemini
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
