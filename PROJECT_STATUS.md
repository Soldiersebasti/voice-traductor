# PROJECT_STATUS.md — Fotografía actual de Voice Traductor

Última actualización: **2026-10-08 13:50 UTC** · Actualizado por: sesión de Claude Code (Fase 0: preparación) · Se lee en menos de cinco minutos.

---

## START HERE FOR AI

1. **Qué construimos.** Voice Traductor: traducción simultánea voz a voz para iglesias. El pastor habla español; los asistentes oyen inglés en su celular con audífonos. Una sola sesión de IA por idioma, compartida por todos los oyentes. Futuro: SaaS multiiglesia.
2. **Arquitectura aprobada.** Base = repositorio oficial `google-gemini/gemini-live-translate-livekit` (Next.js + LiveKit + Gemini Live Translate). Flujo: consola → cabina (navegador) → LiveKit → puente Node → Gemini → puente → LiveKit → celular. Servidor: VPS Hostinger + LiveKit Cloud (ADR-009).
3. **Producto vs laboratorio.** PRODUCTO = repositorio privado derivado de Google (aún no creado). LABORATORIO = este repositorio (`voice-traductor`: bench, judge, diagnose). Nada de aquí es producto; el adaptador Gemini del laboratorio no es el puente del producto.
4. **Estado real.** El laboratorio funciona (43 pruebas pasan, verificado 2026-10-08). El código de Google, en su commit `26d9a62`, **instala, construye y arranca en Linux con sus dependencias exactas, sin claves** (`evidencia/fase-0/00-instalacion-linux.md`). No se ha probado contra LiveKit ni Gemini. Ninguna fase del plan está HECHA.
5. **Fase actual.** FASE 0 — `BLOQUEADO`: la preparación está hecha; la prueba real (claves, PC Windows, teléfono, persona) corre del lado del propietario siguiendo `evidencia/fase-0/README.md`.
6. **Decisión principal vigente.** Usar primero el mecanismo oficial de Google para sesiones largas (`goAway` → último handle → `sessionResumption` → `contextWindowCompression`). No construir lógica propia de relevos hasta que una prueba de más de 20 minutos con dos renovaciones demuestre pérdida, duplicación o fallo real (ADR-005).
7. **Próximo paso exacto.** El propietario ejecuta `evidencia/fase-0/README.md` pasos 1–8 en su PC: clon de Google en el commit `26d9a620a85410ad8c902106d3a4d3a4edfd2968`, `npm.cmd ci`, `.env.local` con LiveKit Cloud y Gemini de pago (nunca en el chat), `tools\fase0-run.ps1`, prueba corta ES→EN, prueba ≥ 12 min con un teléfono real y `observacion-oyente.md`, `npm.cmd run fase0:analizar`, commit de `evidencia/fase-0`. Detalle en §6.
8. **Meta de latencia.** Mantener ≈ 2 s de promedio. Única línea base registrada de Gemini: mediana fin→fin 2,88 s (PS4, RESULTADO HISTÓRICO REPORTADO, con sesgo de arranque). Se re-mide en Fase 2.
9. **Fuente de verdad.** Estos cinco documentos (`PROJECT_CONTRACT.md`, este archivo, `BITACORA.md`, `DECISIONS.md`, `INFRAESTRUCTURA.md`) hasta que exista el repositorio del producto; entonces migran allí (contrato §T, ADR-015).
10. **Archivos que debes leer, en orden.** `PROJECT_CONTRACT.md` → este archivo → últimas entradas de `BITACORA.md` → `DECISIONS.md` (si tocas arquitectura) → `INFRAESTRUCTURA.md` (si tocas servidores o claves).
11. **Reglas de método.** No agentes ni workflows salvo petición. No pedir claves en el chat. Nada se marca HECHO sin prueba + medición + evidencia. Si algo contradice una decisión registrada: detenerse y reportar. Entorno del propietario: Windows, `npm.cmd`, CMD.
12. **Lo que NO debes volver a hacer.** Investigar si usar Google+LiveKit (decidido). Proponer distribución propia por WebSocket (rechazada). Proponer el plugin de LiveKit Agents para Google (sin `translationConfig`). Construir lógica de transición en pausa o sesiones nuevas antes de la prueba de la Fase 2. Citar "8 canales por VPS" o una región como hechos: son estimaciones hasta la Fase 5.

