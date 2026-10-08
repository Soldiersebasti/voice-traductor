# Traducción en Vivo para Iglesias — MVP

> **Documentación de proyecto (empezar aquí):** [`PROJECT_STATUS.md`](PROJECT_STATUS.md) (estado actual y siguiente paso; sección "START HERE FOR AI") · [`PROJECT_CONTRACT.md`](PROJECT_CONTRACT.md) (contrato técnico y reglas de trabajo) · [`DECISIONS.md`](DECISIONS.md) (decisiones arquitectónicas) · [`BITACORA.md`](BITACORA.md) (registro cronológico, append-only) · [`INFRAESTRUCTURA.md`](INFRAESTRUCTURA.md) (cuentas, VPS, claves, seguridad).
>
> Desde el 2026-10-08 este repositorio es el **laboratorio** de Voice Traductor (banco de pruebas, juez, diagnóstico). El producto se construye sobre [`google-gemini/gemini-live-translate-livekit`](https://github.com/google-gemini/gemini-live-translate-livekit) en un repositorio aparte (ver `DECISIONS.md` ADR-001). El texto que sigue es la visión original del MVP y sigue vigente como descripción del problema; el objetivo actual aprobado es solo **Español → Inglés** (ADR-007).

## Idea

Crear un sistema de **traducción de voz en tiempo real para iglesias**, pensado para eliminar la dependencia de una persona que tenga que traducir manualmente cada servicio.

El objetivo es que mientras un pastor o predicador habla, por ejemplo en español, una persona que necesite escucharlo en inglés pueda entrar desde su celular y **escuchar la traducción en vivo con el menor retraso posible**.

Inicialmente:

**Español → Inglés**  
**Inglés → Español**

El proyecto debe diseñarse pensando en que posteriormente pueda ofrecerse como un servicio para múltiples iglesias.

---

## Problema actual

Cuando una iglesia recibe personas que hablan otro idioma, normalmente necesita:

- Una persona traduciendo en vivo.
- Equipos o receptores especiales.
- Una persona disponible durante todo el servicio.
- Una traducción independiente cada vez que se necesita el servicio.

Esto genera dependencia humana y dificulta escalar la traducción a más personas o más iglesias.

---

## Concepto principal

Cada iglesia tendría su propio espacio dentro del sistema.

Cuando comienza un servicio:

**Predicador habla → sistema recibe el audio → IA traduce → genera audio traducido → múltiples personas escuchan esa misma traducción desde el dispositivo que conectaron.**

Un requisito importante es que **no debe generarse una traducción independiente por cada oyente**.

Por ejemplo:

Si 100 personas están escuchando la traducción del mismo servicio, debería existir **una sola sesión/proceso de traducción para ese idioma**, y esa salida debería poder distribuirse a todos los oyentes conectados.

---

## Identificación de la iglesia

Cuando una persona llegue a una iglesia, el sistema debe permitir identificar fácilmente qué traducción debe escuchar.

Algunas posibilidades podrían ser:

- Código de la iglesia o del servicio.
- QR mostrado por la iglesia.
- Ubicación/proximidad.
- Otra alternativa más conveniente.

**No se define todavía cuál debe utilizarse.**

Cloud Code deberá analizar cuál alternativa tiene más sentido para el MVP y cuál permite escalar posteriormente.

---

## MVP

La primera versión no pretende construir todavía todo el producto comercial.

La prioridad es comprobar si la experiencia de traducción funciona realmente bien.

El MVP debe permitir hacer una prueba real como esta:

> El pastor está predicando en español en la iglesia.  
> El sistema recibe su voz.  
> Desde otro celular puedo entrar y escuchar esa predicación traducida al inglés prácticamente en vivo.

Queremos evaluar principalmente:

- Calidad de la traducción.
- Naturalidad de la voz.
- Retraso entre la voz original y la traducción.
- Estabilidad durante una predicación prolongada.
- Experiencia de escucha desde un celular.
- Qué ocurre cuando varias personas escuchan simultáneamente.
- Viabilidad de usar una sola traducción y distribuirla a muchos oyentes.

---

## Visión posterior

Si el MVP demuestra que la traducción es suficientemente buena, el sistema debería poder evolucionar hacia una plataforma donde diferentes iglesias puedan registrarse y ofrecer traducción durante sus servicios.

Cada iglesia tendría sus propios datos y sus propias transmisiones, sin que los asistentes de una iglesia terminen escuchando accidentalmente la traducción de otra.

La arquitectura futura debería contemplar la posibilidad de manejar:

- Varias iglesias.
- Varios servicios simultáneos.
- Diferentes cantidades de oyentes.
- Más idiomas en el futuro.

---

## Lo que debe analizar Cloud Code

Este README **no define la arquitectura ni la tecnología que debe utilizarse**.

Cloud Code debe investigar y proponer la mejor forma de conseguir esta experiencia, incluyendo:

- Qué tecnología o servicio de IA ofrece actualmente la mejor alternativa para traducción de voz en tiempo real.
- Cómo capturar y transmitir la voz del predicador.
- Cómo generar la traducción con la menor latencia posible.
- Cómo distribuir una única traducción entre múltiples oyentes.
- Cómo identificar a qué iglesia o servicio pertenece cada usuario.
- Qué arquitectura conviene utilizar para el MVP sin impedir que posteriormente pueda escalarse.

La prioridad de esta primera etapa es sencilla:

**Demostrar que podemos escuchar una predicación traducida por IA, en vivo, con buena calidad y con un retraso suficientemente bajo para que la experiencia sea útil dentro de una iglesia.**

---

## Estado del proyecto

**Etapa actual: validar el núcleo.** Antes de construir producto se está
comparando, con material real de la iglesia, cuál motor de traducción voz a voz
ofrece la mejor experiencia para una predicación en vivo:

- OpenAI `gpt-realtime-translate`
- Google `gemini-3.5-live-translate-preview`
- Alibaba `qwen3.8-livetranslate-flash-realtime` (Model Studio, Singapur; pago por uso; ver `docs/qwen-livetranslate.md`)
- Kyutai `hibiki-zero` (abierto pero con pesos no comerciales; laboratorio, GPU NVIDIA; ver `docs/hibiki-zero.md`)

Para eso existe un banco de pruebas que reproduce sermones grabados en tiempo
real contra los dos motores a la vez y mide calidad, naturalidad, retraso y
estabilidad. Ver [`docs/banco-de-pruebas.md`](docs/banco-de-pruebas.md).

```bash
npm install
npm test
npm run bench -- help
npm run bench -- run --engine openai,gemini --input samples/sermon1.wav --label sermon1 --mp3
npm run bench -- phrases && npm run bench -- run --engine openai,gemini --input samples/interactivas.wav --manifest samples/interactivas.manifest.json --label interactivas
```

La latencia es criterio de aprobación: umbral de 3 s de retraso percibido por el oyente, con una prueba específica de frases cortas interactivas.

Estructura:

- `packages/engines`: interfaz común de motor y adaptadores (`openai`, `gemini`, `qwen`, `hibiki`, `mock`). Es lo que después usará el trabajador en vivo.
- `apps/bench`: el banco de pruebas (`run`, `prepare`, `transcribe`, `judge`, `report`).
- `tools/`: puente en Python entre el banco y `hibiki-zero serve`.
- `docs/`: guía del banco, rúbrica para evaluadores, plantilla de evaluación, análisis de voz y referencias de mercado, estado del arte de interpretación simultánea con latencia baja, y mapa de proveedores y alternativas para probar y comercializar.
- `samples/`: material de prueba (ignorado por git). `runs/`: resultados (ignorado por git).
