# PROJECT_CONTRACT.md — Contrato de trabajo y memoria técnica oficial de Voice Traductor

Versión 1.1 · 2026-10-08 · Propietario: Sebastián (soldiersebasti) · Este documento cambia poco. Si cambia, se registra en `DECISIONS.md`.

> **Regla de lectura.** Cualquier persona o IA que vaya a tocar este proyecto lee, en este orden: `PROJECT_CONTRACT.md` (este archivo), `PROJECT_STATUS.md`, las últimas entradas de `BITACORA.md` y, si la tarea toca arquitectura o infraestructura, `DECISIONS.md` e `INFRAESTRUCTURA.md`. Nada se implementa antes de eso.

---

## A. Qué es Voice Traductor

Voice Traductor será una plataforma de **traducción simultánea para iglesias**.

1. El pastor habla.
2. La plataforma recibe una señal de audio limpia (consola, interfaz USB o micrófono en las primeras pruebas).
3. Una IA genera la traducción simultánea, voz a voz.
4. **Una sola traducción por idioma** se distribuye a todos los oyentes de ese idioma.
5. Los asistentes escuchan desde sus celulares con audífonos.

La arquitectura final debe poder evolucionar a un SaaS multiiglesia sin rehacer el núcleo de audio.

## B. Objetivo actual

La primera instalación es una **iglesia real**, no un laboratorio.

| Parámetro | Valor |
|---|---|
| Dirección inicial | **ESPAÑOL → INGLÉS** |
| Primera validación | 1 iglesia · 1 culto · 1 canal de traducción (inglés) · 1 oyente |
| Qué reduce esa validación | La **escala** |
| Qué NO cambia | La **arquitectura** |

No construimos prototipos desechables que nunca usaríamos en una iglesia real. Lo que se prueba con un oyente es exactamente lo que después sirve a cien.

## C. Visión futura

Voice Traductor deberá poder evolucionar a: múltiples iglesias, múltiples cultos, múltiples idiomas, múltiples oyentes, cuentas, planes, Stripe, métricas de consumo, selección de voces, posiblemente voces personalizadas o clonadas, administración, QR/enlaces/códigos e infraestructura distribuida cuando haga falta.

**Pero no implementamos esas cosas antes de necesitarlas.**

Principio: **NO SOBREARQUITECTURA**. Tampoco soluciones desechables si existe una ruta razonable hacia producción. La regla práctica: cada pieza que se construye hoy debe seguir siendo válida con 100 oyentes y 3 idiomas; cada pieza que solo haría falta con 50 iglesias se deja para cuando haya 5.

## D. Arquitectura base aprobada

La base del producto es el repositorio oficial de Google:

**`google-gemini/gemini-live-translate-livekit`** (Apache 2.0, Next.js 16 + LiveKit + Gemini Live Translate). Decisión: `DECISIONS.md` ADR-001.

No reconstruimos desde cero lo que Google y LiveKit ya resolvieron: captura en el navegador, sala WebRTC, publicación de pistas, bot servidor que conecta la sala con Gemini, subtítulos, QR, reproducción en el celular, reconexión del oyente, compresión Opus, búfer de red, servidores de rescate para redes difíciles.

### Arquitectura conceptual

```
PASTOR
 → consola / fuente de audio (mezcla auxiliar solo de voces)
 → computadora de cabina (navegador, página del organizador)
 → LiveKit (sala del culto, WebRTC)
 → nuestro puente de traducción (proceso Node en nuestro servidor)
 → Gemini Live Translate (una sesión lógica por idioma)
 → nuestro puente (publica la pista traducida y los subtítulos)
 → LiveKit (misma sala)
 → celular del oyente (página del asistente)
 → audífonos
```

### Principio fundamental

**UNA sesión de traducción Gemini por idioma. NO una sesión por oyente.** LiveKit distribuye la misma traducción a todos los oyentes de ese idioma. (ADR-003, ADR-006)

### Producto y laboratorio: qué es cada cosa

**La etapa de demo inicial terminó.** Desde el 2026-10-08 hay exactamente dos repositorios con funciones distintas, y nada se mezcla entre ellos.

