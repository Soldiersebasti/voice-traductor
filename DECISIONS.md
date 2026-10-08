# DECISIONS.md — Registro de decisiones arquitectónicas (ADR)

Cada decisión importante se registra aquí con: ID, fecha, estado, problema, alternativas consideradas, decisión, por qué, evidencia, consecuencias y qué tendría que ocurrir para revisarla. Un ADR no se borra: si cambia, se marca `REEMPLAZADA por ADR-xxx` y se crea el nuevo.

Estados: `APROBADA` (el propietario la aprobó explícitamente) · `APROBADA CONCEPTUALMENTE` (parte del plan de adaptación aprobado el 2026-10-08; se ratifica al implementarse) · `PROPUESTA` · `RECHAZADA` · `REEMPLAZADA` · `PENDIENTE`.

---

## ADR-001 — Usar el repositorio oficial de Google + LiveKit como base del producto

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA`
- **Problema:** Necesitamos captura en cabina, distribución a muchos celulares, un bot servidor que una la sala con Gemini, subtítulos, QR y reproducción en el celular. Construirlo desde cero costaba semanas y repetía trabajo ya resuelto.
- **Alternativas consideradas:** (a) Hub propio por WebSocket + estación emisora (propuesta anterior); (b) framework LiveKit Agents con su plugin de Google; (c) repositorio oficial `google-gemini/gemini-live-translate-livekit`; (d) recetas de traducción de LiveKit (cascada STT→LLM→TTS).
- **Decisión:** (c). El producto nace como derivado del repositorio de Google.
- **Por qué:** Cumple el principio "una sesión por idioma"; Apache 2.0 (uso comercial permitido); mantenido por un ingeniero de Google (último commit 2026-09-01); ya implementa reanudación oficial; LiveKit resuelve Opus, jitter, TURN, reconexión del oyente y escala. (a) repetía todo eso; (b) no soporta `translationConfig` (verificado en `@livekit/agents-plugin-google` 1.9.1); (d) agrega latencia.
- **Evidencia:** Lectura completa del repositorio (BITACORA 2026-10-08 10:48). Verificación de tipos del plugin de LiveKit.
- **Consecuencias:** Dependemos de LiveKit (Cloud al inicio). Heredamos las limitaciones "demo" del código (ver ADR-004 y `PROJECT_STATUS.md` R6). Debemos mantener sincronización con upstream (ADR-011).
- **Para revisarla:** Google abandona el repositorio o el modelo; LiveKit cambia licencia o precios de forma inviable; una medición muestra que LiveKit agrega más de ≈ 0,5 s que no se puede reducir.

## ADR-002 — Mantener `voice-traductor` como laboratorio técnico

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA`
- **Problema:** El banco, el juez y el diagnóstico son valiosos para medir, pero no son el producto.
- **Alternativas:** (a) Convertir `voice-traductor` en el producto; (b) desechar el laboratorio; (c) mantenerlo como laboratorio y compartir formatos.
- **Decisión:** (c).
- **Por qué:** Mide motores con el mismo audio, califica calidad y retraso percibido y descompone el retraso. Eso lo necesitaremos para validar cada fase y para comparar motores si Gemini no cumple.
- **Evidencia:** 43 pruebas pasan; corridas reales de OpenAI y Gemini medidas con él.
- **Consecuencias:** Dos repositorios con funciones distintas. El producto escribe en el formato del laboratorio (ADR-013). El sesgo de arranque del banco se corrige solo cuando vuelva a usarse para comparar motores.
- **Para revisarla:** Que el laboratorio deje de usarse durante dos fases seguidas.

## ADR-003 — Una sesión Gemini por idioma, nunca por oyente

- **Fecha:** 2026-10-05 (README inicial), ratificada 2026-10-08
- **Estado:** `APROBADA`
- **Problema:** Con N oyentes, N sesiones de IA multiplican costo y crean traducciones distintas.
- **Alternativas:** Sesión por oyente; sesión por idioma.
- **Decisión:** Sesión por idioma, compartida por todos los oyentes de ese idioma.
- **Por qué:** Costo lineal con idiomas, no con personas; misma traducción para todos; es también el diseño del repositorio de Google.
- **Evidencia:** README del proyecto; `translation-session-manager.ts` de Google.
- **Consecuencias:** La distribución la hace LiveKit (ADR-006). Un canal = un puente = una sesión lógica.
- **Para revisarla:** Nada previsible.

