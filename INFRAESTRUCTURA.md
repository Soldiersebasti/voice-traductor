# INFRAESTRUCTURA.md — Decisión de infraestructura, evidencia, servidores, claves, seguridad y operación

Versión 1.1 · 2026-10-08 · Complementa `PROJECT_CONTRACT.md` §Q, §S y `DECISIONS.md` ADR-009. **Nada de este documento ha sido ejecutado todavía.**

## 0. Cómo leer este documento

Cada afirmación lleva una de tres etiquetas. No se mezclan.

| Etiqueta | Significado |
|---|---|
| **[HECHO DOCUMENTADO]** | Está escrito en una fuente del proveedor o en el código del repositorio de Google; la fuente se cita. |
| **[INFERENCIA TÉCNICA]** | Conclusión nuestra a partir de hechos documentados y del código. Razonada, no medida. |
| **[ESTIMACIÓN PENDIENTE DE VALIDACIÓN]** | Número o comportamiento que no hemos medido. Se valida en la fase indicada y se reemplaza por el dato medido. |

Las fuentes consultadas se listan en §15 con el número `[Fn]` que se cita en el texto. Nota de método: en esta sesión los dominios `ai.google.dev`, `docs.cloud.google.com`, `docs.livekit.io` y `hostinger.com` estaban bloqueados por el proxy del entorno; sus páginas se consultaron a través de fragmentos devueltos por el buscador y de descargas directas de esquemas y paquetes oficiales. Donde la fuente es un tercero y no el proveedor, se dice.

---

## 1. Decisión de infraestructura y su evidencia

**Decisión (ADR-009):** para esta etapa, **VPS Linux (Hostinger KVM 2, Ubuntu 24.04, Docker + Caddy) para la aplicación y el puente, y LiveKit Cloud para la distribución WebRTC.**

### 1.A Opciones comparadas

| Opción | Qué es | Comparada en detalle |
|---|---|---|
| **O1. Hostinger VPS (KVM)** | Máquina virtual Linux administrada por nosotros; el propietario ya administra hosting en Hostinger | Sí |
| **O2. Google Cloud Run** | Contenedores sin servidor; lo que recomienda el README de Google | Sí |
| **O3. Google Compute Engine** | Máquina virtual en Google Cloud | Sí |
| **O4. VPS + LiveKit autoalojado** | Igual que O1 pero sin LiveKit Cloud: nosotros operamos el SFU, TURN y Redis | Sí (para posponerla) |
| **O5. Otros proveedores de VPS** (Hetzner Ashburn, DigitalOcean Nueva York, Vultr, AWS Lightsail Virginia) | Alternativas de VPS con centros en Virginia o Nueva York | **No** en detalle. Quedan como reserva si la medición de región de Boston resulta insuficiente (PEN-004). |
| **O6. Servidor dentro de la iglesia** | Un PC en el templo | Descartada sin comparación numérica: depende de la luz y el internet del templo y no sirve a varias iglesias |

### 1.B Fuentes consultadas por opción

| Opción | Fuentes |
|---|---|
| O1 Hostinger | Página de planes VPS vía buscador [F7]; artículo de soporte sobre ubicación de servidores [F8]; artículo de soporte sobre firewall de VPS [F9]; comparativas de terceros sobre precios y uptime [F10], [F11] |
| O2 Cloud Run | README y docs del repositorio de Google (comando `gcloud run deploy`, notas de operación) [F1]; contrato de runtime de contenedores de Cloud Run vía buscador [F4]; página "Using WebSockets" de Cloud Run vía buscador [F5]; blog oficial sobre apagado ordenado [F4] |
| O3 Compute Engine | Documentación de migración en vivo y mantenimiento de host vía buscador [F6] |
| O4 LiveKit autoalojado | Documentación de LiveKit: puertos y firewall, despliegue propio [F13], [F14]; búsqueda sin resultados de LiveKit corriendo en Hostinger |
| LiveKit Cloud (común a O1–O3) | README de Google [F1]; planes de LiveKit Cloud [F12]; arquitectura de malla y regiones de LiveKit Cloud vía buscador [F15] |
| Gemini (común a todas) | Esquema v1beta de la API [F2]; SDK `@google/genai` 2.28.0 [F3]; guía oficial de Live API [F16] |

### 1.C Criterios de evaluación

Los que fijó el propietario, con la forma en que se evaluó cada uno:

| Criterio | Cómo se evaluó |
|---|---|
| Cultos de 40, 60 y 90 minutos | ¿El proceso Node vive 2 h sin que el proveedor lo reemplace? ¿Hay límites de duración de conexión? |
| Latencia cercana a 2 s | ¿La opción agrega tramos o distancia? (§3) |
| Estabilidad | ¿Qué puede reiniciar o reemplazar la instancia y con cuánto aviso? |
| Sesiones largas de Gemini | ¿Se conserva el estado (handle, culto activo) durante el culto? |
| LiveKit | ¿Cambia algo del lado de LiveKit? (no en O1–O3; sí en O4) |
| Trazabilidad y grabaciones | ¿Hay disco local normal para ≈ 0,5 GB por culto y registros? |
| Recuperación ante fallos | ¿Qué pasa al reiniciar el proceso, la instancia o la red? (§2) |
| Costo | Fijo y variable por culto (§6) |
| Mantenimiento | ¿Quién administra qué? ¿Encaja con lo que el propietario ya opera? |
| Escalabilidad futura | ¿Hay una ruta a varias iglesias e instancias sin rehacer el código de audio? |

### 1.D Hallazgos específicos

**Procesos de 90 minutos**
- Cloud Run: el proceso vive mientras haya una petición entrante activa o la instancia no se apague por inactividad; con `--min-instances 0` la instancia se apaga ≈ 15 min después de que la cabina deja de consultar; el código de Google mantiene la instancia viva consultando `/api/translate/status` cada 3 s desde la cabina. **[HECHO DOCUMENTADO]** [F1]. Que esa consulta sea el único hilo que mantiene el culto vivo es frágil. **[INFERENCIA TÉCNICA]**
- VPS y Compute Engine: el proceso vive hasta que nosotros lo paremos. **[HECHO DOCUMENTADO]** (naturaleza de una VM) [F6], [F7].

**WebSockets largos**
- Cloud Run: las conexiones WebSocket **entrantes** se tratan como peticiones HTTP largas sujetas al tiempo máximo de petición, hoy 60 min; al vencer, el cliente se desconecta. **[HECHO DOCUMENTADO]** [F5]. Nuestra conexión con Gemini es **saliente** y no está sujeta a ese límite; las conexiones WebRTC de la cabina y los celulares van a LiveKit, no a nuestro servidor. **[INFERENCIA TÉCNICA]** a partir del código de Google [F1]. Corrección de una afirmación anterior mía: el límite de 60 min no es razón para descartar Cloud Run.
- VPS: sin límite de duración de conexión. **[HECHO DOCUMENTADO]**
- Gemini: cada conexión dura ≈ 10 min y la sesión continúa por reanudación (igual en todas las opciones). **[HECHO DOCUMENTADO]** [F2], [F3], [F16].

