# Qwen3.8-LiveTranslate como cuarto motor del banco

`qwen3.8-livetranslate-flash-realtime` es el modelo de interpretación simultánea
de Alibaba (Model Studio). Es el único proveedor comercial que publica la
métrica que nos importa, retraso promedio (LAAL) de 2,3 s, y se paga por uso.
Este documento explica qué hay que crear antes de probarlo, cómo correr la
misma prueba que se hizo con OpenAI y cómo leer el resultado.

Estado: el adaptador (`packages/engines/src/engines/qwen-livetranslate.ts`) se
escribió a partir de la documentación de Model Studio, del SDK oficial de
Python (`dashscope.audio.qwen_omni`) y de dos demos públicos del modelo, y se
probó contra un servidor simulado. **No se ha ejecutado todavía contra la API
real**: la documentación oficial de Alibaba no es accesible desde el entorno
donde se escribió. Por eso la primera corrida debe ser de humo (2 minutos) y
hay una lista de supuestos a confirmar más abajo.

## Antes de crear cuenta, clave o activar nada

| Pregunta | Respuesta | Certeza |
|---|---|---|
| 1. ¿Qué cuenta? | Cuenta **Alibaba Cloud International** en `alibabacloud.com` (no `aliyun.com`, que es la edición China y tiene otros endpoints y precios). Se registra con correo, país Estados Unidos y verificación por teléfono. Para cuentas de EE. UU. no piden verificación de identidad. | Alta (documentación de registro de Alibaba Cloud). |
| 2. ¿Qué región, estando en Carolina del Norte? | **Singapur** (`ap-southeast-1`), edición internacional de Model Studio. Es donde el modelo está publicado, donde aplica la cuota gratis y donde está el endpoint `dashscope-intl.aliyuncs.com` que usa el adaptador. Existe Model Studio en **EE. UU. (Virginia)**, pero no tiene endpoint DashScope (solo el modo compatible con OpenAI y dominios por espacio de trabajo), no da cuota gratis y no pude confirmar que este modelo esté ahí. La región no se elige al registrarse: se elige en la consola de Model Studio (selector de región) y cada región tiene su propia clave y su propia lista de modelos. Desde Carolina del Norte la ida y vuelta a Singapur es de unos 220 a 260 ms; el adaptador la mide (`net.rtt`) y el diagnóstico la descuenta. | Alta para Singapur; media para la disponibilidad en Virginia (verificar en la consola si más adelante se quiere recortar red). |
| 3. ¿Hay cuota o crédito gratis para este modelo? | Al activar Model Studio en Singapur por primera vez, la plataforma da **1 000 000 de tokens gratis por modelo elegible, válidos 90 días** desde la activación (o desde la publicación del modelo, lo que sea posterior). Aplica solo a modelos de la región Singapur con alcance de servicio "Internacional", que es el caso de este. No pude verificar en la página oficial del modelo que esté en la lista de elegibles: al abrir la consola, la ficha del modelo muestra la cuota gratis si la tiene. Con la tarifa de tokens de audio (7 tokens por segundo de entrada, 12,5 por segundo de salida), 1 M de tokens alcanza para unas 14 horas de prueba como la nuestra; la corrida completa del sermón consume menos de 100 000. Si no fuera gratis, cuesta alrededor de 1,5 a 1,7 USD por hora de audio. | Alta para la regla general de cuota; media para que este modelo esté incluido. |
| 4. ¿Qué credencial? | Una **API key de Model Studio** (empieza por `sk-`), creada en la consola de Model Studio, página "API Keys", **en la región Singapur**. Las claves son por región: una clave de Pekín o de Virginia no sirve en `dashscope-intl`. Se guarda en el archivo `.env` del PC como `DASHSCOPE_API_KEY=` (el archivo está ignorado por git y nunca viaja al repositorio ni al chat). | Alta. |
| 5. ¿Activación especial? | Hay que **activar Model Studio en la región Singapur** (aceptar los términos del servicio); queda en modalidad pago por uso cuando se agota la cuota. Desde el 15 de septiembre de 2025 Alibaba exige **completar la información de la cuenta** antes de activar Model Studio para recibir la cuota gratis. No hace falta solicitar acceso al modelo (no es una vista previa con lista de espera). Fuentes secundarias indican que no se necesita tarjeta para activar y usar la cuota gratis; para evitar que una corrida se corte al agotarse la cuota conviene tener un medio de pago cargado (acepta Visa, Mastercard, Amex, PayPal). Límites por defecto del modelo: 10 solicitudes por minuto y 100 000 tokens por minuto; una sesión WebSocket cuenta como una solicitud y consume unos 1 200 tokens por minuto, así que no estorban. | Alta para la activación; media para lo de la tarjeta. |

Secuencia sugerida: crear la cuenta → completar la información de la cuenta →
abrir la consola de Model Studio en Singapur y activar → crear la API key →
escribirla en `.env` → corrida de humo.

