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
| `juez.md` / `juez.json` | Resultado del juez automático, si se corrió. |

## Cómo leer las métricas

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
| Retraso fin de frase | Mediana ≤ 3 s y p95 ≤ 5 s |
| Deriva | < 1 s de aumento en 60 min |
| Estabilidad | Cero atascos en 60 min; rotaciones y reanudaciones inaudibles |
| Experiencia | Los evaluadores lo usarían en lugar de un intérprete humano |

## Costos aproximados por hora de audio

| Concepto | Costo |
|---|---|
| OpenAI gpt-realtime-translate | ≈ 2,05 USD |
| Gemini 3.5 Live Translate | 0 USD en preview; después ≈ 2,20 USD |
| Transcripción de referencia (whisper-1) | ≈ 0,36 USD |
| Juez automático | depende del modelo; del orden de centavos a pocos dólares por hora de audio |

Una comparación completa con 5 fragmentos y una prédica entera cuesta menos de
10 USD.