**Reinicios y reemplazos de instancia**
- Cloud Run: antes de apagar una instancia envía SIGTERM y espera 10 s antes de SIGKILL; el blog oficial advierte que la señal puede llegar "por razones de infraestructura" con conexiones en curso y que el apagado ordenado "no siempre está garantizado"; al reducir escala se terminan las conexiones activas. **[HECHO DOCUMENTADO]** [F4]. Para un culto esto significa que un reemplazo a mitad de sermón corta la traducción y pierde el estado en memoria hasta que la cabina reinicie. **[INFERENCIA TÉCNICA]**
- Compute Engine: durante mantenimiento del host hace migración en vivo sin reiniciar la VM, con una interrupción "típicamente muy inferior a 1 s"; ante fallo de hardware reinicia la VM, "típicamente en 3 min". **[HECHO DOCUMENTADO]** [F6].
- Hostinger: anuncia 99,9 % de disponibilidad; no publica un SLA con créditos ni documenta migración en vivo. **[HECHO DOCUMENTADO]** [F7], [F10]. Un tercero midió 99,92 % en 90 días con una incidencia máxima de 42 min, y otro tercero afirma que existe un umbral no documentado de uso de CPU a partir del cual Hostinger reduce la capacidad. **[HECHO DOCUMENTADO como afirmación de terceros, no del proveedor]** [F10], [F11]. Para nosotros: un reinicio del VPS a mitad de culto es posible pero menos probable que un reemplazo de instancia en Cloud Run, y el umbral de CPU es un riesgo a vigilar midiendo. **[INFERENCIA TÉCNICA]**

**Almacenamiento temporal y grabaciones**
- Cloud Run: el sistema de archivos escribible está en memoria y consume el límite de memoria de la instancia; superarlo termina la instancia; nada persiste al apagarse. **[HECHO DOCUMENTADO]** [F4]. Grabar ≈ 0,5 GB por culto exigiría subir a Cloud Storage durante el culto. **[INFERENCIA TÉCNICA]**
- VPS KVM 2: 100 GB NVMe locales. **[HECHO DOCUMENTADO]** [F7]. Compute Engine: disco persistente. **[HECHO DOCUMENTADO]** [F6].

**Sesiones en memoria y persistencia**
- El código de Google guarda sesiones y puentes en un singleton en memoria y exige una sola instancia (`--max-instances 1`); escalar horizontalmente sin Redis crea bots duplicados. **[HECHO DOCUMENTADO]** [F1].
- Hasta la Fase 4 (O7) **ninguna** opción conserva el culto si el proceso muere: la diferencia está en la probabilidad de que muera (ver arriba). **[INFERENCIA TÉCNICA]**

**Latencia geográfica**
- LiveKit Cloud conecta a cada participante al servidor más cercano y enlaza los servidores en malla; el proyecto tiene una "región de datos" (EE. UU. por defecto) que no restringe dónde corren las sesiones; fijar regiones ("region pinning") requiere el plan Scale. **[HECHO DOCUMENTADO]** [F15]. Por tanto no elegimos región de LiveKit; elegimos dónde ponemos el puente para que esté cerca del borde que LiveKit le asigne. **[INFERENCIA TÉCNICA]**
- Hostinger ofrece VPS en EE. UU. en Boston y Phoenix. **[HECHO DOCUMENTADO]** [F8]. Cloud Run y Compute Engine ofrecen `us-east1`, `us-east4` y otras. **[HECHO DOCUMENTADO]** (catálogo de regiones de Google Cloud, de conocimiento general; no consultado en esta sesión).
- La Developer API de Gemini no expone selección de región; el enrutamiento lo hace Google. **[INFERENCIA TÉCNICA]** (el esquema de la API [F2] no tiene parámetro de región; en Vertex sí existe).
- Ningún RTT ha sido medido todavía. Todas las cifras de §3 y §4 son **[ESTIMACIÓN PENDIENTE DE VALIDACIÓN]**.

**Disponibilidad**
- Cloud Run: alta disponibilidad administrada por Google, pero con reemplazo de instancias (arriba). Compute Engine: migración en vivo. Hostinger: 99,9 % anunciado sin SLA formal. **[HECHO DOCUMENTADO]** [F4], [F6], [F7], [F10].

**Costos**
- Hostinger KVM 2: 2 vCPU, 8 GB, 100 GB NVMe, 8 TB/mes, 1 Gbps; precio de introducción ≈ 9 USD/mes a 24 meses y renovación ≈ 15 USD/mes según el proveedor y terceros (varía por promoción). **[HECHO DOCUMENTADO]** [F7], [F10].
- Cloud Run: facturación por vCPU-segundo y GiB-segundo mientras la instancia está activa; con `--no-cpu-throttling` se cobra todo el tiempo que la instancia exista. **[HECHO DOCUMENTADO]** [F1], [F4]. Para 5 cultos de 90 min al mes el costo sería del orden de centavos a pocos dólares; no lo calculamos con la calculadora oficial. **[ESTIMACIÓN PENDIENTE DE VALIDACIÓN]**
- Compute Engine `e2-medium` (2 vCPU compartidos, 4 GB) ≈ 25–30 USD/mes más disco. **[ESTIMACIÓN PENDIENTE DE VALIDACIÓN]** (precio de conocimiento general, no consultado en esta sesión).
- LiveKit Cloud: plan Build gratuito con 100 conexiones simultáneas; plan Ship ≈ 50 USD/mes con 150 000 minutos incluidos. El cupo mensual de minutos del plan Build difiere entre el README de Google (50 horas-participante) y terceros (5 000 minutos). **[HECHO DOCUMENTADO con discrepancia]** [F1], [F12].
- Gemini: ≈ 3,50 USD/M tokens de entrada, 21 USD/M de salida, ≈ 25 tokens/s → hasta ≈ 2,2 USD por hora y por idioma. **[HECHO DOCUMENTADO]** (página de precios consultada en la sesión del 2026-10-08 10:48; verificar antes de facturar).

### 1.E Por qué VPS para ESTA etapa

1. El culto es un proceso con estado de 40–90 min. Lo que más lo amenaza es que el proveedor reemplace la instancia; Cloud Run lo hace por diseño y lo documenta; una VM no. **[HECHO DOCUMENTADO + INFERENCIA TÉCNICA]**
2. Queremos grabar y medir cada culto en disco local durante las Fases 1–5; en Cloud Run eso consume memoria y exige subir a Cloud Storage. **[HECHO DOCUMENTADO]**
3. El estado vive en memoria hasta la Fase 4; mientras tanto, la opción con menos reinicios ajenos es la más estable. **[INFERENCIA TÉCNICA]**
4. El propietario ya administra hosting; el mantenimiento de un VPS Ubuntu es trabajo conocido. **[HECHO]** (dato del propietario)
5. Costo fijo bajo y predecible. **[HECHO DOCUMENTADO]** [F7]
6. Compute Engine cumple los mismos criterios que el VPS y agrega migración en vivo, pero cuesta más y mete un tercer proveedor a administrar; queda como equivalente aceptable si se prefiere tener todo en Google. **[INFERENCIA TÉCNICA]**

### 1.F Por qué se descartaron o pospusieron las otras