---

## 1. Fotografía

| Campo | Valor |
|---|---|
| Fecha | 2026-10-08 |
| Repositorio LABORATORIO | `soldiersebasti/voice-traductor` (este) |
| Branch | `claude/happy-lovelace-7x2zam` |
| Commit base de esta actualización | `af16dfd` (documentación inicial) sobre `0584372` (último cambio de código, 2026-10-06) |
| Repositorio PRODUCTO | **No creado** (ADR-011 define cómo se creará; ADR-015 cómo migra la documentación) |
| Fase actual | **FASE 0 — BLOQUEADO** (preparación hecha; prueba real pendiente del lado del propietario) |
| Último hito completado | Fase 0, preparación: el código original de Google (commit `26d9a62`) instala, construye y arranca en Linux con dependencias exactas; herramientas de captura y análisis de consola listas y probadas con logs sintéticos; protocolo para el PC escrito (2026-10-08 13:45 UTC) |
| Infraestructura elegida | VPS Hostinger KVM 2 (Boston, RECOMENDADA PARA PRUEBA) + LiveKit Cloud; detalle y evidencia en `INFRAESTRUCTURA.md` §1–§6 |
| Bloqueos | Fase 0: cuentas externas (LiveKit Cloud, Gemini de pago) no creadas; la prueba real necesita el PC Windows del propietario, un teléfono y una persona; este entorno no tiene claves ni audio. Artefactos de las corridas PS4 no compartidos. |

## 2. Producto y laboratorio

| | PRODUCTO REAL | LABORATORIO |
|---|---|---|
| Repositorio | Privado, derivado de `google-gemini/gemini-live-translate-livekit` con historial y remoto `upstream`; **no creado** | `soldiersebasti/voice-traductor` |
| Estado | No existe | Funciona: 43 pruebas, typecheck limpio (2026-10-08) |
| Contiene / contendrá | Cabina, oyente, API, puente, ciclo del culto, grabador, telemetría, despliegue | `run`, `judge`, `diagnose`, `replay`, `transcribe`, `phrases`, `report`; motores OpenAI, Gemini, Qwen, Hibiki, mock; `docs/`; `evidencia/` |
| Qué no es | No es el banco | No es el producto; su adaptador Gemini no se lleva al producto |

## 3. Qué funciona (con evidencia)

| Elemento | Evidencia | Dónde |
|---|---|---|
| Laboratorio: 43 pruebas automáticas pasan, typecheck limpio | `npm test` → `pass 43, fail 0` (28 s); `npm run typecheck` sin errores. Ejecutado 2026-10-08 en el contenedor de la sesión. | `BITACORA.md` entrada 2026-10-08 12:30 |
| Banco `run` con motor simulado mide el retraso exacto | Con mock de 1,5 s el banco mide 1,50 s; con mock de 2,6 s mide 2,60 s | `apps/bench/src/bench.test.ts`, `latency.test.ts` |
| Adaptador OpenAI `gpt-realtime-translate` | **RESULTADO HISTÓRICO REPORTADO** (documentado en `docs/`, sin artefacto local): corrida real de 15 min (PS1): calidad 4,91/5, 0 omisiones, 65 % de frases empiezan antes de que el pastor termine; **fin→fin mediana 4,15 s, p90 7,27 s, 80 % del tiempo sobre 3 s** → no cumple latencia | `docs/estado-del-arte-latencia.md:21`, `docs/alternativas-proveedores.md:21` |
| Adaptador Gemini `gemini-3.5-live-translate-preview` | **RESULTADOS HISTÓRICOS REPORTADOS** (fuente: conversación; `runs/` vacío, sin artefacto local): dos corridas (PS4): primer audio 3,50 s; fin→fin mediana 2,88 s; p90 4,63 s; 95 % de frases antes de que el pastor termine; calidad ≈ 4,74/5. `goAway` hacia 09:48 con reconexión. La corrida #2 tuvo un incidente de latencia después de ≈ 11:30. **Cifras con sesgo de arranque (§5)** | `BITACORA.md` historial reconstruido; artefactos solo en el PC del propietario |
| Juez automático, diagnóstico y simulación de reproducción | Usados en la corrida de OpenAI; su salida está citada en los docs | `docs/banco-de-pruebas.md` |
| Lectura completa del repositorio de Google | Clonado (54 commits, último `26d9a62` del 2026-09-01) y leído archivo por archivo | `BITACORA.md` entradas 2026-10-08; `DECISIONS.md` ADR-001 |
| Verificación del mecanismo oficial de sesiones de Gemini | Esquema v1beta rev. 2026-10-06, SDK `@google/genai` 2.28.0, guía oficial | `PROJECT_CONTRACT.md` §E; `DECISIONS.md` ADR-005 |
| Decisión de infraestructura con evidencia clasificada | Hechos documentados con fuente, inferencias y estimaciones separadas | `INFRAESTRUCTURA.md` §1.G; ADR-009 |