## Configurar y correr

En `.env` (copiar de `.env.example` si no existe):

```
DASHSCOPE_API_KEY=sk-...
```

Corrida de humo de 2 minutos, para confirmar que la clave, la región y el
protocolo están bien antes de gastar el sermón completo:

```bash
npm.cmd run bench -- run --engine qwen --input samples/PS1.mp3 --max-minutes 2 --label humo-qwen
```

Debe aparecer `Sesión Qwen #1 abierta`, luego `configurada (session.updated ...)`
y, pocos segundos después de empezar a hablar el pastor, `Primer audio traducido`.
Si aparece `HTTP 401` la clave no es de Singapur o no está activada; si aparece
un `error` del protocolo, el mensaje completo queda en `eventos.jsonl` (ver
"Supuestos a confirmar").

Corrida completa, exactamente como la de OpenAI, y la evaluación con la misma
referencia y las mismas métricas:

```bash
npm.cmd run bench -- run --engine qwen --input samples/PS1.mp3 --label continua-ps1 --mp3
npm.cmd run bench -- judge --run runs/continua-ps1-qwen --reference samples/PS1.referencia.json
npm.cmd run bench -- diagnose --run runs/continua-ps1-qwen --reference samples/PS1.referencia.json
npm.cmd run bench -- report runs/continua-ps1-openai runs/continua-ps1-qwen --out runs/comparacion-ps1.md
```

Opcional: `--source es` fija el idioma de la transcripción del original
(`input_audio_transcription.language`). No cambia la traducción, que detecta el
idioma sola; solo hace más fiable el texto original que usa el diagnóstico.

Opciones del adaptador, por `--opts` (JSON): `voice` (voz de salida; por
defecto la del servidor), `audioOutput` (`false` = solo texto), `inputTranscription`
(`false` = sin transcripción del original), `url` (otro endpoint), `model`,
`rotateAfterMs` (por defecto 110 min), `logChunks` (`false` = no registrar cada
fragmento enviado), `extra` (se fusiona en `session.update` tal cual). Ejemplo:

```bash
npm.cmd run bench -- run --engine qwen --input samples/PS1.mp3 --label ps1-voz --opts "{\"voice\":\"Tina\"}"
```

## Qué registra el adaptador (y dónde mirarlo)

Todo queda en `runs/<corrida>/eventos.jsonl`, con `t` en milisegundos desde el
inicio de la corrida. Lo que pidió la prueba:

| Qué | Dónde | Detalle |
|---|---|---|
| Momento exacto de envío de cada fragmento | evento `raw` de salida con `payload.type = input_audio_buffer.append` | `seq` (número de fragmento en la sesión), `ms` (duración), `audioMs` (audio acumulado enviado), `sentAt` (reloj del sistema). Sin el audio. 10 por segundo. |
| Llegada del primer audio traducido | estado `audio.first_output` | `sinceOpenMs` (desde que se abrió la sesión), `sinceFirstChunkMs` (desde el primer fragmento enviado), `audioSentMs`. Además, cada fragmento de audio recibido queda como evento `audio` con su `t`, que es lo que usan `judge` y `diagnose`. |
| Ida y vuelta de red | estado `net.rtt` cada 15 s | `rttMs` por ping/pong del WebSocket. El diagnóstico muestra mediana y máximo. |
| Tiempo de conexión y de configuración | estados `session.opened` (`connectMs`) y `session.ready` (`readyMs`, `confirmed`) | `confirmed: false` significa que el servidor no devolvió `session.updated` en 5 s y se envió audio igual. |
| Huecos de salida | `judge` y `diagnose` (silencios ≥ 3 s, huecos de llegada) | Igual que con OpenAI; el forense de huecos cruza con los eventos de la sesión. |
| Detección de voz del servidor | eventos `raw` de entrada `input_audio_buffer.speech_started` / `speech_stopped` (`audio_start_ms`, `audio_end_ms`) | Dicen cuándo el VAD de Alibaba abrió y cerró cada frase. |
| Reconexiones | estados `session.closed_unexpectedly`, `session.reconnecting`, `session.reconnected`, `audio.buffered_flush` | Se guardan hasta 10 s de audio durante la reconexión; lo descartado se contabiliza en las métricas de estabilidad. |
| Límites o cierres de sesión | estados `session.closed` / `session.closed_unexpectedly` (código, motivo, fragmentos y segundos enviados), eventos `error` con el `code` del servidor, `session.rotated` si se llegara a 110 min | El límite documentado para las sesiones Realtime de Model Studio es 120 min; el contexto del modelo (49 152 tokens de entrada) equivale a unos 117 min de audio a 7 tokens/s. Un sermón no debería tocar ninguno de los dos. |
| Consumo | estado `session.usage` al final | Tokens de entrada y salida (con los de audio) sumados de cada `response.done`. Sirve para cotejar la factura y la cuota. |
| Cierre correcto | estados `session.finished` o `session.finish_unconfirmed` | El adaptador manda `session.finish` y espera la confirmación; sin ella se pierde la última frase y Alibaba registra la sesión como error. |

