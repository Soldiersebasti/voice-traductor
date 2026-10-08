# PROJECT_STATUS.md — Fotografía actual de Voice Traductor

Última actualización: **2026-10-08 12:30 UTC** · Actualizado por: sesión de Claude Code (documentación) · Se lee en menos de cinco minutos.

---

## START HERE FOR AI

1. **Qué construimos.** Voice Traductor: traducción simultánea voz a voz para iglesias. El pastor habla español; los asistentes oyen inglés en su celular con audífonos. Una sola sesión de IA por idioma, compartida por todos los oyentes. Futuro: SaaS multiiglesia.
2. **Arquitectura aprobada.** Base = repositorio oficial `google-gemini/gemini-live-translate-livekit` (Next.js + LiveKit + Gemini Live Translate). Flujo: consola → cabina (navegador) → LiveKit → puente Node → Gemini → puente → LiveKit → celular. Este repositorio (`voice-traductor`) es el **laboratorio** de medición (bench, judge, diagnose), no el producto.
3. **Estado real.** El laboratorio funciona (43 pruebas pasan, verificado 2026-10-08). El código de Google fue **leído**, no ejecutado. El repositorio del producto **no existe todavía**. Ninguna fase del plan está HECHA.
4. **Fase actual.** FASE 0 — `PENDIENTE` (no iniciada). Documentación base creada en esta sesión.
5. **Decisión principal vigente.** Usar primero el mecanismo oficial de Google para sesiones largas (`goAway` → último handle → `sessionResumption` → `contextWindowCompression`). No construir lógica propia de relevos hasta que una prueba de más de 20 minutos con dos renovaciones demuestre pérdida, duplicación o fallo real (ADR-005).
6. **Próximo paso exacto.** Fase 0: el propietario crea la cuenta de LiveKit Cloud y una clave de Gemini de pago (en `.env.local`, nunca en el chat); se clona el repositorio de Google sin cambios en su PC Windows; se corre `npm.cmd install` y `npm.cmd run dev`; prueba corta ES→EN con un sermón grabado y un oyente; registrar al menos un `goAway` en los logs. Detalle en "Fase 0".
7. **Meta de latencia.** Mantener ≈ 2 s de promedio. Línea base disponible de Gemini: mediana fin→fin 2,88 s (PS4, con sesgo de arranque pendiente de corregir). Se re-mide en Fase 2.
8. **Archivos que debes leer, en orden.** `PROJECT_CONTRACT.md` → este archivo → últimas entradas de `BITACORA.md` → `DECISIONS.md` (si tocas arquitectura) → `INFRAESTRUCTURA.md` (si tocas servidores o claves).
9. **Reglas de método.** No agentes ni workflows salvo petición. No pedir claves en el chat. Nada se marca HECHO sin prueba + medición + evidencia. Si algo contradice una decisión registrada: detenerse y reportar. Entorno del propietario: Windows, `npm.cmd`, CMD.
10. **Lo que NO debes volver a hacer.** Investigar si usar Google+LiveKit (decidido). Proponer distribución propia por WebSocket (rechazada). Proponer el plugin de LiveKit Agents para Google (no soporta `translationConfig`). Construir lógica de transición en pausa o sesiones nuevas antes de la prueba de la Fase 2.

---

## 1. Fotografía

| Campo | Valor |
|---|---|
| Fecha | 2026-10-08 |
| Repositorio | `soldiersebasti/voice-traductor` (laboratorio) |
| Branch | `claude/happy-lovelace-7x2zam` |
| Commit base de esta actualización | `0584372` (2026-10-06, "Add Qwen3.8-LiveTranslate as a bench engine") |
| Repositorio del producto | **No creado** (ADR-011 define cómo se creará) |
| Fase actual | **FASE 0 — PENDIENTE** |
| Último hito completado | Plan de adaptación aprobado por el propietario (2026-10-08) y corrección del modelo de reanudación (ADR-005). Documentación base creada. |
| Bloqueos | Cuentas externas (LiveKit Cloud, Gemini de pago) aún no creadas. Artefactos de las corridas PS4 no compartidos. |

## 2. Qué funciona (con evidencia)