## 4. Implementado, pendiente de validación

| Elemento | Qué falta | Estado |
|---|---|---|
| Adaptador Qwen `qwen3.8-livetranslate-flash-realtime` (laboratorio) | Corrida real (humo de 2 min y luego PS1); cuenta no activada | `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` |
| Adaptador Hibiki-Zero (laboratorio, puente Python) | Requiere GPU; corrida base no ejecutada | `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` |
| Reconexión y rotación en el adaptador Gemini del laboratorio | Nunca medida en una renovación real con juez; no se lleva al producto | `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` |

## 5. Qué está fallando o tiene defecto conocido

| Problema | Detalle | Estado | Acción prevista |
|---|---|---|---|
| **Sesgo de arranque del banco** | `apps/bench/src/run.ts` toma `t0` antes de `engine.start()` y `tStart` después; todos los retrasos incluyen el tiempo de conexión del motor. Verificado con mock: 1000 ms de arranque simulado llevaron el retraso medido de 800 a 1820 ms. Magnitud en PS4 desconocida. | `FALLÓ` (defecto conocido, sin corregir) | Corregir con prueba de regresión cuando el laboratorio vuelva a comparar motores. En el producto no aplica: `t0` = primer bloque del pastor en el servidor (ADR-013). |
| **Incidente de latencia en Gemini PS4 #2** | Después de ≈ 11:30 la corrida #2 se atrasó; la #1 no. Causa no analizada. | `FALLÓ` (sin diagnóstico) | Bloqueado hasta que el propietario comparta los artefactos (§7). |
| **OpenAI no cumple latencia** | Mediana 4,15 s; acumula en habla densa | `FALLÓ` | Descartado como motor principal (REJ-005). |
| **Adaptador Gemini del laboratorio** | Reconexión break-before-make; descarga del búfer de golpe; sin timeouts; errores HTTP fatales; abandona tras 6 intentos; `stop()` durante reconexión deja sesión viva; `usageMetadata` perdido. | Defectos conocidos | **No se corrigen**: el producto usa el puente de Google. Documentados para no repetirlos. |

## 6. Siguiente tarea exacta

**Fase 0 — prueba real del código de Google sin cambios, en el PC del propietario.** El protocolo completo, con comandos CMD, está en `evidencia/fase-0/README.md`. Resumen:

1. Propietario: proyecto en **LiveKit Cloud** (plan Build) y **clave de Gemini** de un proyecto con facturación. Claves solo en `%APP%\.env.local`. Guía en `INFRAESTRUCTURA.md` §8.
2. `git clone` del repositorio de Google fuera del laboratorio y `git checkout 26d9a620a85410ad8c902106d3a4d3a4edfd2968`. No modificar nada.
3. `npm.cmd ci` (dependencias exactas; debe aparecer `node_modules\@livekit\rtc-ffi-bindings-win32-x64-msvc`). Registrar versiones en `evidencia\fase-0\entorno-pc.txt`.
4. Arrancar con `powershell -NoProfile -ExecutionPolicy Bypass -File tools\fase0-run.ps1 -Dir %APP%` desde el laboratorio (fecha y redacta la consola en `evidencia\fase-0\consola-dev.txt`).
5. Prueba corta: sesión `prueba` solo con `en`; cabina con "tab audio" de un sermón en español; oyente en otra ventana; confirmar inglés.
6. Prueba ≥ 12 min (ideal 15–21) con una persona en un teléfono real (túnel `cloudflared` o red local), el oyente conectado todo el tiempo, y `observacion-oyente.md` llena.
7. `npm.cmd run fase0:analizar -- evidencia\fase-0\consola-dev.txt`; revisar que no avise de secretos.
8. `git add evidencia\fase-0`, commit, push, y avisar. Con esa evidencia se decide PASS/FAIL (criterios en §9) y se actualizan `BITACORA.md` y este archivo.