## ADR-004 — El canal de traducción pertenece al culto, no al oyente

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA`
- **Problema:** El código de Google crea el puente con el primer oyente y lo apaga con el último (`translation-session-manager.ts:203-214`). Con un oyente, un corte de su teléfono borra el contexto y el siguiente arranque tarda segundos. Además, cualquiera puede bajar el contador sin contraseña.
- **Alternativas:** (a) Dejar el ciclo atado a los oyentes; (b) ciclo atado al culto, iniciado y terminado por el operador.
- **Decisión:** (b). Gemini y el canal inglés permanecen activos durante todo el culto, haya o no oyentes. Políticas de seguridad explícitas y configurables (cabina ausente 15 min; culto > 4 h).
- **Por qué:** Los oyentes entran, salen y pierden conexión; nada de eso debe destruir el contexto. Costo aceptado: Gemini cobra mientras el pastor habla aunque nadie escuche.
- **Evidencia:** Lectura del código de Google.
- **Consecuencias:** Cambio O1 (Fase 4). Hasta entonces, en las pruebas el oyente debe permanecer conectado.
- **Para revisarla:** Nada previsible.

## ADR-005 — Sesiones largas con el mecanismo oficial de Google, sin estrategia propia hasta tener evidencia

- **Fecha:** 2026-10-08 (corregida el mismo día tras la observación del propietario)
- **Estado:** `APROBADA`
- **Problema:** Cada conexión con Gemini dura ≈ 10 min y la sesión solo audio sin compresión ≈ 15 min. Los cultos duran 40–90 min. El oyente no debe notar las renovaciones.
- **Alternativas:** (a) Mecanismo oficial: `goAway` → último handle → `sessionResumption` → `contextWindowCompression`; (b) además, lógica propia: cambio en pausa del pastor, drenaje ordenado de la conexión vieja, sesión nueva si el handle se rechaza, vigilante de bloqueos (propuesta mía inicial); (c) rotación por tiempo con sesiones nuevas (adaptador del laboratorio).
- **Decisión:** (a) primero, tal como lo implementa el repositorio de Google, más `contextWindowCompression` que le falta. (b) solo si una prueba de más de 20 min con al menos dos renovaciones demuestra pérdida de audio, duplicación o fallo real con `gemini-3.5-live-translate-preview`. (c) descartada.
- **Por qué:** La Developer API ofrece todo el mecanismo (verificado en el esquema v1beta rev. 2026-10-06 y en el SDK 2.28.0). Construir relevos propios antes de medir contradice el principio 14 del contrato. Lo que la API no informa (qué parte del audio enviado cubre el último handle) es justamente lo que la prueba debe medir.
- **Evidencia:** `PROJECT_CONTRACT.md` §E; BITACORA 2026-10-08 11:20.
- **Consecuencias:** Fase 1 agrega compresión y telemetría; Fase 2 prueba 25/40/60/90 min; Fase 3 decide con datos. Timeouts y espera creciente en reconexiones se agregan en Fase 4 porque corrigen un bloqueo del código de Google (conexión que abre y nunca confirma), no porque cambien el mecanismo.
- **Para revisarla:** Evidencia de la Fase 2 (frase perdida o duplicada en una renovación, bloqueo, corte a los 58 min como el reporte del foro para otro modelo).
- **Nota:** La opción `transparent` (`lastConsumedClientMessageIndex`) existe solo en Gemini Enterprise Agent Platform; no forma parte de esta decisión.

## ADR-006 — LiveKit es la capa de distribución

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA`
- **Problema:** Llevar una pista de audio a decenas o cientos de celulares con búfer adaptativo, compresión, reconexión y redes difíciles.
- **Alternativas:** (a) WebSocket propio con PCM/Opus y búfer propio en el navegador (hub de la propuesta anterior); (b) LiveKit (SFU WebRTC).
- **Decisión:** (b), con LiveKit Cloud al inicio.
- **Por qué:** Opus, jitter buffer adaptativo, TURN, SDKs de navegador y servidor, `setSubscribed` por idioma, 100 conexiones gratis, 200–300 por sala en plan de pago según Google. (a) repetía todo eso y lo hacía peor.
- **Evidencia:** README de Google; documentación de LiveKit.
- **Consecuencias:** Dos tramos WebRTC (cabina→puente, puente→celular) cuya latencia hay que medir (capas 2 y 3). Dependencia de un proveedor con costo por minuto; autoalojar LiveKit queda como opción futura (puertos UDP, TURN, Redis).
- **Para revisarla:** Medición de capas 2–3 muy por encima de ≈ 0,4 s sin remedio; costo de LiveKit Cloud > ≈ 100 USD/mes (evaluar autoalojado).

