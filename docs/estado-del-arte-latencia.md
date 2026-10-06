# Estado del arte: interpretación simultánea de voz con latencia baja sostenida

Fecha: 6 de octubre de 2026. Pregunta: ¿alguien ha resuelto en la práctica la
interpretación simultánea de voz en vivo con 2 a 3 segundos de retraso
sostenido, sin esperar a que el hablante termine cada frase? Y si no, ¿qué
técnicas y código existen para acercarse?

Nota de método: varios sitios (OpenAI, arXiv, LiveLingo, el foro de OpenAI)
están bloqueados desde el entorno de trabajo; sus datos vienen de resúmenes de
buscador y deben confirmarse en la fuente. Los repositorios de GitHub sí se
leyeron directamente.

## 1. Lo que otros han medido en gpt-realtime-translate

| Fuente | Qué midieron | Resultado |
|---|---|---|
| LiveLingo, benchmark 2026 (competidor) | 120 sesiones; primer audio traducido | Mediana 711 ms desde el inicio del habla: el más rápido de los seis sistemas probados. |
| LiveLingo, mismo benchmark, audio extendido | Fin de la frase dicha → llegada de la traducción | Mediana 3,8 s y "se va quedando progresivamente atrás a medida que se acumula contenido sin traducir, hasta 20,3 s en audio denso". |
| fairflai/SimultanAI (proyecto abierto con la misma arquitectura que la nuestra) | Uso en eventos controlados, sin medición formal | "Alrededor de un segundo detrás del hablante, más el buffer del navegador y la red". Sin cifras. |
| Foro de desarrolladores de OpenAI | Reportes de usuarios | Artefactos de voz (sube el volumen de golpe cada 30 a 45 s, se apaga y vuelve), espacios faltantes en el texto, silencio cuando la fuente ya está en el idioma destino. |
| Nuestra corrida (prédica real, 15 min) | Juez frase a frase | Fin→fin mediana 4,15 s, p90 7,27 s, 80 % del tiempo sobre 3 s; huecos de hasta 10,5 s; calidad 4,91 de 5 sin omisiones. |

Lectura: el modelo arranca rápido pero, con habla densa y continua, acumula.
La medición independiente coincide con la nuestra. La propia guía de OpenAI
lo describe: fue entrenado con audio de intérpretes profesionales para
"esperar suficiente contexto antes de producir voz". Con un predicador rápido
y sin pausas, ese contexto llega tarde y la salida, además, dura más que la
entrada. Nuestra tubería aporta menos de 0,2 s; el comando `diagnose` lo
separa con datos reales (ver sección 6).

## 2. Qué dice la investigación sobre controlar la latencia y evitar la acumulación