## 7. Dependencias externas necesarias

| Dependencia | Para qué | Estado | Quién |
|---|---|---|---|
| Cuenta LiveKit Cloud (Build) | Fases 0–6 | **No creada** | Propietario |
| Clave Gemini de pago (proyecto con facturación) | Fases 0–6 | **No creada** (la clave del laboratorio no se sabe si es de pago) | Propietario |
| `OPENAI_API_KEY` | Laboratorio: `transcribe` y `judge` | Existe en el PC del propietario | Propietario |
| Artefactos PS4 (`runs/ps4-gemini-gemini`, `runs/ps4-gemini-2-gemini`, `samples/PS4.referencia.json`) | Diagnóstico del incidente 11:30 y del sesgo | **No compartidos** | Propietario |
| Grabaciones de sermones (PS1, PS4, uno de 90 min) | Fases 0–2 | En el PC del propietario | Propietario |
| VPS Linux (Hostinger KVM 2) y dominio de la plataforma | Fase 5 | No contratado; el propietario administra hosting en Hostinger | Propietario |
| Marca y modelo de la consola de la iglesia | Fase 5 | Desconocido | Propietario |
| Teléfonos de prueba (iPhone y Android) con audífonos de cable | Fase 5 | Por confirmar | Propietario |

## 8. Riesgos activos

| # | Riesgo | Impacto | Mitigación / cuándo se resuelve |
|---|---|---|---|
| R1 | `gemini-3.5-live-translate-preview` está en **preview**; un tercero afirma retiro el 2026-11-01 (no oficial) | Alto | Seguir el changelog oficial; el modelo se cambia por configuración. |
| R2 | La latencia del modelo (≈ 2,9 s de mediana con sesgo) puede no bajar de 2 s | Alto para la meta | Re-medir sin sesgo en Fase 2; decisión PEN-003. |
| R3 | Renovaciones de Gemini con pérdida o duplicación | Alto | Es lo que mide la Fase 2 (ADR-005). |
| R4 | Reporte de foro: con `gemini-3.8-live` las sesiones se cortan a los 58:00 y la reanudación falla, con compresión. Otro modelo, sin respuesta oficial. | Medio | Pruebas de 60 y 90 min en Fase 2. |
| R5 | Sin compresión de contexto, la sesión muere a los 15 min | Alto | Fase 1. |
| R6 | Código de Google: canal apagado sin oyentes; identidades falsificables; borrado sin contraseña; listado público de sesiones | Alto en la iglesia | Fase 4 (O1, O2, O7). |
| R7 | Cola de salida del puente sin límite ni medición | Medio | Fase 1 mide; Fase 3 decide. |
| R8 | Cupo gratuito de LiveKit Cloud: las fuentes difieren | Bajo | Confirmar al crear la cuenta. |
| R9 | `@livekit/rtc-node` usa binarios nativos (glibc; Windows x64) | Medio | Fase 0 (Windows) y Fase 5 (VPS). |
| R10 | Grabaciones sensibles | Medio | Principio 18; retención en `INFRAESTRUCTURA.md` §12. |
| R11 | Bluetooth agrega 0,1–0,3 s invisibles para las estadísticas | Bajo | Prueba acústica en Fase 5; audífonos de cable. |
| R12 | Un tercero afirma que Hostinger aplica un umbral de CPU no documentado que reduce la capacidad del VPS | Medio | No verificado. Vigilar `steal` y CPU en el protocolo de capacidad (Fase 5); alternativa O3/O5. |
| R13 | Región Boston elegida solo por geografía; sin RTT medido | Bajo | Protocolo de región en Fase 5 (PEN-004). |

## 9. Tabla de fases

Estados posibles: `PENDIENTE` · `EN CURSO` · `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` · `HECHO` · `BLOQUEADO` · `FALLÓ`.

