# Banco de pruebas: comparación de motores de traducción en vivo

Objetivo de esta etapa: decidir, con material real de la iglesia, cuál motor
ofrece la mejor experiencia para una predicación en vivo (español → inglés).
Se mide calidad, naturalidad, retraso y estabilidad con **el mismo audio** en
los dos motores.

Motores incluidos:

| Motor | Modelo | Entrada | Salida | Notas |
|---|---|---|---|---|
| `openai` | `gpt-realtime-translate` | PCM16 24 kHz | PCM16 24 kHz | Endpoint dedicado de traducción. Sin prompt ni elección de voz: la voz imita el tono del hablante. Sesión máx. 60 min; el adaptador rota a una sesión nueva a los 50 min buscando un silencio. |
| `gemini` | `gemini-3.5-live-translate-preview` | PCM16 16 kHz | PCM16 24 kHz | Preview pública. La conexión dura ~10 min; el servidor avisa con `goAway` y el adaptador reconecta con el handle de reanudación. Compresión de contexto activada para sesiones largas. |
| `mock` | ninguno | 16 kHz | 24 kHz | Devuelve el mismo audio con un retraso fijo. Para probar el banco sin claves. |

Los adaptadores se escribieron a partir de la documentación oficial vigente
(cookbook de OpenAI y guía de Live Translate de Google) pero **no se han
ejecutado todavía contra las APIs reales desde este entorno**. La primera
corrida debe ser un fragmento de 2 minutos para confirmar que ambos responden;
cualquier mensaje del protocolo queda registrado en `eventos.jsonl` para
diagnosticar.

## Requisitos

- Node 22 o superior.
- ffmpeg instalado (`ffmpeg -version`). Se usa para leer mp3/m4a, cambiar la tasa
  de muestreo con buen filtrado, partir audio para la transcripción de
  referencia y generar mp3 de escucha.
- Claves en `.env` (copiar `.env.example`): `OPENAI_API_KEY` y `GEMINI_API_KEY`.

```bash
npm install
npm test              # suite rápida, incluye una corrida de punta a punta con el motor simulado
npm run bench -- help
```

## Comandos

### 0. Probar el banco sin claves

```bash
npm run bench -- synth --out samples/sintetico.wav --seconds 60
npm run bench -- run --engine mock --input samples/sintetico.wav --opts '{"delayMs":1500}'
```

El resumen debe reportar un retraso de 1,50 s. Eso valida que la medición
funciona antes de gastar un minuto de API.

### 1. Preparar el material

```bash
# Fragmento de 2 minutos para la primera prueba de conexión
npm run bench -- prepare --input grabaciones/sermon1.mp3 --out samples/sermon1-2min.wav --max-minutes 2
# Fragmento de 15 minutos para la comparación
npm run bench -- prepare --input grabaciones/sermon1.mp3 --out samples/sermon1-15min.wav --start-sec 300 --max-minutes 15
# Prédica completa
npm run bench -- prepare --input grabaciones/sermon1.mp3 --out samples/sermon1.wav
```

`run` acepta directamente mp3 o m4a; `prepare` es útil para recortar y para
reutilizar el mismo WAV exacto en varias corridas.

### 2. Correr los dos motores con el mismo audio, a la vez

```bash
npm run bench -- run --engine openai,gemini --input samples/sermon1-15min.wav --label sermon1 --mp3
```

Los dos motores reciben los mismos fragmentos de 100 ms en los mismos
instantes, así que la comparación es justa y la corrida tarda lo que dura el
audio. Se crea `runs/sermon1-openai/` y `runs/sermon1-gemini/` más
`runs/sermon1-reporte.md` con la tabla comparativa.

Opciones útiles:

- `--max-minutes 2` para la prueba de conexión.
- `--source es` pasa una pista de idioma de entrada. Probar primero sin ella.
- `--opts '{"gemini":{"echoTargetLanguage":false},"openai":{"noiseReduction":"far_field"}}'`
  cambia opciones de cada adaptador. `extra` dentro de las opciones se fusiona
  en el payload de configuración del proveedor, por si hay que probar un campo
  nuevo sin tocar código.
- Ctrl+C termina antes y guarda todo lo recibido hasta ese momento.

### 3. Referencia y juez automático

```bash
npm run bench -- transcribe --input samples/sermon1-15min.wav --language es
npm run bench -- judge --run runs/sermon1-openai --reference samples/sermon1-15min.referencia.json
npm run bench -- judge --run runs/sermon1-gemini --reference samples/sermon1-15min.referencia.json
npm run bench -- report runs/sermon1-openai runs/sermon1-gemini --out runs/sermon1-reporte.md
```

`transcribe` genera la transcripción del original con tiempos por segmento
(whisper-1). `judge` usa un modelo de lenguaje para alinear cada frase
traducida con los segmentos originales, calificar el significado de 1 a 5,
etiquetar errores y calcular el retraso exacto "frase dicha → frase
escuchada". El modelo del juez se configura con `JUDGE_MODEL` o `--model`.

El juez es un apoyo para cubrir la prédica completa. La decisión la toman los
evaluadores humanos.

## Validación de interpretación continua con OpenAI

Pregunta a responder: **¿puede gpt-realtime-translate sostener una
interpretación simultánea real, correcta y estable durante una predicación
continua, quedando idealmente 2 a 3 segundos detrás del pastor?**

Qué hace y qué no hace el banco en esta prueba:

- Envía el audio al motor de forma continua, en fragmentos de 100 ms, exactamente
  al ritmo real, incluido el silencio entre palabras. No espera pausas, no
  agrupa frases ni corta nada.
- Reproduce la salida tal como llega. No retiene audio para "sincronizar" ni
  descarta nada para "alcanzar". La única espera artificial es al final del
  archivo, para dejar que el modelo termine la última frase.
- El umbral de 3 s solo se usa para el veredicto. No hay ninguna regla que
  fuerce al modelo a cortar frases.

Material: una prédica real densa, de 10 a 15 minutos, sin pausas largas, y
después la completa de 60 minutos. Como control repetible existe
`docs/lectura-continua.txt`, un texto de prédica leído con voz sintética sin
pausas artificiales, que además entrega los tiempos exactos de cada frase sin
pasar por whisper.

```bash
# Prédica real (el juez necesita la transcripción de referencia del original)
npm run bench -- run --engine openai --input samples/sermon1-15min.wav --label continua-real --mp3
npm run bench -- transcribe --input samples/sermon1-15min.wav --language es
npm run bench -- judge --run runs/continua-real-openai --reference samples/sermon1-15min.referencia.json

# Lectura continua sintética (tiempos exactos; no necesita transcribe)
npm run bench -- phrases --text docs/lectura-continua.txt --out samples/continua.wav
npm run bench -- run --engine openai --input samples/continua.wav --label continua
npm run bench -- judge --run runs/continua-openai --manifest samples/continua.manifest.json
```

Cómo responde el banco a cada pregunta:

| Pregunta | Dónde mirar | Qué esperar de una interpretación simultánea |
|---|---|---|
| ¿Empieza a traducir mientras el pastor sigue hablando? | `resumen.md` → Continuidad → *Simultaneidad* (% del habla traducida que suena mientras la fuente habla) y `juez.md` → *frases oídas antes de que el pastor terminara* | Simultaneidad muy por encima del 50 %; una traducción consecutiva daría cerca de 0 %. En tramos largos sin pausa, el primer audio traducido debe llegar en pocos segundos, no al final del tramo. |
| ¿Cuánto retraso percibe el oyente durante minutos continuos? | `juez.md` → *Retraso percibido*: inicio→inicio y fin→fin, mediana y p90; `retraso_percibido.svg` y `retraso_continuo.csv` | Mediana entre 2 y 3 s; p90 por debajo de 4,5 s; menos del 10 % del tiempo de escucha por encima de 3 s. |
| ¿Se mantiene estable o se acumula? | `juez.md` → *Deriva* (pendiente y mediana por ventanas de 5 min); `resumen.md` → Deriva; la línea naranja de la gráfica | Pendiente cercana a 0 s cada 10 min; las ventanas no deben subir de forma sostenida. Si el atraso acumulado sube y baja, el modelo se está saltando contenido para alcanzar. |
| ¿Hay saltos, silencios u omisiones? | `juez.md` → *Saltos* y *Original sin traducir*; `resumen.md` → Continuidad → *silencios ≥ 3 s* y *mayor hueco* en tramos largos | Cero silencios de 3 s con el pastor hablando; cobertura de los tramos largos cerca del 100 %; omisiones solo de muletillas. |
| ¿La calidad se mantiene cuando va rápido? | `juez.md` → *Calidad según el retraso de llegada* y frases con puntaje 1 o 2 | Puntaje medio ≥ 4 en todas las franjas de retraso, sin caída en la de ≤ 2 s. Un modelo que acelera recortando se nota como fragmentos y omisiones. |

Lectura de la gráfica `retraso_percibido.svg`: la línea azul es el retraso
medido al empezar y al terminar de oír cada frase; la línea naranja es el
atraso acumulado segundo a segundo, que sube mientras el oyente espera y baja
cuando la traducción avanza; la línea punteada es el umbral. Los puntos grandes
son frases por encima del umbral.

## Latencia como criterio de aprobación

El umbral del MVP es **3 segundos** de retraso percibido por el oyente. Una
traducción sostenida por encima de eso no cumple, aunque la calidad sea buena.
El umbral se cambia con `--max-lag-sec` en `run` y en `judge`.

El sistema en vivo suma entre 0,4 y 0,7 s a lo que mide el banco (distribución
WebRTC, red del celular y buffer del reproductor). Para cumplir 3 s en la
iglesia, un motor debe quedar por debajo de unos 2,5 s aquí.

Hay tres mediciones, de la más rápida a la más exacta:

1. **Retraso fin de frase (heurístico).** Sale de `run` sin nada más. En cada
   pausa del predicador mide cuánto tarda en terminar la frase traducida.
   Veredicto: `cumple` si la mediana está bajo el umbral y el p90 bajo 1,5
   veces el umbral; `al límite` si solo la mediana cumple; `no cumple` si la
   mediana lo supera.
2. **Frases interactivas.** Una prueba específica para los momentos cortos
   donde 4 o 5 segundos rompen la experiencia: "¡aplaudan!", "repitan
   conmigo", preguntas, instrucciones. Cada frase está aislada por silencios
   largos, así que su traducción se identifica sin ambigüedad y se mide
   exacto: **desde que el pastor termina de decirla hasta que el oyente
   termina de oírla**, y también hasta que empieza a oírla. Veredicto:
   `cumple` si al menos el 90 % de las frases terminan de oírse dentro del
   umbral; `al límite` desde el 70 %; `no cumple` por debajo. Una frase sin
   traducción cuenta como fallida.
3. **Retraso percibido (juez).** `judge` transcribe el audio traducido con
   whisper, proyecta cada frase oída a la línea de tiempo del oyente con la
   tabla de fragmentos de `eventos.jsonl`, la alinea con la frase original y
   obtiene dos cifras por frase: inicio dicho → inicio oído, y fin dicho → fin
   oído. De ahí sale la curva completa `retraso_percibido.csv` y dos
   indicadores de "sostenido": la fracción del tiempo de escucha con retraso
   por encima del umbral y el tramo continuo más largo por encima. Veredicto:
   `cumple` con ≤ 10 % del tiempo y tramo ≤ 20 s; `al límite` hasta 25 %;
   `no cumple` por encima.