## ADR-007 — ESPAÑOL → INGLÉS es la primera dirección

- **Fecha:** 2026-10-08 (README inicial contemplaba ambas direcciones)
- **Estado:** `APROBADA`
- **Problema:** Acotar la primera instalación.
- **Decisión:** Solo ES→EN. La iglesia predica en español; los oyentes necesitan inglés.
- **Consecuencias:** `allowedLanguages = ['en']`. La página del oyente queda en inglés; la cabina en español (ADR-014). Inglés→Español y otros idiomas: mejora futura, mismo mecanismo.
- **Para revisarla:** Requisito real de la iglesia.

## ADR-008 — La primera prueba usa un oyente, con la arquitectura real

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA`
- **Problema:** Validar pronto sin construir algo desechable.
- **Alternativas:** (a) Prototipo mínimo distinto del producto; (b) producto real a escala reducida.
- **Decisión:** (b): 1 iglesia, 1 culto, 1 canal, 1 oyente, sobre la misma base que servirá a cientos.
- **Por qué:** "Reducir la ESCALA, no cambiar la ARQUITECTURA" (propietario, 2026-10-08).
- **Consecuencias:** Ninguna pieza se construye "solo para la prueba".

## ADR-009 — Servidor inicial: VPS Linux (Hostinger KVM 2) para la aplicación + LiveKit Cloud; Cloud Run pospuesto; LiveKit autoalojado pospuesto

- **Fecha:** 2026-10-08 (evidencia clasificada el mismo día, revisión documental final)
- **Estado:** `APROBADA CONCEPTUALMENTE` (se confirma al desplegar y medir en Fase 5; la región y la capacidad son estimaciones hasta entonces)
- **Problema:** Un culto es un proceso con estado de 40–90 min: un proceso Node vivo, ≈ 9 conexiones sucesivas con Gemini unidas por reanudación, conexiones WebRTC con LiveKit, grabación de ≈ 0,5 GB y estado en memoria (hasta la Fase 4). Google recomienda Cloud Run con `--max-instances 1`, `--no-cpu-throttling` y una consulta cada 3 s desde la cabina para que la instancia no se apague.
- **Alternativas comparadas:** O1 Hostinger VPS (KVM); O2 Google Cloud Run; O3 Google Compute Engine; O4 VPS + LiveKit autoalojado; O5 otros VPS con centros en Virginia o Nueva York (no comparados en detalle; reserva); O6 servidor dentro de la iglesia (descartado). Fuentes por opción, criterios y hallazgos en `INFRAESTRUCTURA.md` §1.
- **Decisión:** O1 para la aplicación y el puente, con Docker y Caddy; LiveKit en LiveKit Cloud. O3 es equivalente aceptable si se prefiere todo en Google. O2 queda para la etapa comercial con estado en Redis/BD. O4 cuando el costo de LiveKit Cloud supere ≈ 100 USD/mes. O6 descartado.
- **Por qué (resumen; detalle en `INFRAESTRUCTURA.md` §1.E):** lo que más amenaza un culto es que el proveedor reemplace la instancia; Cloud Run lo documenta (SIGTERM + 10 s, también "por razones de infraestructura"); una VM no lo hace. Queremos grabar en disco local durante las Fases 1–5 y en Cloud Run el disco es memoria. El propietario ya administra hosting. Costo fijo bajo.
- **Evidencia, clasificada:**
  - HECHO DOCUMENTADO: Cloud Run SIGTERM + 10 s y apagado no siempre ordenado; sistema de archivos en memoria; WebSockets entrantes limitados a 60 min (fuentes F4, F5 de `INFRAESTRUCTURA.md`). Código de Google: singleton en memoria, una instancia, ≈ 10 % vCPU y 20–30 MiB por puente (F1). Compute Engine: migración en vivo < 1 s (F6). Hostinger: KVM 2 = 2 vCPU / 8 GB / 100 GB / 8 TB, Boston y Phoenix, 99,9 % anunciado sin SLA formal (F7, F8, F10). LiveKit Cloud: borde más cercano, región no elegible sin plan Scale (F15).
  - INFERENCIA TÉCNICA: un VPS es más estable que Cloud Run para nuestro proceso con estado mientras el estado viva en memoria; la conexión saliente con Gemini no está sujeta al límite de 60 min; los oyentes no consumen recursos del VPS; la elección VPS/nube no mueve la latencia si la región es la misma.
  - ESTIMACIÓN PENDIENTE DE VALIDACIÓN: "un KVM 2 sostiene ≈ 8 canales"; todos los RTT; Boston como región (RECOMENDADA PARA PRUEBA); costos de Cloud Run y Compute Engine; ancho de banda por canal.
- **Consecuencias:** Operación propia del VPS (actualizaciones, firewall, copias). Costo fijo ≈ 9–15 USD/mes, compartido entre iglesias. Protocolo de medición de región (§4) y de capacidad (§5) en la Fase 5; sus resultados reemplazan las estimaciones de esta ADR. Corrección registrada: el límite de 60 min de Cloud Run aplica a WebSockets entrantes, no a la conexión saliente del puente.
- **Para revisarla:** RTT medido desde Boston a LiveKit > 40 ms o a Gemini > 60 ms sostenidos (→ O5 en Virginia); contención de CPU medida en Hostinger (→ O3 o O5); necesidad de varias instancias (→ Redis/BD + Cloud Run o varios VPS); costo de LiveKit Cloud > ≈ 100 USD/mes (→ O4).

## ADR-010 — No usar LiveKit Agents (`@livekit/agents-plugin-google`) para el puente

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA`
- **Problema:** El framework de agentes de LiveKit maneja trabajadores, reconexiones y ciclo de vida; parecía evitar escribir el puente.
- **Decisión:** No usarlo. El puente propio del repositorio de Google es el camino.
- **Por qué:** `RealtimeModel` de la versión 1.9.1 soporta reanudación, `goAway` y compresión, pero **no expone `translationConfig`**, imprescindible para `gemini-3.5-live-translate-preview`. Verificado en sus tipos.
- **Para revisarla:** Que el plugin agregue `translationConfig` y una prueba muestre igual o menor latencia.