| Opción | Decisión | Motivo | Cuándo se reconsidera |
|---|---|---|---|
| O2 Cloud Run | **Pospuesta** | Reemplazo de instancias con 10 s de aviso; disco en memoria; dependencia de la consulta cada 3 s para no apagarse | Etapa comercial, cuando el estado viva en Redis/BD y haga falta más de una instancia. El mismo contenedor sirve. |
| O3 Compute Engine | **Equivalente aceptable, no elegida** | Cumple todo; más caro y un proveedor más que administrar | Si el propietario prefiere todo en Google, o si Hostinger falla en la medición de región o de CPU |
| O4 LiveKit autoalojado | **Pospuesta** | Exige abrir UDP 3478 y 50000–60000, TCP 7881, TURN con certificado y Redis [F13], [F14]; no hay reportes de LiveKit en Hostinger; triplica la operación | Cuando el costo de LiveKit Cloud supere ≈ 100 USD/mes o un requisito de residencia de datos lo exija |
| O5 Otros VPS | **Reserva** | No comparados; Hostinger es lo que el propietario opera | Si el RTT medido desde Boston a LiveKit o a Gemini supera 40 ms sostenidos (PEN-004) |
| O6 Servidor en la iglesia | **Descartada** | Luz e internet del templo; no sirve a varias iglesias | Nunca, salvo requisito de operar sin internet |

### 1.G Clasificación de la decisión

**HECHO DOCUMENTADO**
- Cloud Run envía SIGTERM con 10 s de gracia y puede hacerlo por razones de infraestructura con conexiones en curso [F4].
- Cloud Run: sistema de archivos en memoria que cuenta contra el límite de memoria [F4].
- Cloud Run: WebSockets entrantes sujetos al tiempo máximo de petición, hoy 60 min [F5].
- El código de Google exige una sola instancia y guarda el estado en memoria [F1].
- Cada puente consume ≈ 10 % de un vCPU y 20–30 MiB (medición de Google en su README, no nuestra) [F1].
- Compute Engine migra en vivo con interrupción típica < 1 s [F6].
- Hostinger: planes KVM, Boston y Phoenix, 1 Gbps, 99,9 % anunciado, copias semanales [F7], [F8], [F10].
- LiveKit Cloud: malla con conexión al borde más cercano; región no elegible sin plan Scale; 100 conexiones en Build [F1], [F12], [F15].
- Gemini: conexiones de ≈ 10 min, 15 min solo audio sin compresión, reanudación por handle válido 2 h, `goAway` con `timeLeft` [F2], [F3], [F16].

**INFERENCIA TÉCNICA**
- Un VPS es más estable que Cloud Run para nuestro proceso con estado de 90 min mientras el estado viva en memoria.
- La conexión saliente con Gemini no está sujeta al límite de 60 min de Cloud Run.
- No elegimos región de LiveKit; elegimos la del puente para estar cerca del borde asignado.
- El tramo de distribución (todo lo que no es el modelo) es pequeño frente al modelo; la elección VPS/nube no mueve la latencia de forma apreciable si la región es la misma.
- Los oyentes no consumen recursos de nuestro servidor; los sirve LiveKit.

**ESTIMACIÓN PENDIENTE DE VALIDACIÓN**
- "Un KVM 2 sostiene ≈ 8 canales" (§5; se mide en Fase 5).
- Todos los RTT y latencias por tramo de §3 y §4 (se miden en Fases 0–2 y 5).
- Boston como región (RECOMENDADA PARA PRUEBA, §4).
- Costos de Cloud Run y Compute Engine (no calculados con la calculadora oficial).
- Consumo de ancho de banda por canal (§5; se mide en Fase 5).
- Que `@livekit/rtc-node` instale y corra sin problemas en el VPS y en Windows (Fase 0 y Fase 5).

---

## 2. Por qué la infraestructura elegida es adecuada para cultos de 60 y 90 minutos

| Elemento | Qué ocurre durante 90 min | De quién depende | Estado de la evidencia |
|---|---|---|---|
| **Proceso Node vivo** | Un solo proceso `node server.js` dentro de Docker con `restart: unless-stopped`; nadie lo reemplaza salvo nosotros o un fallo del VPS | VPS (hardware, hipervisor), nuestro código (fugas de memoria, excepciones no capturadas) | Hecho documentado para la VM; la ausencia de fugas en 90 min se demuestra en Fase 2 y Fase 5 |
| **Conexiones LiveKit** | Cabina, celulares y puente mantienen conexiones WebRTC con LiveKit Cloud; LiveKit reconecta a los clientes de navegador ante cortes; el puente (`rtc-node`) hoy **no** vuelve a entrar a la sala si se desconecta (`translation-bridge.ts:192-197`) | LiveKit (servicio), nuestro código (O4: reconexión del puente) | Hecho documentado (código); robustez del puente pendiente (Fase 4) |
| **Conexión con Gemini** | ≈ 9 conexiones sucesivas de ≈ 10 min unidas por reanudación; compresión de contexto activa | Gemini (servicio y modelo), nuestro código (compresión en Fase 1; timeouts y espera creciente en Fase 4) | Mecanismo documentado; comportamiento con este modelo a 60 y 90 min **pendiente** (Fase 2; riesgo R4 del reporte de 58 min en otro modelo) |
| **Múltiples `goAway`** | El puente de Google abre la conexión nueva con el último handle y cierra la vieja al confirmar; se registra cada paso | Gemini (emite el aviso ≈ 50 s antes según terceros), nuestro código (telemetría) | Pendiente de medir pérdida/duplicación por renovación (Fase 2) |
| **Grabación de audio** | ≈ 0,5 GB por culto en disco NVMe local; escritura secuencial de ≈ 100 KB/s | VPS (disco), nuestro código (grabador, Fase 1) | Disco documentado; impacto en CPU del grabador se mide en Fase 5 |
| **Telemetría** | `eventos.jsonl` por culto + estadísticas WebRTC del oyente cada 10 s + `docker stats` | Nuestro código | Pendiente (Fase 1) |
| **Estado** | En memoria: culto activo, puente, handle, contadores. Hasta la Fase 4 no persiste | Nuestro código (O7: sesión fija y arranque automático) | Pendiente (Fase 4) |
| **Si el servidor se reinicia** | Hoy: el proceso vuelve por Docker, pero el culto y el handle se pierden; la cabina debe "Iniciar culto" de nuevo y la cabina y los celulares se reconectan solos a LiveKit. Después de O7: el culto se recrea solo y, si el handle (válido 2 h) se persistió en disco, Gemini reanuda con contexto | VPS (probabilidad del reinicio), nuestro código (O7) | Comportamiento de hoy: hecho documentado (código). Recuperación: pendiente (Fase 4) |
| **Si una conexión se cae** | Gemini: reconexión con handle (código de Google) y, tras O2, con timeouts. LiveKit cabina/celular: reconexión automática del SDK de navegador. LiveKit puente: hoy no vuelve (O4) | Gemini, LiveKit, nuestro código | Mixto; ver filas anteriores |
| **Si el proveedor reinicia la instancia** | VPS: equivale a "el servidor se reinicia"; Hostinger no documenta migración en vivo; anuncia 99,9 %. Cloud Run (descartada): SIGTERM + 10 s, posible a mitad de culto | VPS | Hecho documentado (proveedores); frecuencia real desconocida (se registra cada reinicio en bitácora) |

**Riesgos por responsable**

| Depende del VPS | Depende de LiveKit | Depende de Gemini | Depende de nuestro código |
|---|---|---|---|
| Reinicio o fallo de hardware a mitad de culto; umbral de CPU no documentado (afirmación de un tercero); latencia de red desde Boston; disco lleno por grabaciones sin retención | Caída del servicio o del borde asignado; cupo del plan gratuito; conexión UDP bloqueada en la red de la iglesia (cae a TCP con más latencia) | Renovación con pérdida o duplicación; corte a los 58 min reportado en otro modelo; retiro del modelo preview; latencia del modelo por encima de la meta; cuota o facturación | Canal atado a oyentes (O1); identidades falsificables (O2); puente que no vuelve a la sala (O4); conexión que abre y nunca confirma (O2); cola sin límite (O6); estado no persistido (O7); fugas de memoria en 90 min |