| Trabajo | Año | Idea central | Latencia reportada | Por qué nos importa |
|---|---|---|---|---|
| A Practical Evaluation Method for Long-Form SimulS2ST (Xue, Ouyang, Li; IWSLT 2026) | 2026 | Evaluar en audio largo continuo, no en frases cortas: ASR + alineación forzada sobre la salida, alineador de frases por embeddings, métricas por frase (YAAL, ending offset). | Hallazgo: "los sistemas actuales sufren acumulación sustancial de latencia en habla larga", relacionada con la diferencia de duración entre frase traducida y original. | Es exactamente nuestro diagnóstico, con el mismo método que nuestro `judge`. Código: github.com/SakaiXue6666/Speech-to-Speech-Latency |
| Fluent and Low-latency SimulS2ST with Self-adaptive Training (Baidu) | 2020 | Ajustar la **longitud** de la traducción a la velocidad del hablante: más corta cuando habla rápido, para no acumular; más larga cuando habla lento, para no dejar huecos. | Elimina la acumulación progresiva en multi-frase. | La respuesta directa a "la traducción dura más que el original". Solo aplicable si controlamos la generación de texto (cascada o modelo propio). |
| NaturalFlow (Lee, Cho et al.) | 2026 | Un LLM puede decir lo mismo con paráfrasis más largas o más cortas; se elige la duración para que la voz no se corte entre fragmentos y siga el ritmo de entrada. | Competitiva, en cortos y largos. | Misma palanca: controlar la duración de lo dicho en vez de esperar. |
| CLASI (ByteDance) | 2024 | Agente LLM con política de leer/escribir imitada de intérpretes humanos; evaluación por "proporción de información válida". | 81 % de información válida, latencia comparable a SeamlessStreaming; solo 7 % de usuarios la encontró problemática. | Demuestra que la política de cuándo hablar se puede aprender; no hay código. |
| Seed LiveInterpret 2.0 (ByteDance) | 2025 | Modelo dúplex de voz a voz; aprendizaje por refuerzo para bajar la latencia manteniendo calidad; clonación de voz. | 2 a 3 s, zh↔en, "cerca de intérpretes humanos". | Prueba de que 2 a 3 s sostenidos son alcanzables. Solo chino-inglés, API solo en China. |
| Hibiki (Kyutai) | 2025 | Decodificador multi-flujo (arquitectura Moshi) que modela fuente y destino a la vez; 12,5 cuadros/s; transfiere la voz. | Estado del arte fr→en en calidad, fidelidad de voz y naturalidad. Secuencias de 120 s, contexto de 40 s. | Pesos y código abiertos. Solo francés→inglés. |
| Hibiki-Zero (Kyutai; ICML 2026, oral) | 2026 | Igual, sin alineaciones de palabras; se entrena a alta latencia y luego **se optimiza la latencia con refuerzo (GRPO)** conservando calidad. | Estado del arte en cinco pares X→inglés, con fr, **es**, pt, de. ~100 ms por cuadro. | **Abierto, MIT, español→inglés, 3B parámetros, GPU de 8 a 12 GB.** Candidato a motor. |
| SeamlessStreaming (Meta) | 2023 | Atención monótona eficiente (EMMA) para decidir cuándo emitir. | Retraso medio < 2 s, ~100 idiomas. | Pesos CC-BY-NC: no comercial. Calidad por debajo de los anteriores. |
| StreamSpeech y NAST-S2x (ICTNLP) | 2024 | Políticas con CTC; no autorregresivo; latencia por tamaño de fragmento. | AL 1,7 s con fragmentos de 320 ms; < 3 s. Entrenados en CVSS (voz sintética). | Código MIT con es→en, pero calidad de investigación, no de producto. |
| SimulStreaming (ÚFAL) | 2025 | Whisper con política AlignAtt: emite cuando la atención deja de apuntar al final del buffer; EuroLLM para traducir texto. Mejor sistema de IWSLT 2025. | Regímenes de 2 s y 4 s; 5 veces más rápido que WhisperStreaming. | Mitad delantera de una cascada propia, MIT. Sin voz. |
| AlignAtt4LLM, DOA (IWSLT 2026) | 2026 | Políticas sin entrenamiento para modelos de voz-LLM en forma larga. | Regímenes IWSLT. | Lectura de referencia para cascadas con LLM. |

Técnicas que se repiten en todos los sistemas que funcionan:

1. **Política explícita de leer/escribir** (wait-k, AlignAtt, EMMA, aprendida por imitación o refuerzo). Decide cuándo hay contexto suficiente. Es lo que OpenAI hace internamente y no deja ajustar.
2. **Control de la duración de la salida**: traducciones más cortas o paráfrasis cuando el sistema va atrás. Es la única forma de no acumular cuando el destino es más largo que la fuente. Requiere controlar la generación de texto.
3. **Control de la velocidad de la voz** (1,0 a 1,3 veces) según la cola. Lo usa en producción church-translator; es lo que simulamos con `replay`. Ayuda, pero no corrige una política que retiene.
4. **Hipótesis parciales en el reconocimiento** (LocalAgreement, AlignAtt, resultados interinos de Deepgram o AssemblyAI) para empezar a traducir antes de que la frase termine.
5. **Voz incremental por fragmentos con contexto continuo** (una conexión de TTS que mantiene la entonación entre frases) para que la cascada no suene cortada.
6. **Evaluación en forma larga** con alineación frase a frase, porque las métricas en frases aisladas esconden la acumulación.

## 3. Repositorios y productos, comparados