| Elemento | Evidencia | Dónde |
|---|---|---|
| Laboratorio: 43 pruebas automáticas pasan, typecheck limpio | `npm test` → `pass 43, fail 0` (28 s); `npm run typecheck` sin errores. Ejecutado 2026-10-08 en el contenedor de la sesión. | `BITACORA.md` entrada 2026-10-08 |
| Banco `run` con motor simulado mide el retraso exacto | Con mock de 1,5 s el banco mide 1,50 s; con mock de 2,6 s mide 2,60 s | `apps/bench/src/bench.test.ts`, `latency.test.ts` |
| Adaptador OpenAI `gpt-realtime-translate` | Corrida real de 15 min (PS1): calidad 4,91/5, 0 omisiones, 65 % de frases empiezan antes de que el pastor termine; **fin→fin mediana 4,15 s, p90 7,27 s, 80 % del tiempo sobre 3 s** → no cumple latencia | `docs/estado-del-arte-latencia.md:21`, `docs/alternativas-proveedores.md:21` |
| Adaptador Gemini `gemini-3.5-live-translate-preview` | Dos corridas reales (PS4) reportadas por el propietario: primer audio 3,50 s; fin→fin mediana 2,88 s; p90 4,63 s; 95 % de frases antes de que el pastor termine; calidad ≈ 4,74/5. `goAway` hacia 09:48 con reconexión. La corrida #2 tuvo un incidente de latencia después de ≈ 11:30. **Cifras con sesgo de arranque (ver §4)** | Conversación 2026-10-06/08; artefactos en el PC del propietario (`runs/ps4-gemini-gemini`, `runs/ps4-gemini-2-gemini`), **no en el repositorio** |
| Juez automático, diagnóstico y simulación de reproducción | Usados en la corrida de OpenAI; su salida está citada en los docs | `docs/banco-de-pruebas.md` |
| Lectura completa del repositorio de Google | Clonado (54 commits, último `26d9a62` del 2026-09-01) y leído archivo por archivo; hallazgos en el plan de adaptación | `BITACORA.md` entradas 2026-10-08; `DECISIONS.md` ADR-001 |
| Verificación del mecanismo oficial de sesiones de Gemini | Esquema v1beta rev. 2026-10-06, SDK `@google/genai` 2.28.0, guía oficial | `PROJECT_CONTRACT.md` §E; `DECISIONS.md` ADR-005 |

## 3. Implementado, pendiente de validación

| Elemento | Qué falta | Estado |
|---|---|---|
| Adaptador Qwen `qwen3.8-livetranslate-flash-realtime` | Corrida real (humo de 2 min y luego PS1); el propietario no ha activado la cuenta | `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` |
| Adaptador Hibiki-Zero (puente Python) | Requiere GPU; corrida base no ejecutada | `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` |
| Reconexión y rotación en el adaptador Gemini del laboratorio | Nunca medida en una renovación real con juez | `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` |

## 4. Qué está fallando o tiene defecto conocido

| Problema | Detalle | Estado | Acción prevista |
|---|---|---|---|
| **Sesgo de arranque del banco** | `apps/bench/src/run.ts` toma `t0` antes de `engine.start()` y `tStart` después; todos los retrasos incluyen el tiempo de conexión del motor. Verificado con mock: 1000 ms de arranque simulado llevaron el retraso medido de 800 a 1820 ms. Magnitud en PS4 desconocida (hace falta el evento `ready` de su `eventos.jsonl`). | `FALLÓ` (defecto conocido, sin corregir) | Corregir con prueba de regresión cuando el laboratorio vuelva a usarse para comparar motores. En el producto no aplica: el `t0` será el primer bloque de audio del pastor recibido en el servidor (ADR-013). |
| **Incidente de latencia en Gemini PS4 #2** | Después de ≈ 11:30 la corrida #2 se atrasó; la #1 no. Causa no analizada. | `FALLÓ` (sin diagnóstico) | Análisis por ventanas bloqueado hasta que el propietario comparta los artefactos (ver §6). |
| **OpenAI no cumple latencia** | Mediana 4,15 s; acumula en habla densa | `FALLÓ` | Motor descartado como principal; queda como comparación en el laboratorio. |
| **Adaptador Gemini del laboratorio** | Reconexión break-before-make a `timeLeft − 2,5 s`; descarga el búfer de golpe; sin timeouts; cualquier error HTTP en reconexión es fatal; abandona tras 6 intentos; `stop()` durante reconexión deja una sesión viva; `usageMetadata` se pierde si llega junto con `serverContent`. | Defectos conocidos | **No se corrigen**: el producto usará el puente de Google, no este adaptador. Quedan documentados para no repetirlos. |

