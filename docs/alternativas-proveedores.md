# Alternativas reales para probar y comercializar interpretación simultánea de voz

Fecha: 6 de octubre de 2026. Objetivo: español → inglés en vivo, 2 a 3 s
sostenidos, una sesión por idioma para muchos oyentes, y preferencia por
pagar por uso sin administrar GPU. Precios en USD por hora de prédica, con
una sesión de traducción; los oyentes no cambian el costo del motor en
ninguna opción. Varios sitios están bloqueados desde el entorno de trabajo
(OpenAI, Alibaba, Azure, DeepL, Soniox, Hugging Face), así que esas cifras
vienen de resúmenes de buscador y deben confirmarse antes de decidir.

Hallazgo que cambia el mapa: **los pesos de Hibiki-Zero están bajo CC BY-NC-SA 4.0**
según su tarjeta de modelo en Hugging Face (el código es MIT). Es decir, no
comercial. Sirve como laboratorio y referencia, no para vender.

## 1. APIs comerciales de voz a voz simultánea, pago por uso, sin GPU

| Opción | es→en vivo | Latencia reportada o medida | ¿Simultánea? | 30 a 60 min continuos | $/h prédica | GPU propia | Licencia / comercial | 1 sesión → N oyentes | ¿Probar hoy con PS1.mp3? | Integración con el banco |
|---|---|---|---|---|---|---|---|---|---|---|
| **Qwen3.8-LiveTranslate-Flash-Realtime** (Alibaba Model Studio, región Singapur) | Sí: 60 idiomas de entrada, 29 de salida con voz | **LAAL 2,3 s** publicado por Alibaba (2,8 s la generación anterior). Sin medición independiente aún. | Sí, modelo de interpretación simultánea; emite mientras el hablante sigue | Contexto 53k tokens (49k de entrada): según la tasa de tokens de audio puede obligar a rotar sesión cada 30 a 60 min; nuestra rotación ya existe | ≈ 1,69 (audio entrada 7,5 $/M tokens, salida 30 $/M) | No | Cerrado, API; uso comercial permitido | Sí | Sí: cuenta internacional de Alibaba Cloud, 1 M tokens gratis por modelo durante 90 días | Adaptador nuevo, protocolo WebSocket tipo OpenAI Realtime (session.update, audio delta). 1 día |
| **Palabra.ai** | Sí, 60+ idiomas, clonación de voz | "< 1 s" declarado; 35 ms al primer audio de su TTS. Sin medición independiente | Sí: cascada propia con divisores de frase y predicción, emite por tokens | Sí, "sesiones indefinidas", 10 concurrentes por cuenta | 2,40 (0,04 $/min) o planes desde 60 $/mes | No | Cerrado; comercial | Sí, explícito: una sala LiveKit, pista traducida publicada, oyentes ilimitados | Sí: 50 $ de crédito | Adaptador por WebSocket o WebRTC (LiveKit). 1 día |
| **OpenAI gpt-realtime-translate** | Sí | Nuestra prédica: inicio→inicio y fin→fin mediana 4,15 s, p90 7,27 s, 80 % del tiempo sobre 3 s; LiveLingo: 0,7 s al primer audio pero mediana 3,8 s y hasta 20 s en audio denso | Sí (65 % de las frases empiezan antes de que el pastor termine), pero **acumula** | Sesión de 60 min; rotación ya implementada | 2,04 | No | Cerrado; comercial | Sí | Ya probado | Hecha |
| **Gemini 3.5 Live Translate** (preview) | Sí | ≈ 2,9 s constante al primer audio (LiveLingo); conserva entonación | Sí | Conexión de 10 min con reanudación; implementado | ≈ 2,20; gratis en preview | No | Cerrado; preview sin SLA | Sí | Sí: adaptador hecho, falta correrlo | Hecha |
| **Azure Speech Live Interpreter** (preview) | Sí, 76 idiomas, detección automática continua | "Latencia de nivel intérprete humano", sin cifra | Traducción continua con parciales de texto; el audio sintetizado sale por segmento reconocido (cuasi consecutiva por frase) | Reconocimiento continuo sin límite documentado | ≈ 2,60 (entrada 1 $/h + voz estándar 1,5 $/h + texto 10 $/M caracteres); gratis 5 h/mes | No | Cerrado; preview sin SLA | Sí | Sí: cuenta Azure con 200 $ de crédito | SDK de Azure para Node. 1 a 2 días |
| **DeepL Voice API** | Sí, es-419 incluido | Demo pública: "una o dos frases de retraso"; diseñado para reuniones, no para interpretación simultánea | Por frase | Conexión máxima 1 h; hasta 5 destinos por sesión | ≈ 4,25 (3,93 € voz a voz); 2,12 solo texto | No | Cerrado; API Pro; la voz traducida aparece como "beta cerrada" en la documentación de la API pese a la nota de prensa de GA | Sí | Texto sí; voz solo con acceso al beta | WebSocket propio. 1 a 2 días |
| **Soniox** voz a voz (STT+MT en streaming + su TTS) | Sí, 60+ idiomas, 3.600 pares | Sin cifra publicada; emite traducción "palabra por palabra a mitad de frase" | Sí a nivel de texto; la voz depende de cómo encadenemos los fragmentos | Streaming continuo | ≈ 0,18 el texto + TTS (precio de su TTS por confirmar); el más barato | No | Cerrado; comercial | Sí | Sí: créditos gratis | Dos WebSockets (STT→TTS) con nuestra segmentación. 2 días |
| Plataformas de eventos: **Wordly**, **KUDO AI**, **Interprefy Aivia** | Sí | Wordly y KUDO: 2 a 4 s en reportes de campo; Interprefy 1 a 2 s | Sí | Sí | 75 $/h en Wordly; cotización en los demás | No | Cerrado; son productos, no motores; API bajo lista blanca | Sí | No sin acuerdo comercial | Reventa, no construcción |