## ADR-011 — Estrategia de sincronización con el upstream de Google

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA CONCEPTUALMENTE`
- **Problema:** No crear un fork imposible de actualizar.
- **Decisión:** Repositorio **privado** nuevo creado con `git clone` del de Google (historial completo; el botón Fork no permite privado desde un público). Remoto `upstream` → Google. `git fetch upstream && git merge upstream/main`; **merge, nunca rebase**. Código propio en `src/vt/`; enganches mínimos en archivos de Google. `DIFERENCIAS.md` con cada cambio y su razón. Pruebas automáticas + prueba real de ≈ 25 min después de cada merge. Lo que sirva a todos se propone como PR a Google (requiere CLA). Conservar `LICENSE` y avisos; marcar archivos modificados (Apache 2.0).
- **Consecuencias:** Disciplina de archivos propios. El puente (`translation-bridge.ts`) es el archivo de mayor riesgo de conflicto: nuestra lógica de reconexión, grabación y telemetría va en clases propias que el puente invoca.
- **Para revisarla:** Google reestructura el repositorio de forma que el merge deje de ser viable.

## ADR-012 — Mantener las versiones de dependencias del repositorio de Google

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA CONCEPTUALMENTE`
- **Problema:** `@livekit/rtc-node ^0.13.27` (existe 1.1.0), Next.js 16.2.6, etc. Actualizar por cuenta propia aleja del upstream y arriesga la estabilidad.
- **Decisión:** No actualizar dependencias por iniciativa propia. Solo si un fallo lo exige, con registro en bitácora y `DIFERENCIAS.md`.
- **Para revisarla:** Vulnerabilidad de seguridad o fallo reproducible que una versión nueva corrija.

