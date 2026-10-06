#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ENGINE_NAMES, isEngineName } from '@voice-traductor/engines';
import { convertToWav, ffmpegAvailable } from './audio-load.js';
import { diagnoseRun } from './diagnose.js';
import { judgeRun } from './judge.js';
import { replayRun } from './replay.js';
import { loadRun, renderReport } from './report.js';
import { runBench } from './run.js';
import { writeSynthWav } from './synth.js';
import { loadManifest, loadPhraseList, referenceFromManifest, splitSentences } from './phrases.js';
import { loadReference, transcribeReference } from './transcribe.js';
import { manifestPathFor, synthesizePhraseFile } from './tts.js';
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
  phrases     Genera el audio de la prueba interactiva (frases cortas con voz sintética) y su manifiesto de tiempos.
  diagnose    Descompone el retraso de una corrida: modelo + red, cola del reproductor, exceso de duración, pausas del modelo, saltos.
  replay      Simula la misma corrida con reproducción adaptativa (recorte de pausas y velocidad conservando el tono) sin llamar al modelo.

run
  --engine <openai|gemini|qwen|hibiki|mock|lista,separada,por,comas>   (obligatorio)
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
  --max-lag-sec <n>            umbral de latencia del MVP, por defecto 3
  --manifest <archivo.json>    prueba interactiva con tiempos exactos (salida del comando phrases)
  --phrases <archivo.txt>      prueba interactiva grabada con voz propia; las frases se detectan por silencio

synth      --out <archivo.wav> [--seconds 60] [--rate 16000]
prepare    --input <archivo> --out <archivo.wav> [--rate 24000] [--start-sec n] [--max-minutes n] [--normalize]
diagnose   --run <carpeta de corrida> [--max-lag-sec 3] [--reference <ref.json> | --manifest <m.json>]   (mejor después de judge)
replay     --run <carpeta de corrida> [--stretch 1.15] [--trigger-sec 2.5] [--no-trim] [--out <carpeta>]
transcribe --input <archivo> [--language es] [--out <referencia.json>]
judge      --run <carpeta de corrida> --reference <referencia.json> [--model gpt-5] [--target en] [--max-lag-sec 3] [--no-perceived]
phrases    --phrases docs/frases-interactivas.txt --out samples/interactivas.wav [--gap-sec 6] [--voice onyx] [--tts-model gpt-4o-mini-tts]
           --text docs/lectura-continua.txt --out samples/continua.wav [--gap-sec 0.3]   lectura continua: el texto se parte en frases y se lee seguido
