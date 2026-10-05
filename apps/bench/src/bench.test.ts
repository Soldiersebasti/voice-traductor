import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readWav, toMono, writeWav } from '@voice-traductor/engines';
import { sentencesFromDeltas } from './judge.js';
import { computeMetrics, matchMonotonic, type Metrics } from './metrics.js';
import { runBench } from './run.js';
import { synthSpeech, writeSynthWav } from './synth.js';
import { detectSpeech } from './vad.js';

test('el detector de voz encuentra las frases sintéticas', () => {
  const r = synthSpeech({ seconds: 20, rate: 16000, seed: 7 });
  const segs = detectSpeech(r.pcm, 16000);
  assert.equal(segs.length, r.phrases.length, `detectó ${segs.length} segmentos para ${r.phrases.length} frases`);
  for (let i = 0; i < segs.length; i++) {
    assert.ok(Math.abs(segs[i].start - r.phrases[i].start) <= 60, `inicio frase ${i}: ${segs[i].start} vs ${r.phrases[i].start}`);
    assert.ok(Math.abs(segs[i].end - r.phrases[i].end) <= 60, `fin frase ${i}: ${segs[i].end} vs ${r.phrases[i].end}`);
  }
});

test('matchMonotonic empareja en orden y respeta los límites', () => {
  const s = matchMonotonic([1000, 5000, 9000], [2500, 6400, 10100]);
  assert.equal(s.anchors, 3);
  assert.equal(s.medianMs, 1400);
  assert.equal(s.minMs, 1100);
  // Una salida adelantada al instante de la fuente no puede ser su traducción.
  const t = matchMonotonic([1000, 5000], [900, 2000, 6000]);
  assert.deepEqual(t.samples.map((x) => x.lagMs), [1000, 1000]);
  // Fuera del máximo plausible no se empareja.
  assert.equal(matchMonotonic([1000], [20000]).anchors, 0);
});

test('las métricas recuperan un retraso conocido a partir del audio', () => {
  const rate = 16000;
  const r = synthSpeech({ seconds: 30, rate, seed: 3 });
  const delayMs = 1800;
  const shift = Math.round((delayMs / 1000) * rate);
  const output = new Int16Array(r.pcm.length + shift);
  output.set(r.pcm, shift);
  const m: Metrics = computeMetrics({
    engine: 'test',
    label: 'test',
    source: r.pcm,
    sourceRate: rate,
    output,
    outputRate: rate,
    chunks: [],
    transcripts: [],
    statuses: [],
    sourceEndMs: 30_000,
    runEndMs: 32_000,
  });
  assert.ok(m.phraseEndLag.anchors >= 4, `anclas: ${m.phraseEndLag.anchors}`);
  assert.ok(Math.abs((m.phraseEndLag.medianMs ?? 0) - delayMs) <= 60, `retraso medido ${m.phraseEndLag.medianMs}`);
  assert.ok(Math.abs((m.phraseStartLag.medianMs ?? 0) - delayMs) <= 60);
  assert.ok(Math.abs((m.firstAudio?.latencyMs ?? 0) - delayMs) <= 60);
  assert.ok(Math.abs(m.drift.slopeSecPer10Min ?? 99) < 0.2, `deriva ${m.drift.slopeSecPer10Min}`);
  assert.equal(m.stalls.length, 0);
});

test('detecta un atasco cuando la traducción se calla con la fuente hablando', () => {
  const rate = 16000;
  const r = synthSpeech({ seconds: 40, rate, seed: 5 });
  const shift = Math.round(1.5 * rate);
  const output = new Int16Array(r.pcm.length + shift);
  output.set(r.pcm, shift);
  // Silencio de salida entre los segundos 12 y 26.
  output.fill(0, 12 * rate, 26 * rate);
  const m = computeMetrics({ engine: 't', label: 't', source: r.pcm, sourceRate: rate, output, outputRate: rate, chunks: [], transcripts: [], statuses: [], sourceEndMs: 40_000, runEndMs: 42_000 });
  assert.ok(m.stalls.length >= 1, 'debe detectar al menos un atasco');
  assert.ok(m.stalls[0].durationMs >= 10_000);
});

test('sentencesFromDeltas reconstruye frases con el tiempo del primer fragmento', () => {
  const s = sentencesFromDeltas([
    { t: 1000, playRef: 900, text: 'In the ' },
    { t: 1300, playRef: 1200, text: 'beginning. God ' },
    { t: 1600, playRef: 1500, text: 'created' },
    { t: 1900, playRef: 1800, text: ' heaven. ' },
  ]);
  assert.deepEqual(s.map((x) => x.text), ['In the beginning.', 'God created heaven.']);
  assert.equal(s[0].heardMs, 1000);
  assert.equal(s[1].heardMs, 1300);
});

test('corrida de punta a punta con el motor simulado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-'));
  try {
    const input = join(dir, 'in.wav');
    writeSynthWav(input, { seconds: 12, rate: 16000, seed: 11, phraseMs: 2500, pauseMs: 900 });
    const results = await runBench({ engines: ['mock'], input, outDir: join(dir, 'runs'), label: 'e2e', targetLanguage: 'en', engineOptions: { delayMs: 800 }, finishTimeoutMs: 3000, log: () => {} });
    assert.equal(results.length, 1);
    const { dir: runDir, metrics } = results[0];
    for (const f of ['comparacion.wav', 'traduccion_alineada.wav', 'traduccion_cruda.wav', 'eventos.jsonl', 'metricas.json', 'resumen.md', 'transcripcion_traduccion.txt', 'corrida.json']) {
      assert.ok(existsSync(join(runDir, f)), `falta ${f}`);
    }
    assert.ok(Math.abs((metrics.phraseEndLag.medianMs ?? 0) - 800) <= 250, `retraso medido ${metrics.phraseEndLag.medianMs}`);
    assert.ok(metrics.captions.targetChars > 0);
    const cmp = readWav(join(runDir, 'comparacion.wav'));
    assert.equal(cmp.channels, 2);
    assert.ok(toMono(cmp).length > 12 * 24000);
    assert.match(readFileSync(join(runDir, 'resumen.md'), 'utf8'), /Retraso/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
