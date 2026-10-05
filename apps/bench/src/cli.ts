#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ENGINE_NAMES, isEngineName } from '@voice-traductor/engines';
import { convertToWav, ffmpegAvailable } from './audio-load.js';
import { judgeRun } from './judge.js';
import { loadRun, renderReport } from './report.js';
import { runBench } from './run.js';
import { writeSynthWav } from './synth.js';
import { loadReference, transcribeReference } from './transcribe.js';
import { fmtClock, fmtSec, loadDotEnv } from './util.js';

const HELP = `Banco de pruebas de traducción en vivo

Uso: npm run bench -- <comando> [opciones]

Comandos
  run         Reproduce un audio en tiempo real contra uno o varios motores y guarda audio, textos y métricas.
  synth       Genera un WAV de "habla" sintética para probar el banco sin material real.
  prepare     Convierte una grabación (mp3, m4a, wav...) a WAV mono 16-bit; permite recortar.
  transcribe  Transcripción de referencia del original con tiempos (whisper-1). Necesaria para judge.
  judge       Juez automático: alinea y califica la traducción de una corrida contra la referencia.
  report      Tabla comparativa en markdown a partir de varias corridas.

run
  --engine <openai|gemini|mock|lista,separada,por,comas>   (obligatorio)
  --input <archivo>            audio de la prédica                      (obligatorio)
  --target <idioma>            idioma de salida, por defecto en
  --source <idioma>            pista del idioma de entrada (opcional; los motores detectan solos)
  --out <carpeta>              carpeta de corridas, por defecto runs
  --label <texto>              etiqueta base de la corrida
  --max-minutes <n>            recortar la fuente a n minutos
  --start-sec <n>              empezar en el segundo n
  --chunk-ms <n>               tamaño del fragmento enviado, por defecto 100
  --opts <json>                opciones de motor; plano o {"openai":{...},"gemini":{...}}
  --mp3                        además genera mp3 de los archivos de escucha (requiere ffmpeg)
  --finish-timeout-sec <n>     espera máxima al final, por defecto 20
  --vad-db <n>                 umbral fijo del detector de voz en dBFS (por defecto, automático)

synth      --out <archivo.wav> [--seconds 60] [--rate 16000]
prepare    --input <archivo> --out <archivo.wav> [--rate 24000] [--start-sec n] [--max-minutes n]
transcribe --input <archivo> [--language es] [--out <referencia.json>]
judge      --run <carpeta de corrida> --reference <referencia.json> [--model gpt-5] [--target en]
report     <carpeta1> <carpeta2> ... [--out runs/reporte.md]

Variables de entorno (.env): OPENAI_API_KEY, GEMINI_API_KEY, JUDGE_MODEL
`;