---

## 3. Latencia por tramo

Meta del producto: 1–2 s excelente, 2–3 s aceptable. Ninguna cifra de esta tabla ha sido medida por nosotros salvo la del modelo, que es un **resultado histórico reportado** con sesgo de arranque.

| # | Tramo | Tecnología | Latencia esperada | Medida o estimada | Qué medimos y cuándo |
|---|---|---|---|---|---|
| 1 | Micrófono → consola → USB → navegador de cabina | Analógico + conversor USB + `getUserMedia` + Web Audio | 10–40 ms | Estimada | Fase 5: prueba acústica (entra en la capa 4) |
| 2 | Cabina → LiveKit (borde más cercano) | Codificación Opus (tramas de 20 ms) + WebRTC/UDP | 30–70 ms (codificación + red costa este) | Estimada | Fase 1: estadísticas WebRTC de la cabina (RTT, jitter) |
| 3 | LiveKit → puente en el VPS | WebRTC entre el borde de LiveKit y `rtc-node`; el puente agrupa el audio en tramas de 100 ms (`frameSizeMs: 100`) | 20–40 ms de red + hasta 100 ms de agrupación | Estimada (la agrupación de 100 ms es hecho documentado en el código) | Fase 1: marca de llegada de cada trama en el puente; `ping` VPS → LiveKit (Fase 5) |
| 4 | Puente → Gemini (ida) | WebSocket TLS saliente a `generativelanguage.googleapis.com` | 10–30 ms de red | Estimada | Fase 1: ping/pong del WebSocket |
| 5 | **Modelo** | `gemini-3.5-live-translate-preview` | **≈ 2,5–3 s** (PS4: fin→fin mediana 2,88 s, primer audio 3,50 s, con sesgo de arranque; terceros reportan ≈ 2,9 s de primer audio) | **Resultado histórico reportado** + terceros | Fase 2: nueva línea base con `judge` (capa 1) y `t0` sin sesgo |
| 6 | Gemini → puente (vuelta) | WebSocket | 10–30 ms | Estimada | Fase 1: marca de llegada de cada fragmento |
| 7 | Cola de salida del puente | Cadena `captureFrame` sin límite + cola de `AudioSource` (1 000 ms por defecto) | 0–300 ms en operación normal; puede crecer sin aviso | Estimada (el "sin límite" es hecho documentado en el código) | Fase 1: atraso de la cola en ms cada segundo; Fase 3: umbral de recorte |
| 8 | Puente → LiveKit → celular | WebRTC/Opus + búfer de jitter adaptativo del navegador | 20–60 ms de red + 40–200 ms de búfer | Estimada | Fase 1–2: estadísticas WebRTC del celular (`jitterBufferDelay`, RTT, pérdidas) cada 10 s |
| 9 | Celular → audífonos | Decodificación + salida de audio; Bluetooth agrega 100–300 ms | 20–60 ms con cable; +100–300 ms Bluetooth | Estimada; Bluetooth según terceros | Fase 5: prueba acústica (capa 4) |

**Suma de todo lo que no es el modelo:** ≈ 0,3–0,9 s **[ESTIMACIÓN PENDIENTE DE VALIDACIÓN]**. Consecuencia: si la nueva línea base del modelo da 2,5 s, el oído recibirá ≈ 2,8–3,4 s, en la franja "aceptable/perceptible". **La meta de ≈ 2 s solo es alcanzable si el modelo baja de ≈ 1,5 s o si recortamos agrupación y búferes (tramos 3, 7 y 8) y lo medimos.** Eso se decide en Fase 3 (PEN-003) con datos, no antes.

**Qué medimos en cada fase**

| Fase | Medición |
|---|---|
| 0 | Cronómetro: retraso percibido en 5 frases y primer audio (aproximación de la capa 4). Registro de `goAway` con hora. |
| 1 | Marcas en el puente (tramos 3, 4, 6, 7); ping del WebSocket; estadísticas WebRTC de cabina y celular. |
| 2 | Línea base del modelo con `judge` (capa 1) sin sesgo; curva de la cola (tramo 7); deriva en 90 min. |
| 5 | RTT desde el VPS a LiveKit y a Gemini; prueba acústica de extremo a extremo (capa 4); comparación cable vs Bluetooth. |

**Cómo justifica esto la región del servidor:** los tramos 3, 4 y 6 son los únicos que dependen de dónde está el VPS y suman ≈ 40–100 ms en la costa este frente a ≈ 120–200 ms si el VPS estuviera en Phoenix o Europa. Es una diferencia real pero pequeña frente al modelo; importa más para jitter y pérdidas que para la meta de 2 s. **[INFERENCIA TÉCNICA]**

---

## 4. Región del servidor

**Región RECOMENDADA PARA PRUEBA: Hostinger Boston.** No es definitiva. Se confirma o se cambia con las mediciones de la Fase 5.

| Factor | Análisis | Evidencia |
|---|---|---|
| Proximidad a la iglesia | Carolina del Norte ↔ Boston ≈ 1 100 km; Carolina del Norte ↔ Phoenix ≈ 3 200 km. Boston es la única opción de Hostinger en la costa este [F8]. Pero la iglesia no habla con el VPS para el audio: habla con el borde de LiveKit. | Ubicaciones: hecho documentado. Distancias: geografía. RTT: no medido. |
| Proximidad a LiveKit | LiveKit asigna a cada participante el borde más cercano [F15]; desde Boston el borde será uno de la costa este. RTT esperado VPS ↔ LiveKit: 5–20 ms. | **[ESTIMACIÓN PENDIENTE DE VALIDACIÓN]** |
| Proximidad al endpoint de Gemini | `generativelanguage.googleapis.com` responde desde el punto de presencia de Google más cercano; el modelo puede estar en otra región y eso no se controla en la Developer API. RTT esperado VPS ↔ endpoint: 10–30 ms. El tiempo del modelo (segundos) no depende de nuestra región. | Inferencia + estimación |
| RTT iglesia ↔ borde de LiveKit | 10–25 ms | Estimación |
| RTT celular (en la iglesia, Wi-Fi o datos) ↔ borde de LiveKit | 15–50 ms | Estimación |
| ¿Tenemos evidencia de que Boston es mejor? | **No.** Solo geografía. | — |

**Cómo se valida (Fase 5, antes del primer culto):**
1. Desde el VPS: `ping` y `mtr` durante 5 min a `<proyecto>.livekit.cloud` y a `generativelanguage.googleapis.com`; anotar mediana y p95.
2. Desde la cabina en la iglesia: estadísticas WebRTC de LiveKit (RTT al borde) durante un ensayo.
3. Criterio: RTT VPS ↔ LiveKit ≤ 40 ms y VPS ↔ Gemini ≤ 60 ms sostenidos. Si no se cumple, se prueba un VPS en Virginia (O5, PEN-004) y se compara con los mismos comandos.
4. Resultado en `evidencia/` y en `DECISIONS.md` (se cierra PEN-004).

---

## 5. Capacidad del servidor

### Requisito mínimo (para 1 canal, 1 iglesia)