## 2. Cascadas con servicios alojados, pago por uso (STT → traducción → voz)

Es el único camino donde controlamos la segmentación, la **longitud** de la
traducción y la **velocidad** de la voz, que es lo que la investigación señala
para no acumular (ver `docs/estado-del-arte-latencia.md`). La latencia la fija
nuestra política, no el proveedor: 1,5 a 3 s es alcanzable con hipótesis
parciales y cierre por cláusula, como hizo en campo church-translator.

| Pieza | Opciones pago por uso | es | Precio por hora | Nota |
|---|---|---|---|---|
| Reconocimiento en streaming | AssemblyAI Universal-Streaming multilingüe (0,15 $/h), Together AI Parakeet v3 realtime (0,21), Fireworks streaming (0,19), Voxtral Realtime vía Mistral (0,36), Deepgram Nova-3 (0,46), Speechmatics (0,24 a 0,43), Gladia (0,24; 240 min gratis al mes), ElevenLabs Scribe v2 realtime | Sí todos | 0,15 a 0,46 | Todos entregan parciales por WebSocket. Soniox y Gladia además traducen el texto en el mismo stream. |
| Traducción | LLM pequeño alojado (centavos por hora), DeepL texto (2,12 $/h de audio equivalente), Google/Azure Translator | Sí | ≈ 0,05 a 0,5 | Con LLM se controla la longitud ("más corto cuando vamos atrás") y el glosario bíblico. |
| Voz en streaming | OpenAI gpt-4o-mini-tts (0,90 $/h, 13 voces, instrucciones de estilo), Cartesia Sonic (≈ 1,80; 40 a 190 ms), ElevenLabs Flash v2.5 (≈ 0,50 a 1,00; 75 ms), Deepgram Aura-2, Amazon Polly bidireccional | Inglés sí | 0,5 a 1,8 | Conexión persistente con contexto para no cortar la entonación entre frases. |
| **Total cascada alojada** | | | **≈ 1 a 3 $/h** | Sin GPU, comercial, un motor por idioma. Esfuerzo: 1 a 2 semanas para una política de latencia sólida. |

AWS no tiene producto de voz a voz simultánea (Nova 2 Sonic no traduce en
vivo); su cascada Transcribe + Translate + Polly trabaja por frase completa.
Google ofrece Gemini Live Translate como voz a voz y Chirp 3 / Gemini 3.5
Transcribe más Translation y Chirp 3 HD como cascada.

## 3. Modelos abiertos