| | **PRODUCTO REAL** | **LABORATORIO** |
|---|---|---|
| Repositorio | Repositorio **privado** nuevo, derivado con historial completo de `google-gemini/gemini-live-translate-livekit` (aún no creado; se crea en la Fase 1, ADR-011) | `soldiersebasti/voice-traductor` (este repositorio) |
| Qué es | Lo que corre en la iglesia y, después, el servicio comercial | Herramientas para medir, comparar y diagnosticar |
| Contiene | Páginas de cabina y oyente, API, puente LiveKit↔Gemini, ciclo del culto, seguridad, grabador y telemetría (`src/vt/`), despliegue (Dockerfile, compose, Caddy), `DIFERENCIAS.md` | Banco (`run`), juez (`judge`), diagnóstico (`diagnose`), simulación de reproducción (`replay`), transcripción de referencia (`transcribe`), generación de frases (`phrases`), informes (`report`), adaptadores de motores (OpenAI, Gemini, Qwen, Hibiki, mock), pruebas controladas, comparación de motores, análisis de grabaciones, documentación técnica del laboratorio, `evidencia/` |
| Qué NO contiene | Código de benchmark ni adaptadores de otros motores | Código que sirva un culto. El adaptador Gemini del laboratorio (`packages/engines/src/engines/gemini-translate.ts`) **no** es el puente del producto y no se lleva al producto. |
| Quién lo ejecuta | El VPS, la cabina y los celulares | El PC del propietario (y el publicador de prueba contra el producto) |
| Formatos compartidos | Escribe `eventos.jsonl`, `pastor.wav`, `traduccion_cruda.wav`, `corrida.json` por culto (ADR-013) | Lee esos archivos con `judge` y `diagnose` sin cambios |

Sobre el código que ya existe en este repositorio: **todo es laboratorio**. No hay código de producto aquí, así que no hace falta mover nada a `legacy/` o `demo/`. Las propuestas anteriores de arquitectura (hub propio por WebSocket, relevos propios de Gemini) no existen como código; quedan registradas como rechazadas en `DECISIONS.md`. En el repositorio del producto, las piezas "demo" del código de Google (ciclo atado a oyentes, identidades libres, despliegue en Cloud Run) se corrigen o se reemplazan según `PROJECT_STATUS.md` Fases 4–5 y quedan anotadas en `DIFERENCIAS.md`; sus documentos originales se conservan como archivos de upstream, no como nuestra guía de despliegue.

El laboratorio mide; el producto sirve. (ADR-002, ADR-013)

## E. Gemini

| Dato | Valor | Fuente verificada |
|---|---|---|
| Modelo candidato actual | `gemini-3.5-live-translate-preview` | Único modelo de Google voz a voz para traducción en vivo. Estado: preview. |
| Audio | Entrada 16 kHz (el puente de Google envía 48 kHz y Gemini lo acepta); salida 24 kHz PCM mono | Repositorio de Google; nuestro adaptador |
| Duración de una conexión WebSocket | ≈ 10 minutos; antes del cierre llega `goAway` con `timeLeft` | Documentación oficial de gestión de sesiones |
| Sesión solo audio sin compresión | ≈ 15 minutos máximo | Documentación oficial |
| Sesión con `contextWindowCompression` | Sin límite documentado | Documentación oficial |
| Reanudación | `sessionResumption` en la configuración → el servidor envía `SessionResumptionUpdate` (`newHandle`, `resumable`) → la conexión siguiente envía `sessionResumption.handle` con el último handle válido | Esquema oficial v1beta (rev. 2026-10-06) y SDK `@google/genai` 2.28.0 |
| Vigencia del handle | 2 horas después de que termina la sesión | Documentación oficial |
| Modo `transparent` (`lastConsumedClientMessageIndex`) | **No disponible** en la Developer API; solo en Gemini Enterprise Agent Platform | El SDK oficial lanza error si se usa en Developer API |
| Precio de pago (oct-2026, verificar) | ≈ 3,50 USD/M tokens entrada, 21 USD/M salida, ≈ 25 tokens/s → hasta ≈ 2,2 USD por hora y por idioma | Página de precios de Gemini |
| Cuota gratuita | 3–5 WebSockets simultáneos; no sirve para producción | README de Google |

### Mecanismo aprobado para sesiones largas (ADR-005)

```
una sesión lógica
 → varias conexiones WebSocket
 → goAway (con timeLeft)
 → último handle válido (resumable = true)
 → nueva conexión con sessionResumption.handle
 → contextWindowCompression activo en todas las conexiones
```

El repositorio de Google ya implementa `sessionResumption`, guarda solo handles con `resumable = true` y reconecta al recibir `goAway`. Lo único que le falta del mecanismo oficial es `contextWindowCompression`.

**No inventar una estrategia alternativa de rotación** (transición en pausa, drenaje ordenado, sesiones nuevas, vigilantes) hasta que una prueba demuestre que el mecanismo oficial falla para nuestro caso.

Debe probarse específicamente, con grabación y juez:

- más de 15 minutos (supera el límite sin compresión);
- al menos dos `goAway` (dos renovaciones);
- 40 minutos;
- 60 minutos;
- 90 minutos.

Criterios por renovación: sin frase perdida, sin frase duplicada, sin hueco mayor que los huecos normales de la misma prueba, sin aumento sostenido del retraso. Si falla: **documentar la evidencia** (qué renovación, qué se perdió o duplicó, registros) **antes de cambiar arquitectura**.