En Windows, para ver rápido un tipo de evento:

```
findstr "speech_started" runs\continua-ps1-qwen\eventos.jsonl
findstr "first_output net.rtt session." runs\continua-ps1-qwen\eventos.jsonl
```

## Protocolo usado y supuestos a confirmar en la primera corrida

Resumen del protocolo tal como lo implementa el adaptador:

1. `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime`, cabecera `Authorization: Bearer <clave>`.
2. El servidor manda `session.created`. El adaptador manda `session.update` con `modalities: ["text","audio"]`, `input_audio_format: "pcm"` (16 kHz mono 16 bits), `output_audio_format: "pcm"` (24 kHz), `translation.language: "en"` e `input_audio_transcription.model: "qwen3-asr-flash-realtime"`. El servidor responde `session.updated`.
3. Audio continuo con `input_audio_buffer.append` (base64), fragmentos de 100 ms, incluido el silencio. El VAD del servidor decide las frases; no hay `response.create` ni turnos.
4. Salida: `response.audio.delta` (audio), `response.audio_transcript.delta` / `response.text.delta` (texto traducido), `conversation.item.input_audio_transcription.delta` / `.completed` (texto original), `response.done` con `usage`.
5. Al terminar: `session.finish` → `session.finished` → cierre.

Supuestos que la primera corrida debe confirmar, mirando `eventos.jsonl`:

- **Nombre del campo de modalidades.** La documentación de la versión 3.5 y el SDK oficial usan `modalities`; la de 3.8 nombra `output_modalities`. El adaptador manda los dos con el mismo valor. El eco en `session.updated` muestra cuál quedó vigente; si el servidor rechazara uno con `InvalidParameter`, se puede anular con `--opts "{\"extra\":{\"output_modalities\":null}}"` y, si hace falta, ajustar el adaptador.
- **Tasas de muestreo.** Por documentación: entrada 16 kHz, salida 24 kHz. `session.created` las muestra (`sample_rate`); si fueran otras hay que cambiar las constantes del adaptador, porque el banco remuestrea la fuente a la tasa que declara el motor.
- **Voz por defecto.** La documentación nombra `Tina`. Si se quiere otra, `--opts "{\"voice\":\"...\"}"`; la lista de voces por idioma está en la ficha del modelo en la consola.
- **Eventos de texto.** El adaptador acepta las variantes `*.delta` (3.8) y `*.text` con `delta` (3.5). Si el texto traducido llegara vacío en `transcripcion_traduccion.txt` pero el audio sí, el nombre del evento es otro y quedó como `raw` en `eventos.jsonl`.
- **Límite de sesión.** 120 min está documentado para los modelos Realtime de Model Studio en general; para este modelo en particular no lo vi escrito. La rotación a los 110 min existe por si acaso y no interviene en un sermón normal.

## Cómo leer el resultado frente a OpenAI

El criterio no cambia: 2 a 3 s de retraso percibido **sostenido** durante la
predicación, medido por `judge` con `samples/PS1.referencia.json` (inicio→inicio
y fin→fin: mediana, p90, porcentaje del tiempo por encima de 3 s, tramo más
largo por encima, saltos), y la calidad por el mismo juez. `report` pone los dos
motores en la misma tabla.

Sobre la cifra de 2,3 s de Alibaba: es LAAL (promedio de retraso medido en su
laboratorio, de principio de frase en el original a principio de frase en la
traducción, sin red). Nuestro retraso inicio→inicio incluye además la ida y
vuelta a Singapur (unos 0,25 s), el troceo en fragmentos de 100 ms y la cola
del reproductor. Para comparar política de modelo contra política de modelo hay
que mirar en `diagnose` el componente "modelo + red" y restarle el `net.rtt`
medido; si eso da alrededor de 2,3 a 2,6 s, la cifra publicada se sostiene con
nuestro sermón. Lo que decide el MVP es el fin→fin sostenido, no el promedio.

Costo de la prueba con precios de Singapur: entrada de audio 7 tokens/s a
7,50 USD por millón (≈ 0,19 USD por hora), salida de audio 12,5 tokens/s a
30 USD por millón (≈ 1,35 USD por hora), más texto (centavos). Una corrida
completa del sermón cuesta menos de 2 USD si no la cubre la cuota gratis.

## Después

Cuando esta corrida tenga resultado real (y los supuestos de arriba estén
confirmados o corregidos) se implementa Palabra.ai de la misma forma: otro
adaptador, misma prueba, mismos artefactos, comparación directa. No antes.