| Modelo | es→en | Latencia | ¿Simultánea? | Licencia y uso comercial | GPU | Veredicto |
|---|---|---|---|---|---|---|
| **Hibiki-Zero 3B** (Kyutai) | Sí | Estado del arte en el paper; sin cifras en el README | Sí, política aprendida por refuerzo | Código MIT; **pesos CC BY-NC-SA 4.0: no comercial** | NVIDIA 8 a 12 GB; MLX int4/int8 en Apple (2,7 a 3,9 GB) | **Laboratorio**: la referencia de lo que logra un modelo diseñado para latencia. Adaptador y puente ya hechos. |
| Hibiki 2B / 1B (v1) | **No**, solo fr→en | — | Sí | Pesos CC-BY 4.0 (comercial) | 8 GB; 1B en celular | No aplica por idioma |
| SeamlessStreaming (Meta) | Sí | AL < 2 s | Sí | **CC-BY-NC**: no comercial | Sí | Laboratorio |
| StreamSpeech, NAST-S2x (ICTNLP) | Sí (CVSS) | AL 1,7 a 3 s | Sí | MIT | Pequeña | Calidad de investigación; no para prédica |
| Qwen3-Omni (abierto, Apache 2.0) | Voz a voz conversacional | — | No, por turnos; los LiveTranslate son cerrados | Apache 2.0 | Grande | No aplica |
| **Cascada abierta comercial**: Voxtral Realtime 4B (Apache 2.0, GPU) o Parakeet-TDT-0.6B-v3 (CC-BY 4.0, 25 idiomas, corre en CPU) o faster-whisper (MIT) con política SimulStreaming (MIT) → opus-mt-es-en (CC-BY 4.0, CPU, milisegundos) o MADLAD-400 (Apache 2.0) o EuroLLM-9B (Apache 2.0, GPU) → Kokoro-82M (Apache 2.0, CPU 6 veces tiempo real) o Pocket-TTS (MIT, CPU, clonación de voz) o Kyutai TTS 1.6B (CC-BY 4.0, GPU, 220 ms, inglés) | Sí | La fija nuestra política: 1,5 a 3 s | Sí con hipótesis parciales | Todo comercial | **Puede correr solo en CPU** con Parakeet + opus-mt + Kokoro: un VPS de 4 núcleos (20 a 40 $/mes, Hostinger sirve para esto) | Costo por hora cercano a cero; calidad de traducción menor que un LLM salvo que la traducción se delegue a un LLM alojado barato |
| Cuantizados | Hibiki-Zero int4/int8 solo MLX (Apple); EuroLLM-9B int4 ≈ 6 GB; Voxtral Realtime GGUF por confirmar | | | | | Útil para bajar VRAM en laboratorio; no cambia la licencia |

Nota: WhisperLiveKit usa NLLB para traducir y NLLB es CC-BY-NC; su parte de
traducción no es comercial.

## 4. Alojar un modelo abierto sin administrar GPU (serverless, pago por segundo)

Relevante para Hibiki-Zero en laboratorio y para la cascada abierta en
producción. Todos escalan a cero y cobran solo mientras hay sesión.

| Proveedor | WebSocket persistente | GPU apta (12 GB+) y precio | Crédito gratis | Encaje |
|---|---|---|---|---|
| **Modal** | Sí, documentado (WebSocket y WebRTC) | L4 0,80 $/h, A10G 1,10 $/h, por segundo | 30 $/mes renovables | El más directo: `hibiki-zero serve` o la cascada como app ASGI; nuestro puente apunta a la URL. 1 día |
| **Google Cloud Run GPU** | Sí; tiempo máximo de petición 60 min (reconectar) | L4 0,67 $/h + CPU/memoria ≈ 0,9 $/h total | 300 $ de prueba | Contenedor con el servidor y el puente. 1 a 2 días |
| **Baseten** | Sí, soporte renovado en 2025 | L4 0,85 $/h, A10G 1,21 $/h, por minuto | 30 $ | Empaquetar con Truss. 1 a 2 días |
| **RunPod Serverless** (endpoints con balanceo) | Sí, con puerto expuesto | L4 / 3090 / A5000 0,47 a 0,68 $/h, por segundo | No | Barato; algo más de configuración |
| **Azure Container Apps GPU** | Sí | T4 16 GB (fp16, lenta) ≈ 1,5 $/h con CPU; A100 ≈ 2 $/h | 200 $ | Solo si ya se está en Azure |
| **Cerebrium** | Sí | GPUs grandes (A100 2 $/h); verificar disponibilidad de L4/A10 | 30 $ | Alternativa a Modal |
| **fal** | Sí para apps propias | H100 2,49 a 4,50 $/h | Pocos | Sobredimensionado |
| **Hugging Face Inference Endpoints** | **No documentado**; contenedor propio sí | L4 0,80 $/h, escala a cero | No | Mal encaje para el protocolo de Moshi; existe un blog de HF con voz a voz en Endpoints por confirmar |
| Vast.ai / RunPod pods (bajo demanda, no serverless) | Sí, es una máquina | RTX 3090 0,13 a 0,30 $/h | No | Lo más barato para laboratorio; hay que apagarla a mano |
| Hostinger | n/a | Sin GPU | — | Solo para la cascada en CPU o el trabajador Node |