## F. Ciclo del culto (ADR-004)

La traducción pertenece al **CULTO**. No pertenece a los oyentes.

| Momento | Comportamiento exigido |
|---|---|
| Inicio | El operador inicia el culto desde la cabina (con contraseña). En ese momento se crea el canal de traducción: entra a la sala, abre Gemini, espera el audio del pastor. |
| Durante | Gemini y el canal inglés permanecen activos mientras dure el culto, **haya o no oyentes**. |
| Oyentes | Pueden entrar, salir, perder conexión y volver **sin destruir la sesión de traducción**. Nunca crean ni apagan la traducción. |
| Cortes de cabina | El puente conserva la sesión de Gemini, espera a la cabina y toma su nueva pista de audio. |
| Reinicio del servidor | La sesión fija de la iglesia se recrea al arrancar. |
| Fin | Solo termina cuando el operador termina el culto, o cuando una **política de seguridad explícita y configurable** lo haga (por ejemplo: cabina ausente 15 minutos, o culto de más de 4 horas). |
| Costo | Gemini cobra mientras el pastor habla, haya o no oyentes. Es un costo aceptado del diseño. |

El código de Google **no** cumple esto hoy: crea el canal con el primer oyente y lo apaga con el último. Es el cambio O1 del plan (ver `PROJECT_STATUS.md`, Fase 4).

## G. Principios no negociables

1. **Latencia baja es requisito central del producto.** Se mide siempre; no se asume.
2. **No agregar componentes que introduzcan retraso innecesario.** Cada salto nuevo en la ruta del audio debe justificarse y medirse.
3. **Ninguna API key privada puede llegar al navegador de un usuario.** Las claves viven solo en el servidor (`.env` con permisos 600, o gestor de secretos). Nunca se pegan en un chat.
4. **Una sesión IA por idioma, no por persona.**
5. **El oyente no debe notar las renovaciones internas de Gemini.**
6. **La infraestructura debe soportar cultos largos** (40, 60, 90 minutos; margen hasta 4 horas).
7. **La pérdida de una conexión de teléfono no puede destruir el contexto del culto.**
8. **Las decisiones deben medirse.** Sin medición no hay decisión, hay hipótesis.
9. **Los errores deben registrarse.** Un fallo corregido sigue en la historia (`BITACORA.md`).
10. **No marcar algo "hecho" sin validarlo.** Ver la definición de HECHO (sección K).
11. **Mantener separación** entre traducción, distribución, interfaz y negocio/billing.
12. **Stripe futuro no debe definir el pipeline de audio.**
13. **Multiiglesia futuro debe permanecer posible.** Nada se cablea a "la única iglesia" sin una vía clara para N.
14. **No reconstruir algo existente en Google/LiveKit sin una razón demostrable.**
15. **No introducir una dependencia nueva sin justificar qué problema resuelve** y sin registrar su versión.
16. **Mantener la versión del producto sincronizable con el repositorio de Google** (sección P).
17. **Los cambios en el producto se hacen primero en archivos propios**; los archivos de Google se tocan con enganches mínimos.
18. **Las grabaciones de audio del culto son datos sensibles**: se guardan solo para medir, el tiempo necesario, con conocimiento de la iglesia, y nunca en un repositorio público.
19. **Cada culto deja registro de costo** (minutos de Gemini, minutos de LiveKit) para poder facturar después sin rediseñar.

## H. Objetivos de latencia

Escala de referencia del retraso percibido por el oyente:

| Retraso | Calificación |
|---|---|
| 1–2 s | excelente |
| 2–3 s | aceptable |
| 3–4 s | perceptible |
| 4–5 s | problemático |
| 5+ s | malo para la interacción |

**Meta del propietario:** mantener un promedio cercano a **2 segundos** de retraso. Línea base real disponible: ver `PROJECT_STATUS.md` (la medición de referencia de Gemini tiene un sesgo de arranque pendiente de corregir; la meta se confirma o se ajusta con la nueva línea base de la Fase 2).

**Diferenciar siempre estas cuatro latencias, y reportarlas por separado:**

| Capa | Qué incluye | Cómo se mide |
|---|---|---|
| **1. Latencia del modelo** | Desde que el audio del pastor sale de nuestro puente hacia Gemini hasta que llega el audio traducido al puente | `eventos.jsonl` del puente: marca de envío vs marca de llegada; `judge` fin→fin e inicio→inicio sobre `pastor.wav` y `traduccion_cruda.wav` |
| **2. Latencia agregada por Voice Traductor** | Captura en cabina, publicación a LiveKit, suscripción del puente, cola de salida del puente, publicación de la pista traducida | Marcas en el puente (cola en ms), estadísticas de LiveKit en cabina y en el puente |
| **3. Latencia hasta el dispositivo** | Red hasta el celular y búfer de jitter de WebRTC | Estadísticas WebRTC del navegador del oyente (`jitterBufferDelay`, RTT, pérdidas), enviadas cada 10 s |
| **4. Latencia acústica real al oído** | Todo lo anterior más el audífono (Bluetooth: +0,1 a 0,3 s) | Grabación simultánea del audio original y de la salida del celular; medición manual |