| Proyecto | Tipo | Arquitectura | Latencia reportada | es→en | Licencia | Qué podríamos aprovechar |
|---|---|---|---|---|---|---|
| [fairflai/SimultanAI](https://github.com/fairflai/SimultanAI) | Abierto, eventos | ffmpeg → servidor Node/TS → gpt-realtime-translate o Gemini Live Translate, una sesión por idioma → Opus por WebSocket a navegadores (WebCodecs) con subtítulos | "~1 s + buffers", sin medir; rotación a los 55 min (OpenAI) y 8 min (Gemini) con pérdida de alguna palabra | Sí | MIT | Es nuestra misma arquitectura ya desplegada. Distribución Opus/WebSocket sin SFU, tickets de acceso, rotación de sesiones. Preguntar a los autores por sus mediciones en audio denso. |
| [ShevAlx/church-translator](https://github.com/ShevAlx/church-translator) | Abierto, iglesia, probado en campo (sept. 2026) | AssemblyAI streaming → Claude → Cartesia, un canal físico de audio por idioma hacia transmisores FM; macOS o Raspberry Pi | En la prueba real la red fue el cuello de botella (llegó a 90 s de atraso con una conexión mala); con línea limpia, "congestión del canal": el ruso dura más que el inglés y la salida está ocupada el 75 % del tiempo. Frases largas se cierran a 150 a 170 caracteres. | Sí (configurable) | Sin licencia declarada | Política de velocidad de voz 1,0 a 1,3 según la cola, cierre de frases por número de palabras, lista de pérdidas por red. Es la experiencia de campo más honesta que encontramos. |
| [kyutai-labs/hibiki-zero](https://github.com/kyutai-labs/hibiki-zero) | Abierto, modelo | Modelo voz a voz de 3B con política aprendida por refuerzo; `hibiki-zero serve`; PyTorch y Rust | Tiempo real, ~100 ms por cuadro; sin cifra de retraso en el README; paper reporta estado del arte en latencia | **Sí** | MIT, pesos abiertos | Candidato a motor propio: encaja en nuestra interfaz `TranslationEngine`. Dudas: comportamiento en 45 min continuos (Hibiki tenía contexto de 40 s), calidad bíblica en español, GPU por servicio. |
| [ufal/SimulStreaming](https://github.com/ufal/SimulStreaming) | Abierto, investigación aplicada | Whisper large-v3 + AlignAtt + EuroLLM, servidores TCP; 1 a 2 GPU | 2 s y 4 s (IWSLT 2025) | Sí (texto) | MIT | Reconocimiento y traducción incremental para una cascada propia; sin voz. |
| [QuentinFuxa/WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) | Abierto, producto local | SimulStreaming/WhisperStreaming + NLLB, FastAPI, interfaz web | Transcripción < 500 ms | Sí (texto) | Abierto | Subtítulos locales sin nube; no resuelve la voz. |
| [SakaiXue6666/Speech-to-Speech-Latency](https://github.com/SakaiXue6666/Speech-to-Speech-Latency) | Abierto, evaluación | Qwen3-ASR + alineador forzado + alineación por embeddings; YAAL y ending offset | Método, no sistema | n/a | Abierto | Contrastar nuestro `judge` con un método publicado; mismo enfoque. |
| [azziko/simulstream](https://github.com/azziko/simulstream) | Abierto, evaluación y demo | Toolkit para sistemas de traducción de voz a texto en streaming, con retraducción y forma larga | Método | n/a | Abierto | Si construimos cascada, evaluar su mitad de texto. |
| [facebookresearch/seamless_communication](https://github.com/facebookresearch/seamless_communication) | Abierto, modelo | SeamlessStreaming con EMMA | AL < 2 s | Sí | **CC-BY-NC** | No usable comercialmente. Referencia. |
| [ictnlp/StreamSpeech](https://github.com/ictnlp/StreamSpeech), [ictnlp/NAST-S2x](https://github.com/ictnlp/NAST-S2x) | Abierto, investigación | Modelos pequeños entrenados en CVSS | AL 1,7 a 3 s | Sí | MIT | Ideas de política; calidad insuficiente para una prédica. |
| [JVictor-Silva93/simple-sermon-translator](https://github.com/JVictor-Silva93/simple-sermon-translator) | Abierto, iglesia, temprano | VAD + segmentación + STT + MT + TTS, Python, local o nube | Trabaja con segmentos finalizados; "no listo para un servicio en vivo" | Sí | AGPL-3.0 | Poco; confirma que la segmentación por VAD es el camino lento. |
| [shuoyanjerry/LiveChurchTranslation](https://github.com/shuoyanjerry/LiveChurchTranslation), [hesekkim/sermon-live](https://github.com/hesekkim/sermon-live) | Abiertos, iglesia, locales | Todo en la máquina del operador, reparto por la red local a celulares | No reportan | No (zh→en, ko→de) | Abiertos | La idea de reparto por Wi-Fi local sin internet para los oyentes. |
| [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat), [livekit/agents](https://github.com/livekit/agents) | Abiertos, frameworks de agentes de voz | STT → LLM → TTS por turnos con VAD | Sub-segundo por turno, pero **por turnos**: el pedido de "traducción sin detección de turno" en LiveKit se cerró sin solución | Sí | Apache/MIT | Piezas de cascada (agregación por frases, TTS en streaming), no la política simultánea. |
| [Palabra.ai](https://www.palabra.ai/) | Comercial, API | Cascada propia: ASR → MT (DeepL, Google, LLM propio) → TTS con clonación; "divisores de frases y algoritmos de predicción" | Afirma < 500 ms extremo a extremo y 35 ms al primer audio de voz; sin medición independiente | Sí | Cerrado, $0,04/min | Candidato a motor para comparar en el banco; verificar en audio denso. |
| Seed LiveInterpret 2.0 (ByteDance) | Comercial, API | Modelo dúplex con RL | 2 a 3 s, cerca de humanos | **No** (zh↔en) | Cerrado, Volcano Engine solo con número chino | Evidencia de que el objetivo es alcanzable. No usable. |
| Gemini 3.5 Live Translate | Comercial, API | Modelo voz a voz | ~2,9 s constante al primer audio según LiveLingo | Sí | Preview | Ya está en el banco; falta medir si también acumula en habla densa. |

## 4. ¿Está resuelto en la práctica?

- **A nivel de modelo, sí**: Seed LiveInterpret 2.0 (2 a 3 s, humanos cerca) y Hibiki-Zero (abierto, español→inglés, latencia optimizada por refuerzo) muestran que un modelo puede sostener 2 a 3 s. El primero no está disponible para nosotros; el segundo hay que probarlo.
- **A nivel de producto con español→inglés durante 45 minutos continuos, no hay evidencia pública**. Ningún proveedor publica retraso sostenido en forma larga. La única medición independiente en forma larga de gpt-realtime-translate muestra acumulación, y el único paper que evalúa forma larga concluye que "los sistemas actuales sufren acumulación sustancial".
- **Lo que sí está resuelto es el diagnóstico**: la acumulación nace de la política de espera del modelo y de que la salida dura más que la entrada. Los remedios conocidos son dos: una política entrenada para un retraso objetivo (Hibiki-Zero, Seed), o control explícito de la longitud y la velocidad de la salida (Self-adaptive, NaturalFlow, church-translator), que exige controlar la generación de texto, es decir, una cascada.

## 5. Qué revisar primero

1. **kyutai-labs/hibiki-zero**. Es el único modelo abierto, con español→inglés, diseñado para latencia. Probarlo con la misma prédica de 15 minutos a través del banco: un adaptador nuevo detrás de `TranslationEngine`, un servidor con una GPU de 12 GB. Preguntas: ¿acumula en habla densa? ¿aguanta 45 min? ¿cómo traduce vocabulario bíblico?
2. **ShevAlx/church-translator**. Leer su README y su registro de la prueba de campo de septiembre de 2026 antes de diseñar cualquier cascada: ya pagó los errores de red, segmentación y congestión del canal.
3. **fairflai/SimultanAI**. Misma arquitectura que la nuestra; comparar su distribución Opus/WebSocket con la de LiveKit y pedirles sus mediciones en audio denso.
4. **El paper de evaluación en forma larga (IWSLT 2026) y su repositorio**. Validar que nuestro `judge` mide lo mismo que la literatura; adoptar YAAL y ending offset como métricas reportables.
5. **Palabra.ai**. Un adaptador en el banco cuesta un día y responde si una cascada comercial con predicción sostiene menos de 3 s en nuestra prédica.
6. **ufal/SimulStreaming** y **pipecat** solo si se decide construir la cascada propia.

## 6. Implicación para nuestra decisión

El retraso no nace en nuestra tubería. Nace en la política del modelo, que retiene la salida hasta tener contexto, y en que la salida dura más que la entrada. Para confirmarlo con datos propios, el comando `diagnose` ahora separa:

- ida y vuelta de red (ping/pong del WebSocket, cada 15 s);
- subida más reconocimiento: inicio de habla tras una pausa → primer fragmento de transcripción de entrada;
- modelo: llegada del primer audio traducido de cada frase;
- cola de reproducción;
- y, para cada hueco de 2,5 s o más en las llegadas mientras el pastor hablaba, la evidencia: si siguieron llegando fragmentos de transcripción de entrada (el modelo oía y retuvo), qué decía el pastor y qué dijo el modelo al reanudar.

Si los huecos muestran transcripción de entrada fluyendo y ningún evento de sesión, la causa es la política del modelo, y las opciones son cambiar de modelo (Hibiki-Zero, Palabra, Gemini si no acumula) o construir una cascada con control de longitud y velocidad. Si muestran ausencia de transcripción de entrada, hay un problema de red o de envío que sí es nuestro.

## Fuentes

- OpenAI cookbook, gpt-realtime-translate: https://github.com/openai/openai-cookbook/blob/main/examples/voice_solutions/realtime_translation_guide.mdx
- LiveLingo, benchmark 2026: https://www.livelingo.io/research/benchmark-2026 y https://www.livelingo.io/guides/openai-live-translation
- Foro de OpenAI, "Gpt-realtime-translate bugs & feedback": https://community.openai.com/t/gpt-realtime-translate-bugs-feedback/1385739
- Xue, Ouyang, Li, "A Practical Evaluation Method for Long-Form Simultaneous Speech-to-Speech Translation", IWSLT 2026: https://aclanthology.org/2026.iwslt-1.3/ · https://arxiv.org/abs/2606.15059
- Zheng et al., "Fluent and Low-latency Simultaneous Speech-to-Speech Translation with Self-adaptive Training", 2020: https://arxiv.org/abs/2010.10048
- NaturalFlow, 2026: https://arxiv.org/abs/2606.13121
- CLASI, 2024: https://arxiv.org/abs/2407.21646
- Seed LiveInterpret 2.0, 2025: https://arxiv.org/abs/2507.17527 · https://seed.bytedance.com/en/blog/seed-liveinterpret-2-0-released-an-end-to-end-simultaneous-interpretation-model-featuring-ultra-high-accuracy-close-to-human-interpreters-low-latency-of-3-seconds-and-real-time-voice-cloning
- Hibiki, 2025: https://arxiv.org/abs/2502.03382 · https://github.com/kyutai-labs/hibiki
- Hibiki-Zero, ICML 2026: https://arxiv.org/abs/2602.11072 · https://github.com/kyutai-labs/hibiki-zero
- SeamlessStreaming: https://arxiv.org/abs/2312.05187 · https://github.com/facebookresearch/seamless_communication
- StreamSpeech: https://arxiv.org/abs/2406.03049 · https://github.com/ictnlp/StreamSpeech · NAST-S2x: https://github.com/ictnlp/NAST-S2x
- SimulStreaming (IWSLT 2025): https://aclanthology.org/2025.iwslt-1.41.pdf · https://github.com/ufal/SimulStreaming
- AlignAtt4LLM (IWSLT 2026): https://arxiv.org/abs/2606.03967 · DOA: https://arxiv.org/abs/2605.31432
- Simulstream toolkit: https://arxiv.org/abs/2512.17648 · https://github.com/azziko/simulstream
- SimultanAI: https://github.com/fairflai/SimultanAI
- church-translator: https://github.com/ShevAlx/church-translator
- simple-sermon-translator: https://github.com/JVictor-Silva93/simple-sermon-translator
- LiveChurchTranslation: https://github.com/shuoyanjerry/LiveChurchTranslation · sermon-live: https://github.com/hesekkim/sermon-live
- WhisperLiveKit: https://github.com/QuentinFuxa/WhisperLiveKit
- LiveKit agents, pedido de traducción sin turnos: https://github.com/livekit/agents/issues/3860
- Palabra.ai: https://www.palabra.ai/voice-translation-api