async function main(argv: string[]): Promise<void> {
  loadDotEnv();
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      engine: { type: 'string' },
      input: { type: 'string' },
      target: { type: 'string', default: 'en' },
      source: { type: 'string' },
      out: { type: 'string' },
      label: { type: 'string' },
      'max-minutes': { type: 'string' },
      'start-sec': { type: 'string' },
      'chunk-ms': { type: 'string' },
      opts: { type: 'string' },
      mp3: { type: 'boolean', default: false },
      'finish-timeout-sec': { type: 'string' },
      'vad-db': { type: 'string' },
      seconds: { type: 'string' },
      rate: { type: 'string' },
      language: { type: 'string' },
      run: { type: 'string' },
      reference: { type: 'string' },
      model: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (!command || command === 'help' || values.help) {
    console.log(HELP);
    return;
  }
  const num = (v: string | undefined): number | undefined => (v === undefined ? undefined : Number(v));
  const log = (line: string) => console.log(line);

  switch (command) {
    case 'run': {
      if (!values.engine || !values.input) throw new Error('run necesita --engine y --input');
      const engines = values.engine.split(',').map((s) => s.trim()).filter(Boolean);
      for (const e of engines) if (!isEngineName(e)) throw new Error(`Motor desconocido "${e}". Opciones: ${ENGINE_NAMES.join(', ')}`);
      const controller = new AbortController();
      let interrupts = 0;
      process.on('SIGINT', () => {
        interrupts++;
        if (interrupts === 1) {
          console.log('\nCtrl+C: terminando la corrida y guardando resultados... (otro Ctrl+C sale sin guardar)');
          controller.abort();
        } else process.exit(130);
      });
      const results = await runBench({
        engines,
        input: values.input,
        outDir: values.out ?? 'runs',
        label: values.label,
        targetLanguage: values.target ?? 'en',
        sourceLanguageHint: values.source,
        chunkMs: num(values['chunk-ms']),
        maxMinutes: num(values['max-minutes']),
        startMs: values['start-sec'] ? Number(values['start-sec']) * 1000 : undefined,
        engineOptions: values.opts ? (JSON.parse(values.opts) as Record<string, unknown>) : undefined,
        mp3: values.mp3,
        finishTimeoutMs: values['finish-timeout-sec'] ? Number(values['finish-timeout-sec']) * 1000 : undefined,
        vadThresholdDb: num(values['vad-db']),
        log,
        signal: controller.signal,
      });
      console.log('');
      for (const r of results) {
        const m = r.metrics;
        console.log(`== ${r.engine} → ${r.dir}`);
        console.log(`   primer audio ${fmtSec(m.firstAudio?.latencyMs)} | retraso fin de frase mediana ${fmtSec(m.phraseEndLag.medianMs)} p95 ${fmtSec(m.phraseEndLag.p95Ms)} (${m.phraseEndLag.anchors} frases) | deriva ${m.drift.slopeSecPer10Min === null ? '-' : m.drift.slopeSecPer10Min.toFixed(2) + ' s/10min'} | atascos ${m.stalls.length} | reconexiones ${m.stability.reconnects} | errores ${m.stability.errors}`);
      }
      if (results.length > 1) {
        const reportPath = join(values.out ?? 'runs', `${basename(results[0].dir).replace(/-[a-z]+$/, '')}-reporte.md`);
        writeFileSync(reportPath, renderReport(results.map((r) => loadRun(r.dir))));
        console.log(`\nReporte comparativo: ${reportPath}`);
      }
      return;
    }
    case 'synth': {
      const out = values.out ?? 'samples/sintetico.wav';
      mkdirSync(dirname(out), { recursive: true });
      const r = writeSynthWav(out, { seconds: num(values.seconds) ?? 60, rate: num(values.rate) ?? 16000 });
      console.log(`Escrito ${out}: ${r.phrases.length} frases sintéticas, ${fmtClock((num(values.seconds) ?? 60) * 1000)}.`);
      return;
    }
    case 'prepare': {
      if (!values.input) throw new Error('prepare necesita --input');
      if (!(await ffmpegAvailable())) throw new Error('prepare necesita ffmpeg instalado');
      const rate = num(values.rate) ?? 24000;
      const out = values.out ?? join('samples', `${basename(values.input, extname(values.input))}.${rate}.wav`);
      mkdirSync(dirname(out), { recursive: true });
      await convertToWav(values.input, out, rate, { startMs: values['start-sec'] ? Number(values['start-sec']) * 1000 : undefined, maxMs: values['max-minutes'] ? Number(values['max-minutes']) * 60_000 : undefined });
      console.log(`Escrito ${out} (${rate} Hz, mono, PCM16).`);
      return;
    }
    case 'transcribe': {
      if (!values.input) throw new Error('transcribe necesita --input');
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('Falta OPENAI_API_KEY en .env');
      const out = values.out ?? join(dirname(values.input), `${basename(values.input, extname(values.input))}.referencia.json`);
      const ref = await transcribeReference({ input: values.input, out, apiKey, language: values.language ?? 'es', model: values.model, log });
      console.log(`Referencia escrita en ${out}: ${ref.segments.length} segmentos.`);
      return;
    }
    case 'judge': {
      if (!values.run || !values.reference) throw new Error('judge necesita --run y --reference');
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('Falta OPENAI_API_KEY en .env');
      const model = values.model ?? process.env.JUDGE_MODEL ?? 'gpt-5';
      const res = await judgeRun({ runDir: values.run, reference: loadReference(values.reference), apiKey, model, targetLanguage: values.target, log });
      console.log(`Juez: puntaje medio ${res.meanScore?.toFixed(2) ?? '-'} de 5 en ${res.scored} frases; retraso alineado mediana ${fmtSec(res.lag.medianMs)}; ${res.critical.length} frases críticas; ${res.omittedSource.length} segmentos sin traducir. Detalle en ${join(values.run, 'juez.md')}`);
      return;
    }
    case 'report': {
      if (!positionals.length) throw new Error('report necesita al menos una carpeta de corrida');
      const md = renderReport(positionals.map((p) => loadRun(resolve(p))));
      if (values.out) {
        writeFileSync(values.out, md);
        console.log(`Reporte escrito en ${values.out}`);
      } else console.log(md);
      return;
    }
    default:
      throw new Error(`Comando desconocido: ${command}\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