Costo de una hora de prédica con Hibiki-Zero en Modal: ≈ 1 $ más unos segundos
de arranque en frío. Para producción con la cascada abierta en CPU: céntimos.

## 5. Proyectos con servidor listo para consumir por WebSocket

| Proyecto | Qué sirve | Licencia | Encaje |
|---|---|---|---|
| `hibiki-zero serve` | Voz a voz, protocolo Moshi | MIT (pesos NC) | Ya conectado por `tools/hibiki_bridge.py` |
| `moshi-server` (Kyutai, Rust) | Kyutai STT y TTS por WebSocket con MessagePack; TTS inglés en streaming | Apache 2.0; pesos CC-BY 4.0 | Voz de salida para la cascada abierta |
| WhisperLiveKit | STT local + traducción NLLB por WebSocket | MIT; NLLB NC | Subtítulos locales; no para traducción comercial |
| SimulStreaming | Whisper + AlignAtt + EuroLLM por TCP | MIT | Mitad delantera de la cascada |
| SimultanAI | OpenAI/Gemini → Opus por WebSocket a navegadores | MIT | Misma arquitectura que la nuestra |
| Pipecat, LiveKit Agents | Marcos STT→LLM→TTS con transporte WebSocket/WebRTC | BSD / Apache | Piezas de cascada; su ciclo es por turnos |
| Palabra, Soniox, DeepL, Qwen, Azure | Alojados, WebSocket | Cerrados | Adaptadores nuevos de 1 a 2 días cada uno |

## 6. Créditos y pruebas gratuitas que cubren la evaluación completa

Alibaba Model Studio: 1 M tokens por modelo, 90 días. Palabra: 50 $. Modal:
30 $/mes. Baseten y Cerebrium: 30 $. Google Cloud: 300 $. Azure: 200 $ más 5
h/mes de traducción de voz. Gemini Live Translate: gratis en preview. Gladia:
240 min de tiempo real al mes. Soniox, AssemblyAI (50 $), Deepgram (200 $),
ElevenLabs y Speechmatics: créditos iniciales. Con esto se puede correr PS1.mp3
contra todas las opciones de esta lista sin pagar.

## 7. Separación: laboratorio frente a producto

**Solo laboratorio (licencia o disponibilidad):** Hibiki-Zero (CC BY-NC-SA),
SeamlessStreaming (CC-BY-NC), WhisperLiveKit con NLLB, StreamSpeech/NAST-S2x
(calidad), Seed LiveInterpret (solo China, zh↔en).

**Vendibles en producción:** Qwen3.8-LiveTranslate, Palabra, OpenAI, Gemini
(cuando salga de preview), Azure Live Interpreter (cuando salga de preview),
DeepL Voice (cuando la voz salga del beta), Soniox, y cualquier cascada con
STT/TTS alojados o con la pila abierta comercial (Voxtral o Parakeet, opus-mt
o MADLAD o EuroLLM, Kokoro o Pocket-TTS o Kyutai TTS).

## 8. Ranking

### Top 3 para probar ahora con PS1.mp3

1. **Qwen3.8-LiveTranslate-Flash-Realtime.** Es la única API comercial de voz a voz que publica la métrica que nos importa, retraso promedio de 2,3 s en interpretación simultánea, con el par que necesitamos, pago por uso a 1,7 $/h y cuota gratis. Riesgos: cifra del propio proveedor, límite de contexto por sesión, cuenta en Alibaba Cloud. Adaptador de un día sobre un protocolo casi idéntico al de OpenAI.
2. **Palabra.ai.** Hecha para eventos con una sala por idioma y oyentes ilimitados sobre LiveKit, que es nuestra distribución. Declara menos de 1 s; hay que medirlo con el banco. 50 $ de crédito, adaptador de un día.
3. **Gemini 3.5 Live Translate.** Adaptador hecho, gratis en preview, cero trabajo. Probablemente queda al límite de los 3 s, pero responde una pregunta clave: si no acumula en habla densa, un retraso constante de 3 s es mejor producto que uno que oscila entre 2 y 8.