| Recurso | Mínimo | Base |
|---|---|---|
| Sistema | Linux x64 con glibc (no Alpine); Node 22 | Dockerfile de Google (`node:22-slim`) y binarios nativos de `@livekit/rtc-node` **[HECHO DOCUMENTADO]** [F1] |
| CPU | 1 vCPU | ≈ 10 % por puente + Next.js **[HECHO DOCUMENTADO en el README de Google; INFERENCIA para el mínimo]** |
| RAM | 1 GB libre en ejecución; más para construir la imagen | El README de Google advierte que 512 MiB se agotan con muchos idiomas **[HECHO DOCUMENTADO]**; `next build` suele necesitar ≈ 2 GB **[ESTIMACIÓN]** |
| Disco | 5 GB para sistema e imagen + 0,5 GB por culto grabado | Tamaño de grabación: 24 kHz × 16 bit × mono × 2 pistas × 90 min ≈ 0,5 GB **[INFERENCIA aritmética]** |
| Red | Salida TCP 443 y UDP; ≈ 2 Mbps por canal | §5 "ancho de banda" **[ESTIMACIÓN]** |

### Recomendación para esta etapa

**Hostinger KVM 2: 2 vCPU, 8 GB RAM, 100 GB NVMe, 8 TB/mes.** Por qué: permite construir la imagen en el propio servidor sin quedarse sin memoria; deja espacio para ≈ 150 cultos grabados antes de depender de la retención; mantiene margen de CPU para el grabador y la telemetría mientras medimos; el salto de precio desde KVM 1 es pequeño. El VPS debe ser **de uso exclusivo** para Voice Traductor, sin otros sitios web en la misma máquina (compartirlo agrega variaciones de CPU que se oyen como cortes **[INFERENCIA TÉCNICA]**).

**Sobre la CPU:** Hostinger describe sus planes como "vCPU"; no encontramos en sus páginas una garantía documentada de núcleo físico dedicado ni de reserva de CPU. Por eso este documento dice solo **2 vCPU**. El rendimiento real de CPU y el `steal` (tiempo que el hipervisor le quita a la VM) son métricas del protocolo de validación de §5, no supuestos. Un tercero afirma que existe un umbral no documentado de uso de CPU (riesgo R12); se vigila midiendo.

### Estimación (no medida)

| Plan | vCPU / RAM | Canales simultáneos estimados, con 50 % de margen | Etiqueta |
|---|---|---|---|
| KVM 1 | 1 / 4 GB | ≈ 3–4 | ESTIMACIÓN PENDIENTE DE VALIDACIÓN |
| KVM 2 | 2 / 8 GB | **≈ 8** | ESTIMACIÓN PENDIENTE DE VALIDACIÓN |
| KVM 4 | 4 / 16 GB | ≈ 15–20 (coincide con la recomendación de Google de 4 vCPU/4 GiB para 15–20 idiomas en Cloud Run [F1]) | ESTIMACIÓN PENDIENTE DE VALIDACIÓN |

Derivación: (vCPU × 100 % − 10 % de Next.js) × 50 % de margen ÷ 10 % por canal. La cifra de 10 % por canal es de Google, medida en Cloud Run, no en Hostinger. **Ninguna de estas cifras se cita como hecho hasta medirla.**

Ancho de banda por canal **[ESTIMACIÓN]**: hacia Gemini ≈ 1,0 Mbps (PCM 48 kHz mono 16 bit = 768 kbps, +33 % de base64); desde Gemini ≈ 0,5 Mbps (24 kHz); LiveKit entrada y salida ≈ 0,05–0,1 Mbps cada una (Opus). Total ≈ 1,6 Mbps; ≈ 1,1 GB por culto de 90 min. Con 16 kHz hacia Gemini (PEN-001) bajaría a ≈ 0,9 Mbps.

### Protocolo para medir la capacidad real (Fase 5)

1. **Montaje:** VPS KVM 2 de uso exclusivo (2 vCPU, sin garantía documentada de núcleo dedicado); el publicador de prueba del laboratorio entra a la sala como cabina y reproduce un sermón real a velocidad real; N canales activos (idiomas distintos permitidos en la sesión de prueba); M oyentes simulados con `livekit-client` en Node o navegadores reales.
2. **Escalones:** N = 1, 2, 4, 8 canales; M = 1 y 20 oyentes (los oyentes no deberían afectar al VPS; se comprueba).
3. **Qué se mide, cada 5 s durante 20 min por escalón:**
   - CPU del contenedor (`docker stats`) y del sistema (`top`, `vmstat`): % total y por núcleo; `steal` (señal de contención del hipervisor o del umbral de Hostinger).
   - RAM: RSS del proceso Node y memoria del contenedor; crecimiento en el tiempo (fugas).
   - Red: Mbps de entrada y salida (`ifstat` o `vnstat`), por canal.
   - Disco: MB/s de escritura con la grabación activa en todos los canales; `iowait`.
   - WebSockets: número de conexiones abiertas con Gemini (`ss -tn`), reconexiones y errores en `eventos.jsonl`.
   - Node: retraso del event loop (`perf_hooks.monitorEventLoopDelay`, p99).
   - Audio: huecos y cola de salida por canal (telemetría de Fase 1); `judge` sobre un canal de referencia.
4. **Criterio de "cabe":** CPU total sostenida < 60 %; `steal` < 5 %; event loop p99 < 50 ms; RAM estable (sin crecimiento sostenido en 20 min); sin huecos de audio atribuibles a carga; cola estable.
5. **Resultado:** el mayor N que cumple el criterio es la capacidad real del KVM 2. Se registra en `evidencia/` y reemplaza la estimación de esta sección y la de `DECISIONS.md` ADR-009.

---

## 6. Costos

Precios consultados en octubre de 2026; verificar antes de contratar. El **dominio no es un costo operativo del cliente**: pertenece a Voice Traductor y se reutiliza entre iglesias (ADR-017).

### Costos fijos (de la plataforma, se reparten entre iglesias)

| Concepto | Monto | Notas |
|---|---|---|
| VPS Hostinger KVM 2 | ≈ 9–15 USD/mes | Un VPS sirve a varias iglesias hasta su capacidad medida (§5) |
| Dominio de Voice Traductor | ≈ 10–20 USD/año | Uno para toda la plataforma; cada iglesia se identifica por ruta o subdominio (PEN-010) |
| Chequeo externo de disponibilidad | 0 USD (plan gratuito) | — |

### Costos variables (por iglesia y por culto)

| Concepto | Base | Por culto de 90 min, 1 idioma | Por mes con 5 cultos |
|---|---|---|---|
| Gemini (traducción) | ≈ 2,2 USD por hora y por idioma, mientras el pastor habla | ≈ 3,3 USD | ≈ 17 USD |
| LiveKit Cloud | 0 dentro del cupo del plan Build; un oyente ≈ 270 minutos-participante por culto; 50 oyentes ≈ 4 700 | 0 al inicio | 0 al inicio; con decenas de oyentes el plan Ship (≈ 50 USD/mes con 150 000 min) pasa a ser un costo fijo de plataforma |
| Ancho de banda del VPS | Incluido (8 TB/mes) | 0 | 0 |

### Costos únicos (equipo de la iglesia; no son de la plataforma)

| Concepto | Monto |
|---|---|
| Interfaz de audio USB, solo si la consola es analógica | 70–180 USD |
| Cables TRS y aislador de tierra | 10–40 USD |
| Computadora de cabina | La que ya tengan |