La métrica principal del producto es la **capa 4**; la métrica que decide entre modelos es la **capa 1**.

## I. Escalabilidad

Inicialmente probamos con **un** oyente. La arquitectura debe permitir que LiveKit distribuya la misma traducción, después, a 10, 50, 100, 300 o más oyentes **sin crear nuevas sesiones Gemini por persona**.

| Escalón | Qué cambia | Qué no cambia |
|---|---|---|
| 1 → 98 oyentes | Nada (plan gratuito de LiveKit Cloud: 100 conexiones simultáneas) | Arquitectura |
| 98 → ~300 oyentes | Plan de pago de LiveKit Cloud | Arquitectura |
| > 300 oyentes o > 20 idiomas | Salas por idioma (arquitectura de tres capas que recomienda Google) | Puente, Gemini, páginas |
| > 10 000 oyentes | Egress a HLS + CDN | Puente, Gemini |
| Varias iglesias simultáneas | Coordinación de instancias (Redis o base de datos) | Puente, Gemini, páginas |

El **dominio** es uno solo, de Voice Traductor, y se reutiliza entre iglesias; no es un costo ni una configuración de cada cliente (ADR-017). Cómo se identifica cada iglesia dentro de ese dominio (ruta o subdominio) está pendiente (PEN-010).

La **capacidad real** de un servidor (cuántos canales sostiene) no se cita como hecho hasta medirla con el protocolo de `INFRAESTRUCTURA.md` §5: CPU, RAM, red, disco con grabación simultánea, número de WebSockets, retraso del event loop y huecos de audio, por escalones de canales. Hasta entonces toda cifra de capacidad lleva la etiqueta ESTIMACIÓN PENDIENTE DE VALIDACIÓN.

## J. Reglas de cambio de arquitectura

Una decisión arquitectónica aprobada solo cambia si existe al menos una de estas condiciones:

- limitación demostrada (con registros o medición);
- bug reproducible;
- medición que contradice la premisa de la decisión;
- cambio del proveedor (modelo retirado, precio, límite, API);
- requisito nuevo real del propietario o de la iglesia;
- evidencia clara de una solución mejor (medida, no supuesta).

Cada cambio se registra en `DECISIONS.md` con un ADR nuevo que reemplaza o modifica al anterior. El ADR anterior no se borra: se marca como reemplazado.

## K. Definición obligatoria de "HECHO"

Una tarea **no** puede marcarse como terminada solo porque existe código.

Para marcar algo como **HECHO** deben existir, según corresponda:

1. implementación terminada;
2. prueba ejecutada;
3. resultado observado;
4. criterio de aceptación cumplido;
5. evidencia registrada (dónde está el archivo, el registro o la medición);
6. riesgos o limitaciones documentados.

Estados permitidos para tareas y fases:

| Estado | Significado |
|---|---|
| `PENDIENTE` | No se ha empezado |
| `EN CURSO` | Se está trabajando; hay cambios sin validar |
| `IMPLEMENTADO / PENDIENTE DE VALIDACIÓN` | El código existe; la prueba no se ha ejecutado o no se ha medido |
| `HECHO` | Cumple los seis puntos de arriba |
| `BLOQUEADO` | No puede avanzar por una dependencia externa (cuenta, clave, equipo, decisión) |
| `FALLÓ` | La prueba se ejecutó y no cumplió el criterio |

Si una prueba falla, queda registrado en `BITACORA.md`: qué se esperaba, qué ocurrió, evidencia, hipótesis, siguiente acción. **Nunca** se oculta un fallo sustituyéndolo por otro cambio sin documentarlo.

Frases que **no** son criterio suficiente: "creo que funciona", "debería funcionar", "parece correcto", "ya está implementado". Criterio suficiente: **IMPLEMENTADO + PROBADO + RESULTADO MEDIDO + EVIDENCIA REGISTRADA.**

### Dónde se guarda la evidencia

- Registros, métricas, `juez.md`, `diagnostico.md`, `resumen.md`, capturas y notas: en `evidencia/<fecha>-<nombre-de-la-prueba>/` dentro de este repositorio, y se **commitean**.
- Audio (`.wav`, `.mp3`): **no** se commitea (pesa y es sensible). Queda en el PC del propietario o en el servidor, y la entrada de bitácora dice dónde.
- Cada entrada de `BITACORA.md` enlaza la carpeta de evidencia.

## L. Regla de trabajo para todas las sesiones futuras

