# Voz con OpenAI y referencias de mercado (Glossa y LiveVoice)

Fecha: octubre de 2026. Fuentes al final. Las páginas de Glossa y LiveVoice se
consultaron a través de resúmenes de buscador y terceros porque el entorno de
trabajo no llega a sus dominios; las cifras de precios deben confirmarse en sus
sitios antes de usarlas en una decisión comercial.

## 1. Posibilidades de voz con OpenAI

Hay cuatro caminos. Solo dos sirven para una prédica continua.

### 1.1 gpt-realtime-translate: voz adaptativa, sin control

Es el motor que estamos probando. Su documentación es explícita:

- "This model does not currently support custom prompting or voice selection parameters."
- "Realtime Translation uses dynamic voice adaptation. Instead of selecting a fixed output voice, translated speech follows the source speaker's general tone, pitch, and speaking style."
- "In a multi-speaker session, the translated voice will change as new speaker audio comes in."
- "The model does not currently support custom prompts, glossaries, or pronunciation guides."

Qué significa para la iglesia:

| Aspecto | Consecuencia |
|---|---|
| Parecido al pastor | La voz en inglés sigue el tono, el timbre y el ritmo del pastor sin configurar nada. No es clonación: es una voz sintética que se adapta. La documentación nombra tono y altura; no afirma nada sobre género. |
| Control | Ninguno. No se puede elegir una voz neutra, fijar una voz por iglesia, ni corregirla si suena rara. |
| Varios hablantes | La voz cambia cuando cambia quien habla (pastor, líder de alabanza, anuncios). Es natural, pero hay que probar que el cambio no suene a fallo. |
| Vocabulario | Sin glosario ni guía de pronunciación. Nombres y citas bíblicas dependen del modelo. La guía reconoce que "can sometimes substitute incorrect names or entities". |
| Mismo idioma | Si el pastor dice una frase en inglés, el modelo tiende a callar. La guía recomienda dejar pasar el audio original atenuado en vez de silenciarlo. |

Gemini 3.5 Live Translate sigue la misma filosofía: conserva entonación, ritmo
y altura del hablante. Terceros reportan que la voz puede derivar tras pausas
largas, asignar mal el género o quedarse en una sola voz cuando hablan varios.

Para el MVP esto es una ventaja: cero configuración y una voz que recuerda al
pastor. El riesgo se mide con la rúbrica de naturalidad: pedir a los
evaluadores que anoten si la voz "suena a él", si se mantiene estable durante
60 minutos y qué pasa cuando cambia el hablante.

### 1.2 Cascada con texto a voz: control total de la voz

Si se construye la cascada propia (reconocimiento en streaming → traducción →
texto a voz), la voz pasa a ser una decisión de producto:

- `gpt-4o-mini-tts` ofrece 13 voces: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin y cedar. OpenAI recomienda marin y cedar.
- El parámetro `instructions` dirige la entrega en lenguaje natural: "habla como un pastor dirigiéndose a la congregación, con calidez y energía". Se puede cambiar por segmento, por ejemplo subiendo la energía cuando el audio original está fuerte.
- Salida en streaming en PCM u Opus, más de 50 idiomas, costo aproximado de 0,015 USD por minuto generado.

Ventajas: una voz fija por iglesia, independiente del hablante, con glosario y
pronunciación controlados en la etapa de traducción. Desventajas: hay que
construir y afinar tres etapas, y el retraso depende de la segmentación. Es el
plan B si ninguno de los dos motores voz a voz cumple el umbral de latencia o
la calidad bíblica, y es el único camino hacia la voz propia del pastor.

### 1.3 Voz propia del pastor: custom voices de OpenAI u otro proveedor