judge      también acepta --manifest <archivo.json> en lugar de --reference (tiempos exactos de un audio generado con phrases)
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
      'max-lag-sec': { type: 'string' },
      manifest: { type: 'string' },
      phrases: { type: 'string' },
      'gap-sec': { type: 'string' },
      voice: { type: 'string' },
      'tts-model': { type: 'string' },
      'no-perceived': { type: 'boolean', default: false },
      text: { type: 'string' },
      normalize: { type: 'boolean', default: false },
      stretch: { type: 'string' },
      'trigger-sec': { type: 'string' },
      'no-trim': { type: 'boolean', default: false },
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
        thresholdMs: values['max-lag-sec'] ? Number(values['max-lag-sec']) * 1000 : undefined,
        manifest: values.manifest,
        phrasesFile: values.phrases,
        log,
        signal: controller.signal,
      });
      console.log('');
      for (const r of results) {
        const m = r.metrics;
        console.log(`== ${r.engine} → ${r.dir}`);
        console.log(`   primer audio ${fmtSec(m.firstAudio?.latencyMs)} | retraso fin de frase mediana ${fmtSec(m.phraseEndLag.medianMs)} p95 ${fmtSec(m.phraseEndLag.p95Ms)} (${m.phraseEndLag.anchors} frases) | deriva ${m.drift.slopeSecPer10Min === null ? '-' : m.drift.slopeSecPer10Min.toFixed(2) + ' s/10min'} | atascos ${m.stalls.length} | reconexiones ${m.stability.reconnects} | errores ${m.stability.errors}`);
        console.log(`   latencia ≤ ${fmtSec(m.latency.thresholdMs, 1)}: fin de frase ${m.latency.heuristic}${m.phrases ? ` | frases interactivas ${m.latency.phrases} (${m.phrases.passed}/${m.phrases.total}, mediana fin→fin ${fmtSec(m.phrases.endLag.medianMs)}, máx ${fmtSec(m.phrases.endLag.maxMs)})` : ''}`);
        if (m.phrases) {
          for (const f of m.phrases.results) console.log(`     ${String(f.id).padStart(2)}. ${f.ok === null ? 'SIN TRADUCCIÓN' : f.ok ? 'ok   ' : 'TARDE'} inicio ${fmtSec(f.startLagMs)} fin ${fmtSec(f.endLagMs)}  "${f.text}" → "${f.heardText || '-'}"`);
        }
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
      await convertToWav(values.input, out, rate, { startMs: values['start-sec'] ? Number(values['start-sec']) * 1000 : undefined, maxMs: values['max-minutes'] ? Number(values['max-minutes']) * 60_000 : undefined, normalize: values.normalize });
      console.log(`Escrito ${out} (${rate} Hz, mono, PCM16${values.normalize ? ', volumen normalizado' : ''}).`);
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
      if (!values.run || (!values.reference && !values.manifest)) throw new Error('judge necesita --run y además --reference o --manifest');
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('Falta OPENAI_API_KEY en .env');
      const model = values.model ?? process.env.JUDGE_MODEL ?? 'gpt-5';
      const reference = values.reference ? loadReference(values.reference) : referenceFromManifest(loadManifest(values.manifest!), values.language ?? 'es');
      const res = await judgeRun({ runDir: values.run, reference, apiKey, model, targetLanguage: values.target, thresholdMs: values['max-lag-sec'] ? Number(values['max-lag-sec']) * 1000 : undefined, perceived: !values['no-perceived'], log });
      const p = res.perceived;
      console.log(`Juez: puntaje medio ${res.meanScore?.toFixed(2) ?? '-'} de 5 en ${res.scored} frases; ${res.critical.length} frases críticas; ${res.omittedSource.length} segmentos sin traducir.`);
      console.log(`Retraso percibido: ${p.verdict} | inicio→inicio mediana ${fmtSec(p.lagStart.medianMs)} p90 ${fmtSec(p.lagStart.p90Ms)} | fin→fin mediana ${fmtSec(p.lagEnd.medianMs)} p90 ${fmtSec(p.lagEnd.p90Ms)} | ${p.shareAboveThreshold === null ? '-' : Math.round(p.shareAboveThreshold * 100) + '%'} del tiempo de escucha sobre ${fmtSec(p.thresholdMs, 1)} | tramo más largo ${fmtSec(p.longestAboveMs, 1)}.`);
      console.log(`Continuidad: ${p.overlapShare === null ? '-' : Math.round(p.overlapShare * 100) + '%'} de las frases se empezaron a oír antes de que el pastor terminara | deriva ${p.drift.slopeSecPer10Min === null ? '-' : p.drift.slopeSecPer10Min.toFixed(2) + ' s/10 min'} | saltos ${p.jumps.length} | omisiones ${res.omittedSource.length}. Detalle en ${join(values.run, 'juez.md')} y gráfica en ${join(values.run, 'retraso_percibido.svg')}`);
      return;
    }
    case 'phrases': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('Falta OPENAI_API_KEY en .env');
      const continuous = Boolean(values.text);
      const phrasesList = continuous ? splitSentences(readFileSync(values.text!, 'utf8')) : loadPhraseList(values.phrases ?? 'docs/frases-interactivas.txt');
      const out = values.out ?? (continuous ? 'samples/continua.wav' : 'samples/interactivas.wav');
      mkdirSync(dirname(out), { recursive: true });
      const gapMs = values['gap-sec'] ? Number(values['gap-sec']) * 1000 : continuous ? 300 : undefined;
      const manifest = await synthesizePhraseFile({ phrases: phrasesList, out, apiKey, gapMs, leadMs: continuous ? 1000 : undefined, voice: values.voice, model: values['tts-model'], mode: continuous ? 'continuo' : 'aislado', log });
      const last = manifest.phrases[manifest.phrases.length - 1];
      console.log(`Escrito ${out} (${manifest.phrases.length} frases, ${fmtClock((last?.endMs ?? 0) + manifest.gapMs)}, modo ${manifest.mode}) y ${manifestPathFor(out)}.`);
      if (continuous) {
        console.log(`Siguiente: npm run bench -- run --engine openai --input ${out} --label continua`);
        console.log(`Después:   npm run bench -- judge --run runs/continua-openai --manifest ${manifestPathFor(out)}`);
      } else console.log(`Siguiente: npm run bench -- run --engine openai,gemini --input ${out} --manifest ${manifestPathFor(out)} --label interactivas`);
      return;
    }
    case 'diagnose': {
      if (!values.run) throw new Error('diagnose necesita --run');
      const r = await diagnoseRun(values.run, { thresholdMs: values['max-lag-sec'] ? Number(values['max-lag-sec']) * 1000 : undefined, reference: values.reference ? loadReference(values.reference) : values.manifest ? referenceFromManifest(loadManifest(values.manifest), values.language ?? 'es') : null, log });
      const st = (x: { medianMs: number | null; p90Ms: number | null }) => `mediana ${fmtSec(x.medianMs)} p90 ${fmtSec(x.p90Ms)}`;
      console.log(`Modelo + red (inicio dicho → llegada del primer audio): ${st(r.sentences.arrivalLag)} | cola del reproductor: ${st(r.sentences.queueLag)} | al empezar a oír: ${st(r.sentences.lagStart)} | al terminar: ${st(r.sentences.lagEnd)}`);
      console.log(`Duración oída/dicha mediana ${r.sentences.durationRatio.medianMs === null ? '-' : (r.sentences.durationRatio.medianMs / 1000).toFixed(2)} | exceso ${fmtSec(r.sentences.excessPerMinuteMs, 1)} por minuto | entrega ${r.bursts.generationSpeed.medianMs === null ? 'sin ráfagas largas' : (r.bursts.generationSpeed.medianMs / 1000).toFixed(2) + 'x'} | pausas del modelo recortables ${fmtSec(r.modelPauses.totalMs, 1)} | saltos ${r.jumps.length} (${r.jumps.map((j) => j.cause).join(', ') || '-'})`);
      console.log(`Red: ida y vuelta ${r.rttMs ? fmtSec(r.rttMs.medianMs, 3) : '-'} | subida + reconocimiento ${r.inputTranscriptLag ? st(r.inputTranscriptLag) : '-'} | huecos en llegadas con la fuente hablando: ${r.arrivalGaps.length} (${r.arrivalGaps.map((g) => `${fmtSec(g.durationMs, 1)} ${g.verdict}`).join('; ') || '-'})`);
      console.log(`Detalle en ${join(values.run, 'diagnostico.md')}`);
      return;
    }
    case 'replay': {
      if (!values.run) throw new Error('replay necesita --run');
      const r = await replayRun({ runDir: values.run, outDir: values.out, stretch: num(values.stretch), triggerMs: values['trigger-sec'] ? Number(values['trigger-sec']) * 1000 : undefined, trimSilence: !values['no-trim'], log });
      const m = r.metrics;
      console.log(`Simulación en ${r.dir}: escucha ${fmtClock(r.listeningMsBefore)} → ${fmtClock(r.listeningMsAfter)} | acelerado ${fmtSec(r.stretchedMs, 1)} | pausas recortadas ${fmtSec(r.trimmedMs, 1)} | retraso fin de frase mediana ${fmtSec(m.phraseEndLag.medianMs)} p90 ${fmtSec(m.phraseEndLag.p90Ms)} | retraso al final ${fmtSec(m.tailLagMs)}`);
      console.log(`Para el retraso percibido exacto: npm run bench -- judge --run ${r.dir} --reference <referencia.json>`);
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