**ANTES de modificar código:**

1. Leer `PROJECT_CONTRACT.md`.
2. Leer `PROJECT_STATUS.md`.
3. Leer las últimas entradas relevantes de `BITACORA.md`.
4. Leer `DECISIONS.md` si la tarea toca arquitectura; `INFRAESTRUCTURA.md` si toca servidores, claves o despliegue.
5. Confirmar branch y commit (`git status`, `git branch --show-current`, `git rev-parse --short HEAD`).
6. Identificar la fase y el objetivo actual.
7. Confirmar que el cambio solicitado pertenece a ese objetivo. Si no pertenece, decirlo antes de empezar.

**DESPUÉS de modificar código:**

1. Ejecutar las pruebas pertinentes (unitarias, banco, prueba real, según la tarea).
2. Medir el resultado.
3. Registrar fallos.
4. Actualizar `BITACORA.md` (append-only).
5. Actualizar `PROJECT_STATUS.md` (fotografía actual).
6. Actualizar `DECISIONS.md` **solo** si hubo una decisión arquitectónica.
7. No declarar la fase terminada hasta cumplir los criterios de aceptación.

**Reglas de método del propietario (vigentes mientras no las cambie):**

- No usar agentes, subagentes, workflows, paneles ni procesos paralelos de análisis salvo petición explícita.
- No pedir nunca que se pegue una clave en el chat.
- No implementar, instalar dependencias ni hacer commits cuando la tarea es de análisis o de documentación, salvo que se pida.
- Antes de que el propietario cree una cuenta o active un servicio, decirle qué cuenta, qué región, qué cuota gratuita, qué credencial y qué activación necesita.
- Entorno del propietario: Windows, `npm.cmd`, CMD. Los comandos se dan para CMD.

## M. Regla de desviación

Si durante una tarea se descubre algo que:

- contradice la arquitectura;
- afecta el SaaS futuro;
- aumenta significativamente la latencia;
- cambia costos;
- rompe seguridad;
- crea una sesión por oyente;
- introduce riesgo de pérdida de audio;
- rompe compatibilidad con el upstream de Google;
- exige infraestructura nueva;
- contradice una decisión registrada;

**DETENERSE** antes de convertirlo en una arquitectura nueva. Registrar el hallazgo (bitácora) y presentarlo al propietario con evidencia y opciones. No cambiar silenciosamente el rumbo del proyecto.

## N. Regla de pruebas

Cada componente importante debe tener una forma de demostrar que funciona. Según corresponda:

| Tipo | Para qué | Dónde |
|---|---|---|
| Pruebas unitarias | Lógica aislada (parsers, colas, reconexión con un Gemini falso) | `*.test.ts`, `npm test` |
| Pruebas de integración | Puente ↔ LiveKit ↔ Gemini falso | Producto |
| Simuladores | Gemini falso que emite `goAway`, cierres, confirmaciones que no llegan, handles rechazados | Producto |
| Reproducción de audio grabado | Sermones reales a velocidad real | Banco (`run`) y publicador de prueba del producto |
| Prueba real con Gemini | Comportamiento del modelo y de las renovaciones | Producto + banco |
| Benchmark | Comparar motores con el mismo audio | `npm run bench -- run` |
| Judge | Calidad y retraso percibido frase a frase | `npm run bench -- judge` |
| Diagnose | De dónde viene el retraso | `npm run bench -- diagnose` |
| Telemetría | Cola, renovaciones, estadísticas del oyente | Puente y página del oyente |
| Prueba en teléfono | iPhone y Android, pantalla bloqueada, audífonos | Manual, con protocolo |
| Prueba acústica | Latencia real al oído | Grabación doble |

No todas las tareas necesitan todas las pruebas. Pero **ninguna función crítica puede depender únicamente de la inspección visual del código**.

## O. Regla de error

Un error descubierto **no** se borra de la historia cuando se corrige. `BITACORA.md` debe mostrar la cadena completa:

```
error detectado → diagnóstico → corrección → prueba → resultado
```

Especialmente importante para: `goAway`, `sessionResumption`, `contextWindowCompression`, pérdidas de audio, duplicaciones, cola, deriva, latencia, desconexiones, LiveKit, cabina, teléfonos.

## P. Upstream de Google (ADR-011)

Para mantener nuestra versión sincronizable con `google-gemini/gemini-live-translate-livekit`:

1. **Conservar el historial.** El repositorio del producto nace con `git clone` del repositorio de Google (historial completo) y se publica como repositorio **privado** nuestro. No se usa el botón "Fork" de GitHub porque un fork de un repositorio público no puede ser privado.
2. **Mantener el remoto `upstream`** apuntando a Google. Traer mejoras con `git fetch upstream` y `git merge upstream/main`. **Siempre merge, nunca rebase** de nuestra rama principal.
3. **Minimizar cambios invasivos.** Nuestro código vive en archivos propios (`src/vt/`: ciclo del culto, sesión Gemini, grabador, telemetría, entrada de audio). En los archivos de Google solo se hacen enganches pequeños.
4. **Documentar nuestras diferencias** en `DIFERENCIAS.md` del repositorio del producto: cada archivo de Google tocado, qué cambió y por qué.
5. **Poder incorporar cambios futuros de Google**: después de cada merge se corren las pruebas automáticas y una prueba real corta (≈ 25 min con dos renovaciones).
6. **Probar después de cada actualización** antes de desplegar en la iglesia.
7. **Mantener las versiones de dependencias de Google** (ADR-012). No actualizamos por cuenta propia; solo si un fallo lo exige, y queda registrado.
8. **Licencia.** Apache 2.0 exige conservar `LICENSE` y los avisos de copyright, y marcar los archivos modificados. No usamos marcas de Google. La nota "Translation generated by Gemini" del oyente puede quedarse.
9. **Aportes a Google.** Lo que sirva a todos (compresión de contexto, tiempos máximos, identidades asignadas por el servidor) se propone como PR a Google. Requiere firmar su CLA. Cada aporte aceptado reduce nuestras diferencias.

## Q. Seguridad y secretos