El reporte comparativo muestra los tres veredictos y un **veredicto global**
que es el peor de ellos.

### Prueba interactiva con voz sintética (repetible)

```bash
npm run bench -- phrases --phrases docs/frases-interactivas.txt --out samples/interactivas.wav --gap-sec 6
npm run bench -- run --engine openai,gemini --input samples/interactivas.wav --manifest samples/interactivas.manifest.json --label interactivas
```

`phrases` genera cada frase del guion con voz sintética, las separa con 6 s de
silencio y escribe un manifiesto con el instante exacto en que empieza y
termina cada una. `run` imprime una línea por frase: estado, retraso hasta que
empieza a oírse, retraso hasta que termina, y el texto que se oyó. El guion se
puede editar; es un archivo de texto con una frase por línea.

### Prueba interactiva con la voz real del pastor

Grabar el mismo guion dejando al menos 2 segundos de silencio entre frases, y
correr:

```bash
npm run bench -- run --engine openai,gemini --input samples/interactivas-pastor.wav --phrases docs/frases-interactivas.txt --label interactivas-pastor
```

Las frases se detectan por los silencios y se emparejan en orden con el guion.
Si el número detectado no coincide, el banco lo avisa.

### Qué esperar de cada motor

Las mediciones independientes publicadas a mitad de 2026 dan ~0,7 s hasta el
primer audio en OpenAI y ~2,9 s en Gemini. El primer audio no es el retraso
percibido: la frase completa llega después. Es probable que Gemini quede fuera
del umbral en las frases interactivas y que OpenAI quede dentro. Si ninguno
cumple, el siguiente candidato es una cascada propia (reconocimiento en
streaming, traducción por frases cortas y voz en streaming) donde el retraso se
controla con el tamaño del segmento.

## Qué hay en cada carpeta de corrida

| Archivo | Para qué sirve |
|---|---|
| `comparacion.wav` / `.mp3` | Estéreo: izquierda el original, derecha la traducción **tal como la oiría un oyente**, alineada en el tiempo. Es el archivo para juzgar retraso y calidad. Con audífonos se puede ir alternando canales. |
| `traduccion_cruda.wav` / `.mp3` | Solo la traducción, sin los silencios. Para juzgar naturalidad de la voz. |
| `transcripcion_traduccion.txt` | Texto traducido que devolvió el motor (los subtítulos). |
| `transcripcion_original.txt` | Transcripción del original que devolvió el motor, si la entrega. |
| `transcripcion_traduccion.jsonl` | Subtítulos con tiempo de llegada; lo usa `judge`. |
| `resumen.md` | Lectura humana de las métricas. |
| `metricas.json` | Todas las cifras, para el reporte. |
| `eventos.jsonl` | Registro completo: cada fragmento de audio, cada texto, cada mensaje del protocolo. Para depurar. |
| `corrida.json` | Configuración con la que se corrió. |
| `juez.md` / `juez.json` | Resultado del juez automático, si se corrió: calidad y retraso percibido. |
| `retraso_percibido.csv` | Retraso percibido frase a frase (segundo de escucha, retraso). |
| `retraso_continuo.csv` | Atraso acumulado segundo a segundo. |
| `retraso_percibido.svg` | Gráfica de las dos curvas con el umbral. Se abre en el navegador. |

## Cómo leer las métricas