OpenAI tiene custom voices en su API: se sube una grabación de consentimiento
con una frase exacta ("I am the owner of this voice and I consent to OpenAI
using this voice to create a synthetic voice model", con versiones en otros
idiomas), luego una muestra de audio, y se obtiene un identificador de voz
usable en texto a voz, en el Realtime API y en Chat Completions con audio.
Limitaciones: está "limited to eligible customers", es decir, hay que
solicitarlo; y no aplica a gpt-realtime-translate, que no acepta voz.

Alternativas que sí están abiertas: ElevenLabs permite clonación instantánea
con 1 a 2 minutos de audio desde su plan de 6 USD al mes, con declaración de
consentimiento, y su modelo Flash v2.5 responde en unos 75 ms de latencia de
modelo, con 32 idiomas incluidos español e inglés, a unos 0,05 USD por mil
caracteres. Azure ofrece personal voice con un proceso similar.

Conclusión: **la voz propia del pastor implica la arquitectura en cascada**.
No existe hoy un motor voz a voz de baja latencia que acepte una voz clonada.
Glossa la vende como función premium, lo que confirma que hay demanda y que
se puede cobrar por ella.

### 1.4 gpt-realtime-2 con prompt de traducción: descartado para prédicas

Tiene voces seleccionables (marin, cedar y ocho más) y acepta instrucciones,
pero es un modelo conversacional por turnos: "the speaker needs to pause to
let the translation catch up" y "may still answer questions or follow
instructions rather than translate them". Sirve para conversaciones, no para
un predicador que habla 45 minutos seguidos.

### 1.5 Recomendación de voz para el MVP

1. Mantener la voz adaptativa de gpt-realtime-translate en la prueba. Es gratis en esfuerzo y probablemente la que más gusta en una iglesia, porque recuerda al pastor.
2. Agregar a la rúbrica dos preguntas: "¿suena como el pastor?" y "¿la voz cambió de forma que distrajera?".
3. Dejar la voz propia del pastor como función de segunda versión, ligada a la cascada, con consentimiento grabado como requisito operativo.
4. Si se construye la cascada, ofrecer a cada iglesia una voz fija de la lista de OpenAI con instrucciones de estilo, y la voz clonada como nivel superior.

## 2. Referencias de mercado

### 2.1 Glossa (glossa.live)

Producto nativo de IA para iglesias. Lo que se pudo confirmar:

| Aspecto | Glossa |
|---|---|
| Instalación | Laptop con navegador conectada al audio existente de la iglesia. Anuncian "listo en menos de 10 segundos". |
| Entrada del oyente | Código QR que abre un enlace en el navegador del celular, sin app obligatoria, aunque tienen apps en iOS y Android. Se elige idioma y se escucha audio o se leen subtítulos. |
| Idiomas | 100+ según la portada, 80+ en la página de servicios. |
| Voz | Clonación de la voz del pastor en los planes Advanced y Premium: "hear the sermon in your language, but in your pastor's voice". Generan el audio en sus propios servidores. |
| Calidad | Afirman un motor "biblically-trained" que distingue "grace" en uso cotidiano y bíblico. No publican mediciones. |
| Latencia | "Ultra-low latency", sin cifras. Una reseña: "Translation is almost immediate and the voice is very real, not robotic". |
| Pantallas | Subtítulos a pantallas vía fuente de navegador o página embebida para ProPresenter, OBS y vMix. |
| Música | "Silence, songs and music are not counted toward translation hours": detectan alabanza y silencio y no los cobran. |
| Precio | 5 USD por hora de traducción por idioma a demanda; 99 USD al mes por 25 horas; 299 USD por 100 horas con clonación de voz, integraciones y marca propia; 499 USD por 250 horas. Sin cargo por número de oyentes. |
| Reseñas | App Store 5,0 con 2 valoraciones; pocas reseñas públicas, positivas. |

### 2.2 LiveVoice (livevoice.io, Salzburgo)

Nació como plataforma de audio en vivo para intérpretes humanos, conferencias
silenciosas y visitas guiadas, y añadió traducción por IA.