**Total recurrente de la primera instalación:** ≈ 9–15 USD/mes fijos de plataforma + ≈ 17 USD/mes variables de Gemini para una iglesia con 5 cultos de 90 min y un idioma. Cada culto debe dejar registrados sus tokens de Gemini y sus minutos-participante de LiveKit (principio 19 del contrato).

---

## 7. Topología y puertos

```
IGLESIA (Carolina del Norte)             LIVEKIT CLOUD (borde más cercano)    VPS HOSTINGER (Boston, por validar)   GOOGLE
consola → USB → PC de cabina             sala "iglesia-<id>"                 Next.js + puente translator-en        Gemini Live Translate
  navegador ──WebRTC (443/UDP·TCP)──▶     pista del pastor ──WebRTC──▶          │  wss 443 (salida) ──────────▶      gemini-3.5-live-translate-preview
  HTTPS (443) ──────────────────────────────────────────────────────────────▶  Caddy → app:8080
celular del oyente ◀──WebRTC─────────     pista en inglés + subtítulos ◀──────  │ publica la traducción
celular del oyente ──HTTPS (443)───────────────────────────────────────────▶  Caddy → app:8080
```

| Elemento | Entrada (abrir) | Salida (debe estar permitida) |
|---|---|---|
| VPS | TCP 22 (SSH; limitar a la IP del propietario si es fija), TCP 80 (redirección y Let's Encrypt), TCP 443 | TCP 443 a `generativelanguage.googleapis.com`; TCP 443 y **UDP** a `*.livekit.cloud` (el puente es un participante WebRTC; si UDP de salida está bloqueado, LiveKit cae a TCP/TLS con algo más de latencia) |
| PC de cabina | Nada | TCP 443 y UDP a LiveKit Cloud; HTTPS al VPS |
| Celulares | Nada | TCP 443 y UDP a LiveKit Cloud; HTTPS al VPS |

Hostinger tiene dos firewalls que deben coincidir: el del panel (por defecto descarta todo lo entrante; reglas en formato `inicio:fin`) [F9] y el del sistema operativo (`ufw`). La salida no se filtra por defecto.

## 8. Cuentas, servicios y claves

Para cada servicio: qué cuenta, qué región, qué cuota gratuita, qué credencial, qué activación. **El propietario crea las cuentas y guarda las claves en `.env` / `.env.local`; nunca en el chat.**

| Servicio | Cuenta | Región | Cuota gratuita | Credencial | Activación / notas |
|---|---|---|---|---|---|
| **Gemini (Google AI Studio)** | Cuenta Google + proyecto de Google Cloud **con facturación** | No se elige | 3–5 WebSockets simultáneos; no sirve para pruebas largas [F1] | `GEMINI_API_KEY` | Restringir la clave a la API "Generative Language". Dos claves: desarrollo (PC) y producción (VPS). |
| **LiveKit Cloud** | Cuenta en cloud.livekit.io; un proyecto por entorno | No se elige para las sesiones (borde más cercano); región de datos EE. UU. por defecto [F15] | Plan Build: 100 conexiones simultáneas; cupo de minutos con discrepancia entre fuentes [F1], [F12]. **Confirmar en el panel.** | `LIVEKIT_URL` (`wss://<proyecto>.livekit.cloud`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Proyecto de desarrollo y proyecto de producción (claves distintas) |
| **Hostinger VPS** | La cuenta de hosting del propietario | **Boston, RECOMENDADA PARA PRUEBA** (la otra opción es Phoenix) [F8] | — | Acceso SSH por clave pública | Ubuntu 24.04 LTS; KVM 2; clave SSH al crearlo; copias semanales incluidas [F7] |
| **Dominio de Voice Traductor** | Registrador del propietario | — | — | Registro `A` → IP del VPS | Caddy obtiene el certificado cuando el DNS apunta al VPS |
| **Túnel HTTPS temporal** (Fases 0–2, PC) | Ninguna (cloudflared "quick tunnel") o ngrok | — | Gratis | URL temporal | Para probar desde un celular sin VPS |
| **OpenAI** (laboratorio) | Ya existe | — | — | `OPENAI_API_KEY` | `transcribe` y `judge` en el PC |

### Variables de entorno

Del repositorio de Google (vigentes hoy) [F1]:

| Variable | Dónde | Uso |
|---|---|---|
| `GEMINI_API_KEY` | Servidor | Conexión del puente con Gemini |
| `LIVEKIT_URL` | Servidor (se entrega al navegador como URL pública; es normal) | Sala |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Servidor **solamente** | Emitir JWT para cabina, oyentes y puente |
| `BROADCAST_PASSWORD` | Servidor | Contraseña de la cabina (20+ caracteres) |

Propuestas nuestras (no existen aún): `VT_CHURCH_ID` (Fase 4), `VT_RECORD_DIR` (Fase 1), `VT_RETENTION_DAYS` (Fase 5), `VT_MAX_SERVICE_MINUTES` y `VT_BOOTH_ABSENT_MINUTES` (Fase 4).

Reglas: `/srv/voice-traductor/.env`, permisos `600`, **nunca** dentro de la imagen Docker ni en git; copia en el gestor de contraseñas del propietario.

## 9. Preparación del VPS, paso a paso [ESTIMACIÓN PENDIENTE DE VALIDACIÓN en Fase 5]

1. **Crear el VPS** (KVM 2, Boston, Ubuntu 24.04) con la clave SSH pública del propietario. Anotar la IP.
2. **Usuario de servicio:** `adduser vt`, `usermod -aG sudo vt`, copiar la clave SSH; en `/etc/ssh/sshd_config`: `PasswordAuthentication no`, `PermitRootLogin no`; reiniciar `ssh`.
3. **Firewall del sistema:** `ufw default deny incoming`, `ufw default allow outgoing`, `ufw allow 22/tcp` (o `ufw allow from <IP-fija> to any port 22`), `ufw allow 80/tcp`, `ufw allow 443/tcp`, `ufw enable`. **Firewall del panel de Hostinger:** las mismas tres reglas de entrada.
4. **Hardening:** `apt update && apt upgrade`, `unattended-upgrades`, `fail2ban`, hora sincronizada, swap de 2 GB.
5. **Docker:** Docker Engine y plugin `docker compose` del repositorio oficial; `usermod -aG docker vt`.
6. **Código:** `git clone` del repositorio privado del producto en `/srv/voice-traductor` con deploy key de solo lectura.
7. **Secretos:** `/srv/voice-traductor/.env` con las variables de §8; `chmod 600`.
8. **DNS:** registro `A` → IP del VPS; esperar propagación.
9. **Arranque:** `docker compose up -d --build`; `docker compose ps`; `docker compose logs -f app`; abrir `https://<dominio>/`.
10. **Arranque automático:** `restart: unless-stopped` y Docker habilitado en `systemd`.
11. **Registros:** rotación por tamaño (`max-size 50m`, `max-file 5`); sin claves en registros (S5).
12. **Copias:** grabaciones en `/srv/vt-data/runs/`; retención (§12); `.env` respaldado fuera del servidor; copias semanales de Hostinger activas.
13. **Monitoreo mínimo:** chequeo externo a `https://<dominio>/api/auth/status` cada 5 min con aviso al propietario; `docker stats` en las pruebas de 90 min.
14. **Medición de región y capacidad:** §4 y §5.

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

Caddy obtiene y renueva el certificado, maneja el `Upgrade` de WebSocket y agrega `X-Forwarded-Proto: https`, que el código de Google usa para construir la URL del QR [F1].

### Actualización y vuelta atrás

1. PC: `git fetch upstream`, `git merge upstream/main`, pruebas automáticas, prueba real de ≈ 25 min, commit, push.
2. VPS: `git pull`, `docker compose build app`, `docker compose up -d app`, prueba de humo de 2 min.
3. Vuelta atrás: `git checkout <commit-anterior>` y repetir el paso 2.
4. **Nunca** actualizar el día del culto.

## 10. Modelo de procesos ("workers")

- **Un solo proceso Node** (`node server.js` del build standalone de Next.js) sirve páginas, rutas API y **los puentes**. Los puentes no son procesos aparte: son objetos `TranslationBridge` dentro del mismo proceso, cada uno con su WebSocket a Gemini y su participante WebRTC (`@livekit/rtc-node`, con hilos nativos). **[HECHO DOCUMENTADO]** [F1]
- **Exactamente una instancia.** Sin PM2 en modo cluster, sin réplicas, sin balanceadores: el gestor de sesiones es un singleton en memoria; dos instancias crearían dos bots `translator-en` en la misma sala. **[HECHO DOCUMENTADO]** [F1]
- **Reinicio automático** por Docker. Hasta O7, un reinicio pierde el culto activo.
- **Consumo por canal:** ≈ 10 % de un vCPU y 20–30 MiB según Google **[HECHO DOCUMENTADO, medido por Google]**; en nuestro VPS, **[ESTIMACIÓN]** hasta la Fase 5.
- **Cuándo separar en procesos:** cuando la capacidad medida del VPS se agote o haga falta aislar iglesias; entonces un proceso puente por iglesia y coordinación por Redis/BD (etapa comercial). **[INFERENCIA TÉCNICA]**

## 11. Regiones (resumen)

| Componente | Región | Estado |
|---|---|---|
| Iglesia | Carolina del Norte | Dato del propietario |
| LiveKit Cloud | No se elige: borde más cercano a cada participante; región de datos EE. UU. | Hecho documentado [F15] |
| VPS | Hostinger Boston | **RECOMENDADA PARA PRUEBA** (§4) |
| Gemini | No se elige | Inferencia |

## 12. Datos, grabaciones y retención

- Qué se graba (Fase 1): `pastor.wav`, `traduccion_cruda.wav`, `eventos.jsonl`, `corrida.json`. ≈ 0,5 GB por culto de 90 min.
- Para qué: medir latencia, pérdida y duplicación con `judge` y `diagnose`. No para difusión.
- Dónde: `/srv/vt-data/runs/<fecha>-<iglesia>/`; se descargan al PC para analizar; al repositorio solo entran registros y resultados (`evidencia/`), nunca audio.
- Retención propuesta: **30 días** con borrado automático (`VT_RETENTION_DAYS`); pendiente de acuerdo con la iglesia (PEN-005).
- La grabación debe poder **desactivarse** por configuración una vez validado el sistema.

## 13. Entorno de desarrollo en el PC del propietario (Windows, CMD) [Fases 0–2]

| Elemento | Valor |
|---|---|
| Node | 22 LTS |
| Gestor de paquetes | `npm.cmd` |
| Binarios nativos | `@livekit/rtc-node` publica binario para Windows x64; **se confirma en Fase 0** al correr `npm.cmd install` |
| Claves | `.env.local` en la carpeta del clon de Google (ignorado por git) |
| Arranque | `npm.cmd run dev` → `http://localhost:3000` |
| Oyente de prueba | Otra ventana del navegador en el mismo PC (suficiente para Fases 0–2) |
| Oyente en celular | Túnel HTTPS temporal: `cloudflared tunnel --url http://localhost:3000` o ngrok; la página del oyente necesita HTTPS para Wake Lock |
| Audio de prueba | Sermón grabado reproducido en otra pestaña y capturado con "tab audio" de la cabina, o el micrófono del PC |
| Pruebas largas | El PC no debe suspenderse |
| Laboratorio | `voice-traductor` con `OPENAI_API_KEY` para `transcribe` y `judge` |

## 14. Seguridad: lista de verificación

| # | Control | Estado hoy | Cuándo |
|---|---|---|---|
| S1 | Claves solo en el servidor; el navegador recibe JWT de LiveKit de corta vida (TTL 4 h) | Cumplido por el diseño de Google [F1] | — |
| S2 | Claves distintas para desarrollo y producción; rotación inmediata si una se expone | Procedimiento | Al crear las cuentas |
| S3 | `.env` con permisos 600, fuera de la imagen y de git | Procedimiento | Fase 5 |
| S4 | Clave de Gemini restringida a la API Generative Language | Procedimiento | Al crearla |
| S5 | Ninguna clave en registros (revisar que un error de `ws` no incluya la URL con la clave) | **Por revisar** | Fase 4 (O2) |
| S6 | Identidades asignadas por el servidor (hoy `/api/token` acepta cualquier `identity`) | **Hueco conocido** | Fase 4 (O2) |
| S7 | Terminar culto, bajar traducción y borrar sesión solo con contraseña (hoy abiertos) | **Hueco conocido** | Fase 4 (O1/O2) |
| S8 | No listar sesiones públicamente (hoy `GET /api/sessions` devuelve todas) | **Hueco conocido** | Fase 4 (O2) |
| S9 | `BROADCAST_PASSWORD` fuerte; solo por HTTPS | Aceptado | — |
| S10 | HTTPS obligatorio; HTTP solo redirige | Caddy | Fase 5 |
| S11 | SSH solo con clave; sin root; `fail2ban`; `ufw`; actualizaciones automáticas | Procedimiento | Fase 5 |
| S12 | Límite de peticiones a `/api/token` | No existe | Etapa comercial |
| S13 | Grabaciones: retención y borrado automático; nunca en repositorios | Política §12 | Fase 5 |
| S14 | Copia de `.env` y `Caddyfile` fuera del servidor | Procedimiento | Fase 5 |

## 15. Fuentes

| # | Fuente | Qué aporta |
|---|---|---|
| F1 | README, docs y código de `google-gemini/gemini-live-translate-livekit` — https://github.com/google-gemini/gemini-live-translate-livekit | Recursos por puente, Cloud Run (`--max-instances 1`, `--no-cpu-throttling`, consulta cada 3 s), singleton en memoria, variables de entorno, Dockerfile, planes de LiveKit y Gemini |
| F2 | Esquema público v1beta de la API de Gemini (rev. 2026-10-06) — https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta | `sessionResumption`, `contextWindowCompression`, `translationConfig` |
| F3 | SDK oficial `@google/genai` 2.28.0 — https://www.npmjs.com/package/@google/genai | `SessionResumptionUpdate`, `goAway`, `transparent` solo en Enterprise |
| F4 | Contrato de runtime de contenedores de Cloud Run y blog oficial de apagado ordenado — https://docs.cloud.google.com/run/docs/container-contract · https://cloud.google.com/blog/topics/developers-practitioners/graceful-shutdowns-cloud-run-deep-dive | SIGTERM + 10 s; sistema de archivos en memoria; señal por razones de infraestructura |
| F5 | Cloud Run, "Using WebSockets" — https://docs.cloud.google.com/run/docs/triggering/websockets | WebSockets sujetos al tiempo máximo de petición (60 min) |
| F6 | Compute Engine, migración en vivo y mantenimiento de host — https://docs.cloud.google.com/compute/docs/instances/live-migration | Interrupción < 1 s; reinicio en ≈ 3 min ante fallo |
| F7 | Hostinger, planes VPS — https://www.hostinger.com/vps-hosting | KVM 1/2/4/8, 1 Gbps, 99,9 %, copias semanales |
| F8 | Hostinger, ubicación de servidores — https://support.hostinger.com/en/articles/1583267-where-are-your-servers-located | Boston y Phoenix para VPS |
| F9 | Hostinger, firewall de VPS — https://support.hostinger.com/en/articles/8172641-how-to-use-vps-firewall | Reglas `inicio:fin`; coincidencia con el firewall del SO |
| F10 | Terceros: Findstack (precios, ago-2026) y Trusted.de (sin SLA con créditos) — https://findstack.com/resources/hostinger-vps-for-ai-agents · https://trusted.de/hostinger | Precios y ausencia de SLA formal |
| F11 | Terceros: medición de uptime en 90 días y afirmación de umbral de CPU — https://bestusavps.com/blog/vps-uptime-comparison/ · https://learnwithhasan.com/self-hosting-hub/vps-providers/hostinger-vps/ | 99,92 % medido; umbral de CPU no documentado (no verificado) |
| F12 | LiveKit Cloud, planes — https://livekit.com/pricing | Build y Ship |
| F13 | LiveKit, puertos y firewall para autoalojar — https://docs.livekit.io/transport/self-hosting/ports-firewall.md | UDP 3478, 50000–60000, TCP 7881 |
| F14 | LiveKit, despliegue propio — https://docs.livekit.io/transport/self-hosting/deployment.md | TURN, Redis |
| F15 | LiveKit Cloud, arquitectura y regiones — https://docs.livekit.io/intro/cloud · https://docs.livekit.io/deploy/admin/regions · https://docs.livekit.io/deploy/admin/regions/region-pinning · https://docs.livekit.io/testing/observability/data-residency/ · https://livekit.com/blog/scaling-webrtc-with-distributed-mesh | Malla, borde más cercano, región de datos, pinning en plan Scale |
| F16 | Guía oficial de Live API para agentes — https://github.com/google-gemini/gemini-skills/blob/main/skills/gemini-live-api-dev/SKILL.md · Gestión de sesiones — https://ai.google.dev/gemini-api/docs/live-session | 15 min solo audio, ≈ 10 min por conexión, handle 2 h |

## 16. Fuentes de datos para el medidor de consumo (MASTER)

Requisito en `PROJECT_CONTRACT.md` §U y ADR-018. Consultado el 2026-10-08 (páginas de LiveKit vía buscador; esquema y SDK de Gemini descargados).

| Número que mostrará el MASTER | Fuente primaria (nuestra) | Fuente del proveedor para reconciliar | Disponible en nuestro plan | Etiqueta |
|---|---|---|---|---|
| Minutos-participante de LiveKit usados en el mes | Eventos `ParticipantConnected` / `ParticipantDisconnected` que el puente (`rtc-node`) ya recibe en la sala, con hora; más los webhooks `participant_joined` / `participant_left` / `participant_connection_aborted` / `room_finished` de LiveKit Cloud a nuestro servidor, para cubrir reinicios del puente. Cada conexión se redondea hacia arriba al minuto entero. | Panel de LiveKit Cloud (sesiones y "total connection minutes"); factura mensual, que es el registro autoritativo | Eventos y webhooks: sí, en todos los planes según la documentación general; **confirmar en el panel del proyecto** | Hecho documentado (webhooks, redondeo, factura) + inferencia (que la suma coincida con la factura; se reconcilia tras la Fase 0) |
| Cupo mensual del plan | Valor configurado en la plataforma (`PROVIDER_LIVEKIT_PLAN_MINUTES`), con fecha | Página de precios/cuotas de LiveKit: Build = **5 000 minutos-participante WebRTC** al mes y **tope duro** (al agotarse, las conexiones nuevas fallan); Ship = 150 000 incluidos + ≈ 0,0005 USD/min; Scale = 1,5 M | — | Hecho documentado (cuotas de LiveKit, oct-2026); el README de Google dice 50 horas-participante (3 000 min), discrepancia registrada |
| Participantes conectados ahora y pico | Conteo en memoria del puente (participantes de la sala menos nada: se cuentan todos, incluidos cabina y puente) | API de servidor `ListRooms` / `ListParticipants` (RoomService, Twirp) con la clave de API, para verificar al arrancar o tras una duda; límite 1 000 peticiones/min por proyecto | Sí, en todos los planes | Hecho documentado |
| Máximo simultáneo del plan | Valor configurado (`PROVIDER_LIVEKIT_MAX_CONCURRENT`) | Build: 100 conexiones simultáneas (README de Google y cuotas de LiveKit) | — | Hecho documentado |
| Analytics API de LiveKit | No se usa como fuente | `GET https://cloud-api.livekit.io/api/project/{id}/sessions` con token `roomList`: devuelve por sesión creación, última actividad, bytes y número de participantes; **no** devuelve minutos-participante | **No**: exige plan Scale o superior | Hecho documentado |
| Horas de traducción (Gemini) por culto | Segundos entre `setupComplete` y cierre de cada conexión, sumados por sesión lógica; `usageMetadata` (tokens por modalidad) que la Live API envía en sus mensajes de servidor (`LiveServerMessage.usageMetadata` en el SDK oficial 2.28.0; el adaptador Gemini del laboratorio **no** lo lee hoy, y el puente de Google tampoco: se agrega en la Fase 1) | Google AI Studio (uso por clave) y facturación de Google Cloud del proyecto | Sí | Hecho documentado (campo en el SDK); la exactitud de los tokens reportados en Live es cuestionada por un usuario en el foro de Google (no verificado) |
| Costo estimado por culto | Minutos y tokens anteriores × tarifas configuradas con fecha | Facturas de LiveKit y Google | — | Inferencia aritmética; se reconcilia con las facturas |

Reglas derivadas:

1. **Nuestra medición es la fuente primaria**; el proveedor reconcilia. Si la diferencia con la factura supera el 5 %, se investiga y se registra en bitácora.
2. Los webhooks de LiveKit no garantizan entrega: el receptor debe ser idempotente (por `id` de evento) y, al arrancar, el servidor consulta `ListRooms`/`ListParticipants` para cuadrar el estado.
3. El plan Build tiene **tope duro**: al agotar los 5 000 minutos, las conexiones nuevas fallan. Con un oyente, un culto de 90 min consume ≈ 270 minutos-participante (cabina + puente + oyente). Las alertas de 80 / 90 / 95 % existen para subir a Ship antes de que un culto se corte (riesgo R14).
4. Fase en que se recoge cada dato: los eventos de participantes y de sesión Gemini entran en `eventos.jsonl` en la **Fase 1** (sin panel); el acumulado por iglesia y mes y el MASTER con barra y alertas llegan en la **etapa comercial**.

Fuentes adicionales de esta sección: LiveKit, cuotas y límites — https://docs.livekit.io/deploy/admin/quotas-and-limits/ · LiveKit, facturación — https://docs.livekit.io/deploy/admin/billing.md · LiveKit, Analytics API — https://docs.livekit.io/deploy/admin/analytics-api.md · LiveKit, webhooks — https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events.md · LiveKit, RoomService API — https://docs.livekit.io/reference/other/roomservice-api.md · LiveKit, planes — https://livekit.com/pricing · SDK `@google/genai` 2.28.0 (`LiveServerMessage.usageMetadata`).