- **Criterio de latencia**: veredicto contra el umbral, ver la sección anterior.
- **Primer audio traducido**: tiempo desde que la fuente empieza a hablar hasta el primer sonido traducido.
- **Fin de frase → fin de traducción**: la métrica principal de retraso. En cada pausa natural del predicador (≥ 0,7 s) se mide cuánto tarda en terminar la frase traducida correspondiente. Se reportan mediana, p90 y p95, y cuántas frases se pudieron emparejar. Es lo que siente el oyente: "él ya terminó, yo todavía estoy escuchando".
- **Inicio de frase → inicio de traducción**: cuánto espera el oyente desde que el pastor arranca una frase hasta que empieza a oírla.
- **Deriva**: pendiente del retraso a lo largo del tiempo, en segundos ganados cada 10 minutos, y mediana por ventanas de 5 minutos. Debe ser ~0. Si crece, el motor no sigue el ritmo.
- **Retraso al final**: cuánto siguió hablando la traducción después de que la fuente terminó.
- **Cola máxima del reproductor**: si el motor emite audio más rápido que tiempo real, se acumula en la cola; un valor alto significa ráfagas y silencio después.
- **Relación habla traducción/original**: mayor que 1 significa que la traducción habla más tiempo que el pastor y acabará atrasándose si no hay pausas.
- **Atascos**: silencios de más de 5 s en la traducción mientras la fuente hablaba, descontando el retraso normal.
- **Estabilidad**: reconexiones, rotaciones de sesión, cierres inesperados, errores y audio descartado durante reconexiones. En una prédica de 60 minutos se espera 1 rotación en OpenAI y unas 6 reanudaciones en Gemini; lo que importa es que no se pierda audio ni se note.

Los retrasos por frase salen de un detector de voz por energía y de un
emparejamiento en orden entre pausas del original y pausas de la traducción.
Es una heurística: un motor que une o parte frases desplaza un emparejamiento,
pero la mediana sobre decenas de frases es estable. El juez da la cifra exacta
frase a frase.

## Protocolo de evaluación con personas

1. Elegir 3 a 5 fragmentos de 10 a 15 minutos de distintos sermones, más una prédica completa.
2. Correr `run --engine openai,gemini` sobre cada uno.
3. Entregar a cada evaluador, por fragmento y motor, el `comparacion.mp3` y el `traduccion_cruda.mp3`, sin decirle qué motor es cuál (renombrar A y B).
4. Cada evaluador llena `docs/plantilla-evaluacion.csv` siguiendo `docs/rubrica-evaluacion.md`.
5. Promediar por motor y llevar los promedios a la tabla del reporte.
6. Escuchar juntos las frases que el juez marcó con 1 o 2 y las que los evaluadores señalaron. Ahí se ve lo que los promedios esconden: nombres, citas, números, frases saltadas.

## Criterios de aprobación (propuestos)

| Dimensión | Umbral |
|---|---|
| Precisión (evaluadores) | Promedio ≥ 4 de 5 y ninguna cita bíblica con el sentido invertido |
| Naturalidad (evaluadores) | Promedio ≥ 3,5 de 5 |
| Retraso percibido (juez) | ≤ 10 % del tiempo de escucha por encima de 3 s; tramo más largo ≤ 20 s |
| Frases interactivas | ≥ 90 % de las frases terminan de oírse en ≤ 3 s tras ser dichas |
| Retraso fin de frase | Mediana ≤ 3 s y p90 ≤ 4,5 s |
| Deriva | < 1 s de aumento en 60 min |
| Estabilidad | Cero atascos en 60 min; rotaciones y reanudaciones inaudibles |
| Experiencia | Los evaluadores lo usarían en lugar de un intérprete humano |

## Costos aproximados por hora de audio

| Concepto | Costo |
|---|---|
| OpenAI gpt-realtime-translate | ≈ 2,05 USD |
| Gemini 3.5 Live Translate | 0 USD en preview; después ≈ 2,20 USD |
| Transcripción de referencia (whisper-1) | ≈ 0,36 USD |
| Transcripción de la traducción para el retraso percibido | ≈ 0,36 USD por motor |
| Voz sintética para la prueba interactiva | centavos por guion |
| Juez automático | depende del modelo; del orden de centavos a pocos dólares por hora de audio |

Una comparación completa con 5 fragmentos y una prédica entera cuesta menos de
10 USD.