| Aspecto | LiveVoice |
|---|---|
| Base | Distribución de audio en vivo por la nube con latencia media de 0,2 s y 0,06 Mbit/s por oyente (unos 25 MB por hora). Afirman que 150 oyentes caben en un Wi-Fi de 10 Mb. Recomiendan cable para el emisor. |
| Entrada del oyente | App o navegador, mediante enlace, QR o código de 6 dígitos. Canales por idioma. |
| Humano + IA | Un intérprete humano y la IA conviven en el mismo evento, conmutables por canal. Funciones de intérprete: relé, silenciar, traspaso de hablante, audio de sala automático. |
| Latencia de la IA | No publican cifra. |
| Eventos híbridos | Canal con retardo para sincronizar público presencial y en línea. Grabación, estadísticas, marca propia. |
| Idiomas | 70+ desde septiembre de 2026. |
| Precio | Planes por número de participantes simultáneos: LIGHT 10 USD, SMART 16 USD y PRO 32 USD al mes. Prueba gratis con hasta 3 oyentes. La IA es un extra por minuto: 0,52 USD por minuto por idioma de voz y texto, unos 31 USD por hora, y 0,21 USD por minuto para subtítulos. 20 minutos de IA gratis. Condiciones especiales para iglesias y ONG. |
| Informe | Publicaron en junio de 2026 un informe sobre adopción de IA en iglesias: la tendencia es un modelo híbrido que combina IA con intérpretes voluntarios y profesionales. |

### 2.3 Qué aprender de ellos para el MVP

Lo que los dos confirman como estándar del mercado:

1. **Entrar en segundos, sin app ni cuenta.** QR, enlace o código corto, navegador del celular, elegir idioma. Es exactamente nuestro diseño. Hay que cumplirlo en menos de 5 segundos.
2. **Cobro por hora de traducción por idioma, sin cargo por oyente.** Coincide con nuestra arquitectura de una traducción por servicio. Glossa cobra 4 a 5 USD por hora; LiveVoice 31 USD por hora de IA más el plan base. Nuestro costo de motor es de unos 2 USD por hora y la distribución menos de 1 USD por hora por cien oyentes. Hay margen.
3. **Subtítulos como salida de primera clase**, en el celular y en pantallas. Los motores ya nos devuelven el texto; el costo de ofrecerlo es bajo. La salida a ProPresenter y OBS es una URL que muestra el texto.

Lo que vale la pena copiar y no teníamos:

4. **Audio de sala de fondo.** LiveVoice lo llama "automatic floor audio". El oyente oye el original atenuado debajo de la traducción, o al menos durante música y silencios. Resuelve el caso en que el motor calla porque el pastor dijo algo en inglés, y hace que la experiencia no sea "silencio y luego una voz". Añadir al reproductor un control "solo traducción / mezcla".
5. **Detección de música y silencio, y no cobrarlos.** Glossa lo hace. En el MVP basta un botón de pausa en la consola del emisor; después, detección automática.
6. **Canales híbridos: humano o IA por idioma.** Es el diferencial de LiveVoice y responde a una realidad: muchas iglesias ya tienen un voluntario que traduce un idioma. Diseñar el modelo de canal de modo que la fuente de un idioma pueda ser el motor de IA o el micrófono de una persona con su celular. No construirlo ahora; no cerrarse la puerta.
7. **Voz del pastor como nivel premium.** Glossa lo cobra en su plan de 299 USD. Implica cascada y consentimiento grabado.
8. **Publicar consumo de datos.** LiveVoice presume 25 MB por hora por oyente. Con Opus a 24 a 32 kbps estamos en 11 a 14 MB por hora. Hay que medirlo y decirlo, porque la gente escucha con datos móviles.
9. **Prueba gratuita con fricción mínima.** LiveVoice: 3 oyentes gratis y 20 minutos de IA. Glossa: 5 USD por hora sin plan. Para la fase comercial, un primer servicio gratis por iglesia.
10. **Operación de la sala.** Grabación del servicio, contador de oyentes conectados, traspaso de hablante, silenciar. Son funciones de consola pequeñas que dan confianza al equipo de sonido.
11. **Canal con retardo** para iglesias que también transmiten en línea. Fase posterior.