| Fase | Nombre | Estado | Evidencia |
|---|---|---|---|
| 0 | Código de Google sin cambios + prueba corta | `BLOQUEADO` (preparación hecha; prueba real pendiente del lado del propietario) | `evidencia/fase-0/00-instalacion-linux.md` (parcial: instala, construye y arranca en Linux sin claves) |
| 1 | `contextWindowCompression` + telemetría de renovaciones + grabación compatible con el banco | `PENDIENTE` | — |
| 2 | Pruebas de 25, 40, 60 y 90 min con el mecanismo oficial; decisión con evidencia | `PENDIENTE` | — |
| 3 | Decisiones que resulten de las pruebas | `PENDIENTE` | — |
| 4 | Ciclo del culto, seguridad, reconexión de cabina, sesión fija | `PENDIENTE` | — |
| 5 | Entrada de audio real, cabina en español, VPS (región y capacidad medidas), teléfonos | `PENDIENTE` | — |
| 6 | Instalación y prueba en iglesia | `PENDIENTE` | — |

Revisión del orden: no apareció ninguna dependencia técnica que obligue a cambiarlo. Dos restricciones de procedimiento: (a) en las Fases 0–2 el oyente de prueba debe permanecer conectado toda la prueba, porque el código de Google apaga el canal sin oyentes hasta que la Fase 4 lo cambie; (b) la Fase 2 necesita `OPENAI_API_KEY` en el laboratorio para `transcribe` y `judge`.

### Fase 0 — Código de Google sin cambios + prueba corta

- **Objetivo.** Confirmar que la base corre tal cual en el PC del propietario con nuestras cuentas, y ver una renovación real.
- **Tareas.** Las 10 de §6.
- **Criterio de aceptación.** (1) Se oye la traducción ES→EN en la página del oyente. (2) Al menos un `goAway` registrado y la reconexión completada sin caída del proceso. (3) Consola guardada en `evidencia/`. (4) Primer audio y retraso percibido anotados a cronómetro en 5 frases. (5) Instalación en Windows sin errores de binarios nativos.
- **Pruebas requeridas.** Prueba corta (2–3 min) y prueba continua ≥ 12 min con una persona en un teléfono real (`evidencia/fase-0/observacion-oyente.md`).
- **Hecho hasta ahora.** Instalación con dependencias exactas, build y arranque de humo en Linux sin claves (`evidencia/fase-0/00-instalacion-linux.md`); herramientas `tools/fase0-run.ps1` y `tools/analizar-consola-fase0.ts` probadas con logs sintéticos; protocolo `evidencia/fase-0/README.md`.
- **Estado.** `BLOQUEADO` por dependencias externas: cuentas y claves (propietario), PC Windows, teléfono y persona que escuche.

### Fase 1 — Compresión, telemetría y grabación

- **Objetivo.** Que el puente pueda pasar de 15 min y que cada renovación y cada bloque de audio queden medidos en el formato del laboratorio.
- **Tareas.** (1) Crear el repositorio privado del producto con el historial de Google y el remoto `upstream` (ADR-011) y migrar la documentación (ADR-015). (2) Enviar `contextWindowCompression: { slidingWindow: {} }` en la configuración de Gemini. (3) Registrar en `eventos.jsonl`: cada `goAway` (hora, `timeLeft`), cada `SessionResumptionUpdate` (resumable, antigüedad del handle, sin escribir el handle completo), apertura y `setupComplete` de cada conexión (duración), cierres (código, razón), tokens. (4) Grabar `pastor.wav` y `traduccion_cruda.wav` con `t0` = primer bloque del pastor. (5) Activar `inputAudioTranscription`. (6) Medir la cola de salida (ms) cada segundo. (7) Marcas de los tramos 3, 4, 6 y 7 de `INFRAESTRUCTURA.md` §3; ping del WebSocket; estadísticas WebRTC de cabina y celular cada 10 s. (8) Pruebas unitarias con un Gemini falso. (9) `DIFERENCIAS.md` inicial.
- **Criterio de aceptación.** Una prueba de ≥ 16 min con compresión no muere a los 15; `judge` y `diagnose` leen la carpeta producida sin cambios; pruebas unitarias pasan.
- **Pruebas requeridas.** Unitarias; prueba real de 16–20 min.
- **Estado.** `PENDIENTE`.