## ADR-013 — Formato de medición compartido entre producto y laboratorio

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA CONCEPTUALMENTE`
- **Decisión:** El puente escribe una carpeta por culto con `eventos.jsonl` (eventos `audio`, `transcript`, `status`, `error` + eventos de sesión Gemini), `traduccion_cruda.wav`, `pastor.wav` y `corrida.json`. `t0` = primer bloque de audio del pastor recibido en el servidor (elimina el sesgo de arranque del banco). `judge` y `diagnose` del laboratorio leen esa carpeta sin cambios.
- **Por qué:** Reutiliza el juez y el diagnóstico ya construidos; permite comparar el producto con las corridas del laboratorio.
- **Consecuencias:** El laboratorio recibe un publicador de prueba que entra a la sala como cabina y reproduce grabaciones a velocidad real (Fase 2). Las cuatro capas de latencia se reportan por separado (contrato §H).

## ADR-014 — Idioma de las interfaces: cabina en español, oyente en inglés

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA CONCEPTUALMENTE`
- **Decisión:** La página del operador (cabina) se traduce al español (O9). La página del oyente permanece en inglés porque los oyentes hablan inglés.
- **Para revisarla:** Otros idiomas de oyentes.

## ADR-015 — Fuente de verdad documental y migración al repositorio del producto

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA`
- **Problema:** Hasta que exista el repositorio del producto, la documentación vive en el laboratorio. Al crearlo, no debe haber dos contratos ni dos `PROJECT_STATUS.md` compitiendo.
- **Decisión:** Hasta la creación del repositorio del producto, los cinco documentos de `voice-traductor` (`PROJECT_CONTRACT.md`, `PROJECT_STATUS.md`, `BITACORA.md`, `DECISIONS.md`, `INFRAESTRUCTURA.md`) son la fuente oficial. Al crearlo (primer paso de la Fase 1), se copian al producto en un commit, el producto pasa a ser la fuente canónica, y en el laboratorio se reemplazan por un `PRODUCTO.md` de una pantalla con el puntero y el commit migrado. Una sola `BITACORA.md` y un solo `DECISIONS.md`, en el producto; las sesiones de laboratorio se registran allí con prefijo `LAB:`. El laboratorio conserva `README.md`, `docs/`, `evidencia/`, `samples/README.md` y un `CLAUDE.md` reducido. Procedimiento completo en `PROJECT_CONTRACT.md` §T.
- **Consecuencias:** Disciplina de un solo lugar por documento. `evidencia/` existe en ambos repositorios, cada una para sus propias pruebas, y la bitácora dice dónde está cada evidencia.
- **Para revisarla:** Que los dos repositorios se fusionen en uno (no previsto).

## ADR-016 — Stack canónico del producto para esta etapa

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA`
- **Decisión:** El stack es el que trae el repositorio de Google más lo mínimo para operarlo: Next.js 16.2.6 / React 19.2.4 (frontend y API en un proceso), Node 22, `TranslationBridge` sobre `@livekit/rtc-node` y `ws`, LiveKit Cloud, Gemini Live Translate por WebSocket directo, VPS Ubuntu 24.04 con Docker y Caddy, estado en memoria (temporal), observabilidad por `eventos.jsonl`, grabaciones, estadísticas WebRTC y chequeo externo; laboratorio en `voice-traductor`. Persistencia futura (Redis o BD) **no se elige ahora**. Tabla con responsabilidad, por qué y estado de cada componente en `PROJECT_CONTRACT.md` §S.
- **Por qué:** No introducir componentes que no hacen falta (principio 15). Todo lo que no viene de Google (Docker, Caddy, VPS) resuelve un problema concreto de operación.
- **Consecuencias:** Cualquier componente nuevo requiere un ADR que diga qué problema resuelve.
- **Para revisarla:** Un componente del stack deja de mantenerse, cambia de licencia o una medición muestra que otro reduce latencia o fallos.

## ADR-017 — El dominio pertenece a Voice Traductor y se reutiliza entre iglesias

- **Fecha:** 2026-10-08
- **Estado:** `APROBADA`
- **Problema:** Si cada iglesia tuviera su dominio, cada instalación cargaría con DNS, certificado y costo propios, y el QR impreso dependería de la iglesia.
- **Decisión:** Un solo dominio de Voice Traductor para toda la plataforma. No es un costo operativo del cliente; es un costo fijo de plataforma. Cómo se identifica cada iglesia dentro del dominio (ruta `/<iglesia>/...` o subdominio `<iglesia>.<dominio>`) queda pendiente (PEN-010) y se decide antes de la Fase 5, cuando se configure el VPS.
- **Consecuencias:** Un certificado (o un comodín si se eligen subdominios); el QR de cada iglesia apunta al dominio de la plataforma; `INFRAESTRUCTURA.md` §6 clasifica el dominio como costo fijo de plataforma.
- **Para revisarla:** Una iglesia exige marca propia en la URL (se podría ofrecer como extra sin cambiar la arquitectura).