Inmediatamente después, como laboratorio: **Hibiki-Zero en Modal** (≈ 1 $/h,
30 $ gratis, adaptador y puente hechos). No se puede vender, pero es la única
forma de ver qué hace un modelo entrenado para latencia con nuestra prédica,
y fija la vara para la cascada propia.

### Top 3 con mejor potencial para el producto comercial

1. **Qwen3.8-LiveTranslate** si la medición confirma 2 a 3 s sostenidos: el mejor precio, 29 idiomas con voz, sin GPU, y encaja en la arquitectura actual sin cambios. Dependencia de un proveedor chino en Singapur; para una iglesia no hay datos sensibles.
2. **Cascada propia con control de latencia** sobre STT y TTS alojados por uso (AssemblyAI o Deepgram, LLM barato, Cartesia u OpenAI TTS), con la pila abierta en CPU como variante de costo mínimo. Es la única opción donde controlamos longitud, velocidad y glosario, lo que la investigación identifica como la clave para no acumular, y no depende de un proveedor. Mayor esfuerzo (1 a 2 semanas) y mayor defensa del producto.
3. **Palabra.ai** si mide bien: voz a voz comercial lista, oyentes ilimitados por sesión, 2,4 $/h, clonación de voz incluida. Dependencia de una startup.

OpenAI queda como referencia de calidad (4,9 de 5) y como motor alternativo si
alguna vez corrige la acumulación; Azure Live Interpreter y Soniox merecen una
medición cuando haya tiempo, por precio y por respaldo del proveedor.

## Fuentes

- Qwen3.8-LiveTranslate: https://www.alibabacloud.com/help/en/model-studio/qwen3-8-livetranslate-flash-realtime · https://www.marktechpost.com/2026/09/19/alibaba-qwen-team-releases-qwen3-8-livetranslate/ · cuota gratis https://www.alibabacloud.com/help/en/model-studio/new-free-quota
- Palabra: https://docs.palabra.ai/docs/streaming_api · https://www.palabra.ai/pricing
- OpenAI: https://github.com/openai/openai-cookbook/blob/main/examples/voice_solutions/realtime_translation_guide.mdx · LiveLingo https://www.livelingo.io/research/benchmark-2026
- Gemini: https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-live-3-5-translate/
- Azure Live Interpreter: https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/announcing-live-interpreter-api---now-in-public-preview/4453649 · demo con precios https://github.com/honestypugh2/live-interpreter-api-demo
- DeepL Voice: https://developers.deepl.com/api-reference/voice · https://www.deepl.com/en/press-release/deepl-unveils-real-time-spoken-translation-breaking-the-next-language-barrier-with-voice-to-voice
- Soniox: https://soniox.com/docs/translation/sts-translation
- Speechmatics, Gladia, AssemblyAI, Deepgram, Together, Fireworks, Mistral Voxtral: páginas de precios respectivas (2026)
- Hibiki-Zero: https://github.com/kyutai-labs/hibiki-zero · https://huggingface.co/kyutai/hibiki-zero-3b-pytorch-bf16 (licencia de pesos)
- Kyutai STT/TTS y moshi-server: https://github.com/kyutai-labs/moshi · Pocket-TTS https://github.com/kyutai-labs/pocket-tts
- Parakeet v3: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 · opus-mt: https://github.com/Helsinki-NLP/Opus-MT · Kokoro: https://github.com/StackOneHQ/stackvox
- Modal: https://modal.com/blog/nvidia-l4-price-article · Cloud Run: https://cloud.google.com/run/pricing · Baseten WebSockets: https://docs.baseten.co/development/model/websockets · RunPod WebSockets: https://github.com/runpod-workers/worker-lb-websocket · Azure Container Apps GPU: https://learn.microsoft.com/en-us/azure/container-apps/gpu-serverless-overview
- church-translator (cascada en campo): https://github.com/ShevAlx/church-translator