Dónde ninguno de los dos es fuerte, y por tanto dónde podemos diferenciarnos:

- **Ninguno publica latencia medida.** Nosotros ya tenemos un banco que la mide frase a frase. Un reporte de latencia y calidad por servicio es un argumento comercial que ellos no tienen.
- **Ninguno deja elegir motor ni muestra cómo lo evalúa.** Nuestra interfaz de motores permite cambiar de proveedor sin tocar el producto.
- **La IA de LiveVoice es cara** y Glossa es un producto estadounidense en inglés. Un producto pensado desde Latinoamérica, en español, con precio local, tiene espacio.
- **Modo de red local.** Ninguno lo tiene. Un servidor en la iglesia que reparta por el Wi-Fi local quitaría la dependencia de internet para los oyentes. Es una idea de tercera versión, no del MVP.

### 2.4 Cambios concretos que esto sugiere en nuestro plan

| Cambio | Cuándo |
|---|---|
| Añadir a la rúbrica las preguntas sobre parecido de voz y cambios de voz | Ahora, en `docs/rubrica-evaluacion.md` |
| Botón de pausa para alabanza en la consola del emisor | Prototipo en vivo |
| Mezcla de audio original atenuado en el reproductor del oyente | Prototipo en vivo |
| Subtítulos en la página del oyente | Prototipo en vivo |
| Contador de oyentes y grabación del servicio | Prototipo en vivo, versión mínima |
| Modelo de canal con fuente IA o humana | Diseño del producto, no del MVP |
| Voz propia del pastor vía cascada y consentimiento | Segunda versión |
| Salida de subtítulos a ProPresenter y OBS | Segunda versión |
| Detección automática de música | Segunda versión |

## Fuentes

- OpenAI cookbook, "Build Live Translation Apps with gpt-realtime-translate": https://github.com/openai/openai-cookbook/blob/main/examples/voice_solutions/realtime_translation_guide.mdx
- OpenAI, custom voices: https://developers.openai.com/api/docs/guides/custom-voices y referencia de consentimiento https://platform.openai.com/docs/api-reference/audio/createVoiceConsent
- OpenAI, modelo gpt-4o-mini-tts: https://developers.openai.com/api/docs/models/gpt-4o-mini-tts
- Resumen de precios de voz de OpenAI: https://tokencost.app/blog/openai-gpt-realtime-2-voice-pricing
- Google, Gemini 3.5 Live Translate: https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-live-3-5-translate/ y análisis de limitaciones https://www.livelingo.io/guides/gemini-3-5-live-translate
- ElevenLabs, clonación y Flash v2.5: https://elevenlabs.io/text-to-speech-api y https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/elevenlabs-pricing-voice-cloning-no-fakes-act
- Glossa: https://glossa.live/ , https://glossa.live/services , https://glossa.live/blog/affordable-church-translation , comparación de terceros https://voco.church/compare/voco-vs-glossa , App Store https://apps.apple.com/us/app/glossa-ai-church-translation/id6759844333
- LiveVoice: https://livevoice.io/en/use-cases/churches , https://livevoice.io/en/ai-translation , https://livevoice.io/en/pricing , https://livevoice.io/en/help/article/pricing-info , especificaciones https://help.livevoice.io/article/116-tech-specs , informe de junio de 2026 https://finance.yahoo.com/sectors/technology/articles/livevoice-releases-industry-report-growing-181000131.html , expansión a 70 idiomas https://www.globenewswire.com/news-release/2026/09/24/3368786/0/en/livevoice-expands-translation-to-70-languages-delivering-live-translation-for-churches-worldwide.html