---

## Decisiones rechazadas (para no volver a proponerlas sin evidencia nueva)

| ID | Decisión rechazada | Fecha | Por qué |
|---|---|---|---|
| REJ-001 | Distribución propia por WebSocket (hub) + búfer propio en el navegador | 2026-10-08 | Repite lo que LiveKit resuelve (ADR-006) |
| REJ-002 | Lógica propia de relevos (cambio en pausa, drenaje, sesión nueva, vigilante) antes de probar el mecanismo oficial | 2026-10-08 | Sin evidencia de fallo (ADR-005). Puede volver solo con datos de la Fase 2 |
| REJ-003 | `@livekit/agents-plugin-google` como puente | 2026-10-08 | Sin `translationConfig` (ADR-010) |
| REJ-004 | Cascadas STT→LLM→TTS (recetas de LiveKit, pipecat) como motor principal | 2026-10-06/08 | Más latencia que voz a voz; por turnos |
| REJ-005 | OpenAI `gpt-realtime-translate` como motor principal | 2026-10-05 | Mediana 4,15 s, acumula en habla densa (medido) |
| REJ-006 | Cloud Run para la primera instalación | 2026-10-08 | ADR-009; queda para la etapa comercial |
| REJ-007 | Servidor dentro de la iglesia | 2026-10-08 | Depende de luz e internet del templo |
| REJ-008 | Actualizar dependencias del repositorio de Google por cuenta propia | 2026-10-08 | ADR-012 |
| REJ-009 | Sesión nueva de Gemini por defecto en cada rotación (adaptador del laboratorio) | 2026-10-08 | Pierde contexto; la reanudación oficial existe |

## Decisiones pendientes (no tomadas; no inventar)

| ID | Pregunta | Cuándo se decide | Con qué evidencia |
|---|---|---|---|
| PEN-001 | ¿Tasa de muestreo hacia Gemini: 48 kHz (como Google) o 16 kHz (nativa del modelo)? | Después de Fase 2 | A/B con juez: calidad y latencia; ancho de banda |
| PEN-002 | Umbral de recorte de la cola de salida (propuesto 3 s) | Fase 3 | Medición de cola en pruebas de 60 min |
| PEN-003 | Meta de latencia definitiva del producto (≈ 2 s pedida; 2–3 s medida con sesgo) | Fase 3 | Nueva línea base de capa 1 sin sesgo |
| PEN-004 | Región definitiva del VPS: Hostinger Boston es RECOMENDADA PARA PRUEBA; alternativa un VPS en Virginia (Hetzner Ashburn, AWS Lightsail) si el RTT medido no cumple | Fase 5 | `ping`/`mtr` desde el VPS a LiveKit y a Gemini durante 5 min (`INFRAESTRUCTURA.md` §4); criterio ≤ 40 ms y ≤ 60 ms sostenidos |
| PEN-010 | Identificación de cada iglesia dentro del dominio de la plataforma: ruta o subdominio | Antes de Fase 5 | Comparar: un certificado simple vs comodín; QR; sesión fija (O7) |
| PEN-011 | Capacidad real del KVM 2 (reemplaza la estimación de ≈ 8 canales) | Fase 5 | Protocolo de `INFRAESTRUCTURA.md` §5 |
| PEN-005 | Política de retención de grabaciones (propuesto 30 días) | Antes de Fase 6 | Acuerdo con la iglesia |
| PEN-006 | Nombre y ubicación del repositorio privado del producto | Fase 1 | — |
| PEN-007 | Firmar el CLA de Google para aportar cambios | Cuando exista un cambio útil para todos | — |
| PEN-008 | Si Gemini no baja de 2 s: ¿aceptar 2–3 s o evaluar Qwen/Hibiki con el laboratorio? | Fase 3 | Línea base + corridas de Qwen/Hibiki |
| PEN-009 | Tamaño del bloque de audio hacia Gemini (100 ms como Google, o 40 ms) | Después de Fase 2 | A/B con juez |