### Fase 2 — Pruebas largas con el mecanismo oficial

- **Objetivo.** Demostrar, con grabación y juez, si el mecanismo oficial sostiene 25, 40, 60 y 90 minutos sin pérdida ni duplicación.
- **Tareas.** (1) Prueba de 25 min con un sermón real, un oyente conectado todo el tiempo, ≥ 2 renovaciones y paso del minuto 15. (2) `transcribe`, `judge`, `diagnose`. (3) Repetir a 40, 60 y 90 min. (4) Opcional: control de 25 min **sin** compresión. (5) Nueva línea base de latencia del modelo (capa 1) sin sesgo; curva de la cola; deriva.
- **Criterio de aceptación, por renovación.** Toda frase dicha entre 10 s antes del `goAway` y 10 s después del cambio aparece traducida; ninguna repetida; ningún hueco mayor que los normales de la misma prueba; el retraso no queda más alto después del cambio. Por prueba: sin bloqueos silenciosos; cola estable; deriva ≈ 0.
- **Pruebas requeridas.** 4 pruebas reales + juez + diagnóstico. Evidencia en `evidencia/`.
- **Estado.** `PENDIENTE`.

### Fase 3 — Decisiones con evidencia

- **Objetivo.** Decidir, solo con los datos de la Fase 2, si el mecanismo oficial queda como está o si hace falta una medida mínima para un fallo concreto.
- **Tareas.** Presentar la evidencia por renovación; registrar la decisión en `DECISIONS.md`; fijar el umbral de la cola (PEN-002); fijar la meta de latencia realista frente a la nueva línea base (PEN-003); decidir 16 kHz vs 48 kHz y tamaño de bloque (PEN-001, PEN-009) si hay datos.
- **Criterio de aceptación.** ADR registrado con evidencia enlazada.
- **Estado.** `PENDIENTE`.

### Fase 4 — Ciclo del culto, seguridad, cabina, sesión fija

- **Objetivo.** Que el canal pertenezca al culto y que nadie sin contraseña pueda apagarlo ni suplantar a la cabina.
- **Tareas.** O1: iniciar/terminar culto desde la cabina; el canal no se apaga sin oyentes; conteo de oyentes informativo; políticas de seguridad configurables. O2: identidades asignadas por el servidor; baja y borrado protegidos; sin listado público; timeouts y espera creciente en reconexiones de Gemini; revisión de claves en registros. O4: el puente sobrevive cortes de cabina y de sala. O7: sesión fija de la iglesia que sobrevive reinicios y arranca sola; persistencia del handle en disco. Pruebas unitarias y de integración con Gemini falso.
- **Criterio de aceptación.** Oyente desconectado 5 min → Gemini sigue activo y la traducción continúa al volver; un cliente que intenta entrar como `organizer-host` o `translator-en` es rechazado; reinicio del servidor con culto activo → la cabina se reconecta y la traducción sigue; cabina desconectada 2 min → al volver, traducción sin reiniciar el culto.
- **Pruebas requeridas.** Unitarias; integración; prueba real de 25 min con cortes provocados.
- **Estado.** `PENDIENTE`.

### Fase 5 — Entrada real, cabina en español, VPS, teléfonos

- **Objetivo.** Audio limpio desde la consola, operador en español, despliegue en el servidor real con región y capacidad medidas, validación en celulares.
- **Tareas.** O5: selector de dispositivo y canal; procesamiento de llamada apagado; medidor de nivel; configuración recordada. O9: cabina en español. Despliegue en VPS con dominio y HTTPS (`INFRAESTRUCTURA.md` §9). Protocolo de región (§4) y de capacidad (§5). Pruebas largas en el VPS. Teléfonos: iPhone y Android, 10 min con pantalla bloqueada, Wi-Fi→datos, desconexión de audífonos. Prueba acústica (capa 4).
- **Criterio de aceptación.** Tres pruebas de 90 min en el VPS sin bloqueos silenciosos y sin renovación con frase perdida; cola estable; RTT dentro de criterio o región cambiada; capacidad medida registrada; ambos teléfonos siguen sonando con pantalla bloqueada y al cambiar de red; mediana y p90 de las cuatro capas de latencia registrados.
- **Pruebas requeridas.** 3 × 90 min; región; capacidad; teléfonos; acústica.
- **Estado.** `PENDIENTE`.