## 5. Siguiente tarea exacta

**Fase 0 — correr el código de Google sin cambios.** Pasos en orden:

1. Propietario: crear proyecto en **LiveKit Cloud** (plan Build, gratuito; región más cercana a la costa este de EE. UU.). Anotar `LIVEKIT_URL` (`wss://<proyecto>.livekit.cloud`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Guía en `INFRAESTRUCTURA.md` §4.
2. Propietario: crear **clave de Gemini** en Google AI Studio desde un proyecto **con facturación** (la cuota gratuita limita a 3–5 WebSockets y no sirve para pruebas largas). Guía en `INFRAESTRUCTURA.md` §4.
3. En el PC (CMD): `git clone https://github.com/google-gemini/gemini-live-translate-livekit` en una carpeta fuera de `voice-traductor`. No modificar nada.
4. Crear `.env.local` con `GEMINI_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `BROADCAST_PASSWORD`.
5. `npm.cmd install` y `npm.cmd run dev`. Abrir `http://localhost:3000`.
6. Crear sesión con identificador de evento `prueba`, idiomas permitidos: solo `en`.
7. Página de cabina: activar "tab audio" con un sermón grabado reproducido en otra pestaña (o el micrófono). Página del oyente en otra ventana del mismo PC: elegir inglés. Confirmar que se oye la traducción.
8. Mantener la prueba **≥ 12 minutos** para observar un `goAway` y la reconexión en la consola del servidor. Guardar la consola completa en `evidencia/2026-MM-DD-fase0/consola.txt`.
9. Anotar con cronómetro el retraso percibido en 5 frases, el primer audio y cualquier corte.
10. Registrar en `BITACORA.md` y actualizar este archivo. Criterio de aceptación de la Fase 0 en §8.

Si el oyente de prueba es un celular, exponer el PC con un túnel HTTPS temporal (`INFRAESTRUCTURA.md` §9).

## 6. Dependencias externas necesarias

| Dependencia | Para qué | Estado | Quién |
|---|---|---|---|
| Cuenta LiveKit Cloud (Build) | Fases 0–6 | **No creada** | Propietario |
| Clave Gemini de pago (proyecto con facturación) | Fases 0–6 | **No creada** (existe una clave usada en el laboratorio; no se sabe si es de pago) | Propietario |
| `OPENAI_API_KEY` | Laboratorio: `transcribe` (referencia) y `judge` | Existe en el PC del propietario | Propietario |
| Artefactos PS4 (`runs/ps4-gemini-gemini`, `runs/ps4-gemini-2-gemini`, `samples/PS4.referencia.json`) | Análisis del incidente 11:30 y del sesgo de arranque | **No compartidos** | Propietario |
| Grabaciones de sermones (PS1, PS4, un sermón de 90 min) | Fases 0–2 | En el PC del propietario; no en el repositorio | Propietario |
| VPS Linux + dominio | Fase 5 | No contratado (el propietario administra hosting en Hostinger) | Propietario |
| Marca y modelo de la consola de la iglesia | Fase 5 (entrada de audio) | Desconocido | Propietario |
| Teléfonos de prueba (iPhone y Android) con audífonos de cable | Fase 5 | Por confirmar | Propietario |

## 7. Riesgos activos

| # | Riesgo | Impacto | Mitigación / cuándo se resuelve |
|---|---|---|---|
| R1 | El modelo `gemini-3.5-live-translate-preview` está en **preview**; un tercero afirma retiro el 2026-11-01 (no oficial) | Alto | Seguir el changelog oficial; el puente permite cambiar de modelo por configuración. Revisar en cada sesión. |
| R2 | La latencia del modelo (≈ 2,9 s de mediana medida con sesgo) puede no bajar de 2 s | Alto para la meta del propietario | Re-medir sin sesgo en Fase 2 antes de prometer cifras. Si no baja, la decisión es del propietario (aceptar 2–3 s o evaluar otro motor con el laboratorio). |
| R3 | Renovaciones de Gemini con pérdida o duplicación | Alto | Es exactamente lo que mide la Fase 2 (ADR-005). |
| R4 | Reporte de foro: con `gemini-3.8-live` las sesiones se cortan a los 58:00 (código 1011) y la reanudación falla (1007), con compresión activada. Otro modelo, sin respuesta oficial. | Medio | Pruebas de 60 y 90 min en Fase 2 lo confirman o descartan para nuestro modelo. |
| R5 | Sin compresión de contexto, la sesión muere a los 15 min | Alto | Fase 1 agrega `contextWindowCompression`. |
| R6 | Código de Google: el canal se apaga sin oyentes; identidades falsificables; borrado sin contraseña; listado público de sesiones | Alto en la iglesia | Fase 4 (O1, O2, O7). Hasta entonces, solo pruebas controladas. |
| R7 | Cola de salida del puente sin límite ni medición (`captureChain`) | Medio | Fase 1 mide; Fase 3 decide el umbral. |
| R8 | Cupo gratuito de LiveKit Cloud: las fuentes difieren (README de Google: 50 horas-participante/mes; terceros: 5 000 minutos/mes) | Bajo | Confirmar al crear la cuenta; un culto con 1 oyente ≈ 270 minutos-participante. |
| R9 | `@livekit/rtc-node` usa binarios nativos: requiere glibc (no Alpine) en el servidor y binario Windows x64 en el PC | Medio | Dockerfile de Google ya usa `node:22-slim`; en Fase 0 se confirma la instalación en Windows. |
| R10 | Las grabaciones de culto son sensibles | Medio | Principio 18 del contrato; retención definida en `INFRAESTRUCTURA.md` §8. |
| R11 | Bluetooth agrega 0,1–0,3 s que ninguna estadística ve | Bajo | Prueba acústica en Fase 5; recomendar audífonos de cable. |

## 8. Tabla de fases

Estados posibles: `PENDIENTE` · `EN CURSO` · `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` · `HECHO` · `BLOQUEADO` · `FALLÓ`.

| Fase | Nombre | Estado | Evidencia |
|---|---|---|---|
| 0 | Código de Google sin cambios + prueba corta | `PENDIENTE` | — |
| 1 | `contextWindowCompression` + telemetría de renovaciones + grabación compatible con el banco | `PENDIENTE` | — |
| 2 | Pruebas de 25, 40, 60 y 90 min con el mecanismo oficial; decisión con evidencia | `PENDIENTE` | — |
| 3 | Decisiones que resulten de las pruebas | `PENDIENTE` | — |
| 4 | Ciclo del culto, seguridad, reconexión de cabina, sesión fija | `PENDIENTE` | — |
| 5 | Entrada de audio real, cabina en español, VPS, teléfonos | `PENDIENTE` | — |
| 6 | Instalación y prueba en iglesia | `PENDIENTE` | — |

Revisión del orden: al releer el código de Google no apareció ninguna dependencia técnica que obligue a cambiar el orden. Dos restricciones de procedimiento, no de orden: (a) en las Fases 0–2 el oyente de prueba debe permanecer conectado toda la prueba, porque el código de Google apaga el canal sin oyentes hasta que la Fase 4 lo cambie; (b) la Fase 2 necesita `OPENAI_API_KEY` en el laboratorio para `transcribe` y `judge`.

### Fase 0 — Código de Google sin cambios + prueba corta

- **Objetivo.** Confirmar que la base corre tal cual en el PC del propietario con nuestras cuentas, y ver una renovación real.
- **Tareas.** Las 10 de §5.
- **Criterio de aceptación.** (1) Se oye la traducción ES→EN en la página del oyente. (2) Al menos un `goAway` registrado y la reconexión completada sin caída del proceso. (3) Consola guardada en `evidencia/`. (4) Primer audio y retraso percibido anotados a cronómetro en 5 frases. (5) Instalación en Windows sin errores de binarios nativos.
- **Pruebas requeridas.** Prueba real corta (≥ 12 min). Opcional: oyente en celular por túnel.
- **Estado.** `PENDIENTE`.

### Fase 1 — Compresión, telemetría y grabación

- **Objetivo.** Que el puente pueda pasar de 15 min y que cada renovación y cada bloque de audio queden medidos en el formato del laboratorio.
- **Tareas.** (1) Crear el repositorio privado del producto con el historial de Google y el remoto `upstream` (ADR-011). (2) Enviar `contextWindowCompression: { slidingWindow: {} }` en la configuración de Gemini. (3) Registrar en `eventos.jsonl`: cada `goAway` (hora, `timeLeft`), cada `SessionResumptionUpdate` (resumable, antigüedad del handle, sin escribir el handle completo), apertura y `setupComplete` de cada conexión (duración), cierres (código, razón), tokens. (4) Grabar `pastor.wav` (audio recibido de la cabina, con marcas) y `traduccion_cruda.wav` (audio recibido de Gemini) con `t0` = primer bloque del pastor. (5) Activar `inputAudioTranscription` para que `diagnose` vea lo que Gemini escuchó. (6) Medir la cola de salida (ms acumulados) cada segundo. (7) Pruebas unitarias de lo anterior con un Gemini falso. (8) `DIFERENCIAS.md` inicial.
- **Criterio de aceptación.** Una prueba de ≥ 16 min con compresión no muere a los 15; `judge` y `diagnose` del laboratorio leen la carpeta producida sin cambios; pruebas unitarias pasan.
- **Pruebas requeridas.** Unitarias; prueba real de 16–20 min.
- **Estado.** `PENDIENTE`.

### Fase 2 — Pruebas largas con el mecanismo oficial

- **Objetivo.** Demostrar, con grabación y juez, si el mecanismo oficial (`goAway` → último handle → `sessionResumption` → `contextWindowCompression`) sostiene 25, 40, 60 y 90 minutos sin pérdida ni duplicación.
- **Tareas.** (1) Prueba de 25 min con un sermón real, un oyente conectado todo el tiempo, ≥ 2 renovaciones y paso del minuto 15. (2) Transcripción de referencia con `transcribe`; `judge` y `diagnose`. (3) Repetir a 40, 60 y 90 min. (4) Opcional: control de 25 min **sin** compresión para confirmar el límite de 15 min. (5) Nueva línea base de latencia del modelo (capa 1) sin sesgo de arranque.
- **Criterio de aceptación, por renovación.** Toda frase dicha entre 10 s antes del `goAway` y 10 s después del cambio aparece traducida; ninguna frase repetida; ningún hueco mayor que los huecos normales de la misma prueba; el retraso no queda más alto después del cambio. Por prueba: sin bloqueos silenciosos; cola estable; deriva ≈ 0.
- **Pruebas requeridas.** 4 pruebas reales (25/40/60/90) + juez + diagnóstico. Evidencia en `evidencia/`.
- **Estado.** `PENDIENTE`.

### Fase 3 — Decisiones con evidencia

- **Objetivo.** Decidir, solo con los datos de la Fase 2, si el mecanismo oficial queda como está o si hace falta una medida mínima para un fallo concreto (y cuál).
- **Tareas.** Presentar al propietario la evidencia por renovación; registrar la decisión en `DECISIONS.md`; fijar el umbral de recorte de la cola con datos; fijar la meta de latencia realista del producto frente a la nueva línea base.
- **Criterio de aceptación.** ADR registrado con evidencia enlazada.
- **Estado.** `PENDIENTE`.

### Fase 4 — Ciclo del culto, seguridad, cabina, sesión fija

- **Objetivo.** Que el canal pertenezca al culto y que nadie sin contraseña pueda apagarlo ni suplantar a la cabina.
- **Tareas.** O1: iniciar/terminar culto desde la cabina; el canal no se apaga sin oyentes; conteo de oyentes informativo desde la sala; políticas de seguridad configurables (cabina ausente 15 min, culto > 4 h). O2: identidades asignadas por el servidor; baja de traducción y borrado de sesión protegidos; sin listado público de sesiones; timeouts y espera creciente en reconexiones de Gemini (corrige el caso en que una conexión abre pero nunca confirma). O4: el puente sobrevive cortes de cabina y de sala, y toma la nueva pista. O7: sesión fija de la iglesia que sobrevive reinicios y arranca sola. Pruebas unitarias y de integración con Gemini falso para cada punto.
- **Criterio de aceptación.** Con el oyente desconectado 5 min, Gemini sigue activo y la traducción continúa al volver; un cliente que intenta entrar como `organizer-host` o `translator-en` es rechazado; reinicio del servidor con culto activo → la cabina se reconecta y la traducción sigue; cabina desconectada 2 min → al volver, traducción sin reiniciar el culto.
- **Pruebas requeridas.** Unitarias; integración; prueba real de 25 min con cortes provocados.
- **Estado.** `PENDIENTE`.

### Fase 5 — Entrada real, cabina en español, VPS, teléfonos

- **Objetivo.** Audio limpio desde la consola, operador en español, despliegue en el servidor real y validación en celulares.
- **Tareas.** O5: selector de dispositivo y canal; cancelación de eco, supresión de ruido y ganancia automática apagadas; medidor de nivel con avisos; configuración recordada. O9: textos de cabina en español. Despliegue en VPS con dominio y HTTPS (`INFRAESTRUCTURA.md` §5–7). Pruebas largas en el VPS. Protocolo de teléfonos: iPhone y Android, 10 min con pantalla bloqueada, Wi-Fi→datos, desconexión de audífonos. Prueba acústica (capa 4).
- **Criterio de aceptación.** Tres pruebas de 90 min en el VPS sin bloqueos silenciosos y sin renovación con frase perdida; cola estable; ambos teléfonos siguen sonando con pantalla bloqueada y al cambiar de red; mediana y p90 de las cuatro capas de latencia registrados.
- **Pruebas requeridas.** 3 × 90 min; teléfonos; acústica.
- **Estado.** `PENDIENTE`.

### Fase 6 — Iglesia

- **Objetivo.** Ensayo con la consola real sin congregación y luego un culto real con un oyente.
- **Tareas.** Conexión consola→USB→cabina; ajuste de la mezcla auxiliar; ensayo; culto real; encuesta al oyente con `docs/rubrica-evaluacion.md` y `docs/plantilla-evaluacion.csv`.
- **Criterio de aceptación.** Culto completo sin intervención del operador después de "Iniciar culto"; evidencia de las cuatro capas de latencia; calificación del oyente registrada.
- **Estado.** `PENDIENTE`.

## 9. Inventario del laboratorio (`voice-traductor`, commit `0584372`)

| Pieza | Ruta | Estado |
|---|---|---|
| Contrato de motores (`TranslationEngine`) | `packages/engines/src/types.ts`, `base.ts`, `registry.ts` | Funciona (pruebas) |
| Motores | `packages/engines/src/engines/`: `openai-translate.ts`, `gemini-translate.ts`, `qwen-livetranslate.ts`, `hibiki.ts` (+ `tools/hibiki_bridge.py`), `mock.ts` | OpenAI y Gemini probados en real; Qwen y Hibiki pendientes |
| Audio (PCM, remuestreo, WAV) | `packages/engines/src/audio/` | Funciona (pruebas) |
| Banco | `apps/bench/src/`: `run`, `synth`, `prepare`, `diagnose`, `replay`, `transcribe`, `judge`, `phrases`, `report` | Funciona; sesgo de arranque conocido en `run.ts` |
| Pruebas automáticas | `npm test` (43) y `npm run typecheck` | Pasan (2026-10-08) |
| Documentación técnica | `docs/banco-de-pruebas.md`, `estado-del-arte-latencia.md`, `alternativas-proveedores.md`, `qwen-livetranslate.md`, `hibiki-zero.md`, `voz-y-referencias-mercado.md`, `rubrica-evaluacion.md`, `plantilla-evaluacion.csv`, `frases-interactivas.txt`, `lectura-continua.txt` | Vigente |
| Documentación de proyecto | `PROJECT_CONTRACT.md`, `PROJECT_STATUS.md`, `BITACORA.md`, `DECISIONS.md`, `INFRAESTRUCTURA.md`, `CLAUDE.md` | Creada 2026-10-08 |
| Material de prueba | `samples/` (ignorado por git), `runs/` (ignorado por git) | Vacíos en el repositorio; en el PC del propietario |
| Evidencia commiteable | `evidencia/` | Carpeta por crear con la primera prueba de la Fase 0 |

## 10. Evidencia disponible y faltante

| Evidencia | Disponible | Dónde |
|---|---|---|
| Resultados OpenAI PS1 15 min | Sí (resumen) | `docs/estado-del-arte-latencia.md`, `docs/alternativas-proveedores.md` |
| Resultados Gemini PS4 (dos corridas) | Solo resumen en conversación | **Faltan** los artefactos (`eventos.jsonl`, `juez.md`, `diagnostico.md`) |
| Pruebas automáticas del laboratorio | Sí | `npm test`, 2026-10-08 |
| Lectura del repositorio de Google | Sí (hallazgos en `DECISIONS.md` y en el plan) | Clon local de la sesión; no está en el repositorio |
| Cualquier prueba del código de Google en ejecución | **No** | — |
| Cualquier medición de LiveKit (capas 2–4) | **No** | — |