- Claves: `GEMINI_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `BROADCAST_PASSWORD` (producto); `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DASHSCOPE_API_KEY` (laboratorio). Viven en `.env` / `.env.local`, ignorados por git, permisos 600 en el servidor.
- Claves distintas para el PC de desarrollo y para el servidor. Si una clave aparece en un chat, un registro o un commit, se rota ese mismo día.
- Los tokens que recibe el navegador son **JWT de LiveKit de corta vida** emitidos por nuestro servidor, nunca la clave de LiveKit ni la de Gemini.
- Huecos conocidos del código de Google que se cierran antes de la iglesia (cambio O2): identidades elegidas por el cliente, borrado de sesión y baja de traducción sin contraseña, listado público de sesiones.
- Detalle operativo en `INFRAESTRUCTURA.md`.

## R. Glosario

| Término | Significado en este proyecto |
|---|---|
| **Culto** | Un servicio de la iglesia; la unidad a la que pertenece la traducción |
| **Cabina** | Computadora y persona (operador) que envían el audio del pastor; en el código de Google, "organizer/broadcast" |
| **Oyente / asistente** | Persona que escucha la traducción en su celular; en el código de Google, "attendee/watch" |
| **Puente** | `TranslationBridge`: proceso en nuestro servidor que une LiveKit con Gemini (bot `translator-<idioma>`) |
| **Canal** | Un idioma de traducción activo en un culto (un puente, una sesión Gemini) |
| **Sala** | Room de LiveKit; una por culto |
| **Sesión lógica** | La sesión de Gemini que atraviesa varias conexiones gracias a la reanudación |
| **Renovación** | Cambio de conexión WebSocket con Gemini provocado por `goAway` o por un cierre |
| **Handle** | Token de reanudación que Gemini entrega en `SessionResumptionUpdate` |
| **Banco** | El benchmark de este repositorio (`npm run bench -- run`) |
| **Juez** | `judge`: calificación automática de calidad y retraso percibido |
| **Diagnóstico** | `diagnose`: descomposición del retraso por frase |
| **Línea base** | Medición de referencia del modelo sin nuestra distribución |
| **Sesgo de arranque** | Defecto conocido del banco: todos los retrasos incluyen el tiempo de conexión del motor (`apps/bench/src/run.ts`, `t0` vs `tStart`) |
| **PS1, PS4** | Grabaciones de prédicas reales usadas en las pruebas (no están en el repositorio) |

## S. Stack canónico del producto (etapa actual)

Estados: `aprobado` · `temporal` (se reemplaza en una fase conocida) · `pendiente de validar` (aprobado en papel; se confirma al ejecutarse). No hay componentes que no hagan falta hoy. (ADR-016)

| Componente | Tecnología | Responsabilidad | Por qué se usa | Estado |
|---|---|---|---|---|
| Frontend (cabina y oyente) | Next.js 16.2.6 (App Router), React 19.2.4, `@livekit/components-react`, `livekit-client` | Cabina: captura y publicación del audio, control del culto, QR. Oyente: selección de idioma, reproducción, subtítulos, pantalla encendida | Viene en el repositorio de Google; LiveKit mantiene los SDK | `aprobado` |
| Backend (API) | Rutas API de Next.js en el mismo proceso (`/api/sessions`, `/api/token`, `/api/translate*`) | Sesiones, emisión de JWT, control de puentes | Repositorio de Google; una sola instancia | `aprobado` (con los cambios O1/O2 de la Fase 4) |
| Runtime | Node.js 22 | Ejecuta páginas, API y puentes | `node:22-slim` del Dockerfile de Google; binarios de `rtc-node` | `aprobado` |
| Framework | Next.js 16 con build `standalone` | Un solo servidor para páginas y API | Repositorio de Google | `aprobado` |
| Puente de traducción | `TranslationBridge` (TypeScript) sobre `@livekit/rtc-node` y `ws` | Bot que entra a la sala, envía el audio del pastor a Gemini y publica la pista traducida y los subtítulos | Repositorio de Google; nuestras extensiones (compresión, grabación, telemetría, ciclo del culto) en `src/vt/` | `aprobado` |
| Distribución realtime | LiveKit Cloud (SFU WebRTC, Opus, TURN) | Llevar la pista del pastor al puente y la traducción a los celulares | ADR-006 | `aprobado` (autoalojado pospuesto) |
| Traducción IA | Gemini Live Translate `gemini-3.5-live-translate-preview`, por WebSocket directo (sin SDK) | Voz a voz ES→EN con reanudación y compresión oficiales | Único modelo voz a voz de Google; el repositorio de Google habla con la API directamente | `aprobado`; modelo en preview (riesgo R1) |
| Servidor | VPS Hostinger KVM 2, Ubuntu 24.04, Docker + compose | Alojar el proceso único | ADR-009 | `pendiente de validar` (Fase 5) |
| HTTPS / proxy | Caddy 2 | TLS automático y proxy a `app:8080` | Configuración mínima; renueva certificados solo | `pendiente de validar` (Fase 5) |
| Estado actual | Memoria del proceso (`TranslationSessionManager`, singleton) | Culto activo, puentes, handle de Gemini, contadores | Repositorio de Google | `temporal` (O7 persiste la sesión fija; la etapa comercial lo mueve a Redis/BD) |
| Persistencia futura | Redis o base de datos (**no elegida**) | Estado compartido entre instancias; cuentas; consumo | Solo hace falta con varias instancias o varias iglesias | `pendiente` (no se elige ahora) |
| Observabilidad | `eventos.jsonl` y grabaciones por culto; estadísticas WebRTC del oyente; registros de Docker con rotación; chequeo externo de disponibilidad | Medir, diagnosticar, avisar | Formato compartido con el laboratorio (ADR-013) | `pendiente de validar` (Fase 1) |
| Laboratorio | `voice-traductor`: TypeScript, `tsx`, `node:test`, `ws`; comandos `run`, `judge`, `diagnose`, `replay`, `transcribe`, `phrases`, `synth`, `prepare`, `report` | Medir motores y cultos grabados | ADR-002 | `aprobado` |
| Producto | Repositorio privado derivado de Google con remoto `upstream` y `DIFERENCIAS.md` | Lo que corre en la iglesia | ADR-001, ADR-011 | `aprobado`; repositorio no creado aún |

## T. Fuente de verdad documental y migración al repositorio del producto (ADR-015)

**Hasta que exista el repositorio del producto, estos cinco documentos de `voice-traductor` son la fuente oficial:** `PROJECT_CONTRACT.md`, `PROJECT_STATUS.md`, `BITACORA.md`, `DECISIONS.md`, `INFRAESTRUCTURA.md`.

**Cuando se cree el repositorio del producto** (primer paso de la Fase 1), la migración se hace así, en un solo commit en cada repositorio:

1. En el producto: copiar los cinco documentos tal cual a la raíz, más `CLAUDE.md` adaptado. Primera entrada nueva de `BITACORA.md` en el producto: "Migración de la documentación desde `voice-traductor` commit `<hash>`". Desde ese momento el producto es la **fuente canónica**.
2. En el laboratorio: reemplazar `PROJECT_CONTRACT.md`, `PROJECT_STATUS.md`, `DECISIONS.md` e `INFRAESTRUCTURA.md` por un archivo de una pantalla, `PRODUCTO.md`, que diga dónde vive la fuente canónica y qué commit se migró. Eliminar las copias (el historial de git las conserva). **No quedan dos contratos ni dos `PROJECT_STATUS`.**
3. `BITACORA.md`: hay **una sola**, en el producto. Las sesiones de laboratorio posteriores se registran allí con el prefijo `LAB:` en el título y enlazan su evidencia en `voice-traductor/evidencia/`.
4. `DECISIONS.md`: hay **uno solo**, en el producto. Las decisiones de laboratorio (motores, criterios del juez) también van allí.
5. El laboratorio conserva lo suyo: `README.md` (con el puntero al producto), `docs/` (banco, juez, motores, rúbrica), `evidencia/` (resultados de corridas de laboratorio), `samples/README.md`, `CLAUDE.md` reducido al puntero y a los comandos del laboratorio, y `PRODUCTO.md`.
6. El producto conserva su propia `evidencia/` para las pruebas del producto (Fases 0–6). Cada entrada de bitácora dice en qué repositorio y carpeta está su evidencia.
7. Regla permanente: si alguien encuentra una copia antigua en el laboratorio, no la edita; va al producto.

## U. Medición de consumo, límites del proveedor y planes del cliente (ADR-018)

**Requisito del producto, registrado el 2026-10-08.** Voice Traductor tendrá un **MASTER** (panel de administración) donde se vea con claridad el consumo de infraestructura, en especial de LiveKit. No se construye en la Fase 0; se recogen los datos crudos desde la Fase 1 y el panel llega en la etapa comercial. Detalle de fuentes en `INFRAESTRUCTURA.md` §16.

Dos conceptos distintos que el panel no debe confundir:

| Concepto | Qué mide | Ejemplo de presentación |
|---|---|---|
| **A. Consumo mensual** | Minutos-participante acumulados en el mes frente al cupo del plan | `LiveKit este mes · 3 420 / 5 000 min utilizados · 1 580 min disponibles · 68 % consumido` + barra de progreso. Alertas en 80 %, 90 % y 95 %, y aviso de cuándo hace falta subir de plan. |
| **B. Capacidad simultánea** | Participantes conectados ahora frente al máximo simultáneo del plan | `Participantes conectados ahora: 37 / 100 · Capacidad disponible: 63 conexiones` |

**Origen de los datos.** LiveKit Cloud **no** ofrece en los planes Build y Ship una API para consultar los minutos consumidos del mes (su Analytics API exige el plan Scale o superior y, aun así, no devuelve minutos-participante). Por eso **Voice Traductor lleva su propia medición y esa es la fuente primaria**; los números del panel de LiveKit (y de Google AI Studio para Gemini) sirven para **reconciliar** y corregir. Regla: `participantConnected → hora de entrada; participantDisconnected → hora de salida; diferencia → minutos-participante`, redondeando cada conexión hacia arriba al minuto entero como hace LiveKit; se cuentan **todos** los participantes, incluidos la cabina y el puente traductor. Se acumula por culto, por iglesia y por mes, y de ahí salen: minutos usados, minutos restantes según el plan configurado, participantes simultáneos, pico de participantes, horas de traducción y consumo por culto. Para Gemini, la fuente primaria son los segundos de sesión y los `usageMetadata` (tokens) que la Live API devuelve por conexión.

**Límites del proveedor y planes del cliente son cosas distintas y se modelan por separado:**

| | PROVIDER LIMITS | CUSTOMER PLAN LIMITS |
|---|---|---|
| Qué es | Lo que LiveKit y Gemini nos permiten o nos cobran (cupo de minutos del plan, conexiones simultáneas, precio por minuto u hora, tope duro del plan gratuito) | Lo que Voice Traductor le vende a cada iglesia (por ejemplo, PLAN X: hasta X oyentes simultáneos + X horas o minutos de servicio al mes) |
| Dónde se configura | Configuración de la plataforma (valores por proveedor y plan contratado, con fecha) | Configuración por iglesia |
| Quién lo vigila | El MASTER, con alertas para el operador de la plataforma | El MASTER por iglesia y, después, la facturación |
| Relación | La suma de los planes vendidos no puede superar los límites del proveedor sin subir de plan | Un plan de cliente nunca se define como "lo que nos da LiveKit gratis" |

No se implementa facturación ahora. Lo que sí queda fijado: el modelo de datos de consumo tiene `iglesia`, `culto`, `participante`, `entrada`, `salida`, `minutos` y `proveedor`, de modo que después se pueda facturar sin rediseñar el pipeline de audio (principios 12 y 19).

## V. Referencias oficiales

- Repositorio base: https://github.com/google-gemini/gemini-live-translate-livekit
- Gestión de sesiones de Live API: https://ai.google.dev/gemini-api/docs/live-session
- Traducción en vivo con Gemini: https://ai.google.dev/gemini-api/docs/live-api/live-translate
- Referencia WebSocket de Live API: https://ai.google.dev/api/live
- Guía oficial para agentes de Live API: https://github.com/google-gemini/gemini-skills/blob/main/skills/gemini-live-api-dev/SKILL.md
- SDK oficial: https://www.npmjs.com/package/@google/genai
- LiveKit Cloud, planes: https://livekit.com/pricing
- LiveKit, despliegue propio: https://docs.livekit.io/transport/self-hosting/deployment.md
- LiveKit, puertos y firewall: https://docs.livekit.io/transport/self-hosting/ports-firewall.md
- Hostinger, ubicación de servidores: https://support.hostinger.com/en/articles/1583267-where-are-your-servers-located
- Hostinger, firewall de VPS: https://support.hostinger.com/en/articles/8172641-how-to-use-vps-firewall