### Fase 6 — Iglesia

- **Objetivo.** Ensayo con la consola real sin congregación y luego un culto real con un oyente.
- **Tareas.** Conexión consola→USB→cabina; ajuste de la mezcla auxiliar; ensayo; culto real; encuesta al oyente con `docs/rubrica-evaluacion.md` y `docs/plantilla-evaluacion.csv`.
- **Criterio de aceptación.** Culto completo sin intervención del operador después de "Iniciar culto"; evidencia de las cuatro capas de latencia; calificación del oyente registrada.
- **Estado.** `PENDIENTE`.

## 10. Inventario del laboratorio (`voice-traductor`)

| Pieza | Ruta | Estado |
|---|---|---|
| Contrato de motores (`TranslationEngine`) | `packages/engines/src/types.ts`, `base.ts`, `registry.ts` | Funciona (pruebas) |
| Motores | `packages/engines/src/engines/`: `openai-translate.ts`, `gemini-translate.ts`, `qwen-livetranslate.ts`, `hibiki.ts` (+ `tools/hibiki_bridge.py`), `mock.ts` | OpenAI y Gemini probados en real (resultados históricos reportados); Qwen y Hibiki pendientes |
| Audio (PCM, remuestreo, WAV) | `packages/engines/src/audio/` | Funciona (pruebas) |
| Banco | `apps/bench/src/`: `run`, `synth`, `prepare`, `diagnose`, `replay`, `transcribe`, `judge`, `phrases`, `report` | Funciona; sesgo de arranque conocido en `run.ts` |
| Pruebas automáticas | `npm test` (43) y `npm run typecheck` | Pasan (2026-10-08) |
| Documentación técnica del laboratorio | `docs/*.md`, `docs/plantilla-evaluacion.csv`, `docs/frases-interactivas.txt`, `docs/lectura-continua.txt` | Vigente |
| Documentación de proyecto (fuente de verdad hasta la migración) | `PROJECT_CONTRACT.md`, `PROJECT_STATUS.md`, `BITACORA.md`, `DECISIONS.md`, `INFRAESTRUCTURA.md`; `CLAUDE.md` (puerta de entrada) | Revisada 2026-10-08 |
| Herramientas de la Fase 0 | `tools/fase0-run.ps1` (captura con marca de tiempo y redacción), `tools/analizar-consola-fase0.ts` (`npm run fase0:analizar`) | Probadas con logs sintéticos (2026-10-08); pendientes de uso real |
| Material de prueba | `samples/` y `runs/` (ignorados por git) | Vacíos en el repositorio; en el PC del propietario |
| Evidencia commiteable | `evidencia/fase-0/` | `README.md` (protocolo), `00-instalacion-linux.md`, `observacion-oyente.md` (plantilla); faltan `entorno-pc.txt`, `consola-dev.txt`, `analisis-consola.md` de la prueba real |

## 11. Evidencia disponible y faltante

| Evidencia | Disponible | Dónde |
|---|---|---|
| Resultados OpenAI PS1 15 min | Resumen (RESULTADO HISTÓRICO REPORTADO) | `docs/estado-del-arte-latencia.md`, `docs/alternativas-proveedores.md` |
| Resultados Gemini PS4 (dos corridas) | Resumen (RESULTADOS HISTÓRICOS REPORTADOS) | Conversación; **faltan** los artefactos |
| Pruebas automáticas del laboratorio | Sí, reproducible | `npm test` |
| Lectura del repositorio de Google | Sí (hallazgos en `DECISIONS.md` y en el plan) | Clon local de la sesión; no está en el repositorio |
| Fuentes de la decisión de infraestructura | Sí, citadas | `INFRAESTRUCTURA.md` §15 |
| Código de Google instalado, construido y arrancado en Linux sin claves | Sí, reproducible | `evidencia/fase-0/00-instalacion-linux.md` |
| Prueba del código de Google contra LiveKit y Gemini, con teléfono | **No** | Pendiente del propietario (`evidencia/fase-0/README.md`) |
| Cualquier medición de LiveKit, de región o de capacidad del VPS | **No** | — |
