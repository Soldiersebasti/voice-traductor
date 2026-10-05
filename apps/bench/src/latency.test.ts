import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verdictFromLag, verdictFromPassRate, verdictFromPerceived, worst } from './criteria.js';
import { perceivedStats, rawToAlignedMapper, type JudgeItem } from './judge.js';
import { detectPhrasesByVad, evaluatePhrases, type PhraseSpec } from './phrases.js';
import { runBench } from './run.js';
import { synthSpeech, writeSynthWav } from './synth.js';

test('evaluatePhrases mide fin dicho → fin oído por frase y aplica el umbral', () => {
  const rate = 16000;
  const r = synthSpeech({ seconds: 30, rate, seed: 9, phraseMs: 1200, pauseMs: 6000, jitter: 0 });
  const phrases: PhraseSpec[] = r.phrases.map((p, i) => ({ id: i + 1, text: `frase ${i + 1}`, startMs: p.start, endMs: p.end }));
  const delay = 1200;
  const shift = Math.round((delay / 1000) * rate);
  const output = new Int16Array(r.pcm.length + shift);
  output.set(r.pcm, shift);
  // La tercera frase no se traduce.
  const third = phrases[2];
  output.fill(0, Math.round(((third.startMs + delay - 200) / 1000) * rate), Math.round(((third.endMs + delay + 500) / 1000) * rate));
  const stats = evaluatePhrases(phrases, output, rate, [], 3000);
  assert.equal(stats.total, phrases.length);
  assert.equal(stats.answered, phrases.length - 1);
  assert.equal(stats.results[2].ok, null);
  for (const res of stats.results.filter((x) => x.ok !== null)) {
    assert.ok(Math.abs((res.endLagMs ?? 0) - delay) <= 60, `fin→fin ${res.endLagMs}`);
    assert.ok(Math.abs((res.startToStartMs ?? 0) - delay) <= 60, `inicio→inicio ${res.startToStartMs}`);
    assert.equal(res.ok, true);
  }
  const strict = evaluatePhrases(phrases, output, rate, [], 1000);
  assert.equal(strict.passed, 0);
  assert.equal(strict.answered, phrases.length - 1);
});

test('detectPhrasesByVad encuentra las frases del guion grabado y las etiqueta en orden', () => {
  const rate = 16000;
  const r = synthSpeech({ seconds: 25, rate, seed: 2, phraseMs: 1000, pauseMs: 4000, jitter: 0.1 });
  const texts = r.phrases.map((_, i) => `texto ${i + 1}`);
  const found = detectPhrasesByVad(r.pcm, rate, texts);
  assert.equal(found.length, r.phrases.length);
  assert.equal(found[1].text, 'texto 2');
  assert.ok(Math.abs(found[1].startMs - r.phrases[1].start) <= 60);
});

test('rawToAlignedMapper proyecta tiempos del audio crudo a la línea del oyente', () => {
  const map = rawToAlignedMapper([{ samples: 2400, playStart: 1000 }, { samples: 2400, playStart: 5000 }], 24000);
  assert.equal(map(0), 1000);
  assert.equal(map(50), 1050);
  assert.equal(map(150), 5050);
  assert.equal(map(500), 5100); // más allá del último fragmento: se acota a su fin
});

test('perceivedStats calcula tiempo de escucha sobre el umbral y el tramo más largo', () => {
  const item = (id: number, heard: number, dur: number, lagStart: number, lagEnd: number): JudgeItem => ({ target_id: id, source_ids: [id], score: 5, errors: [], heardMs: heard, heardEndMs: heard + dur, lagStartMs: lagStart, lagEndMs: lagEnd });
  const items = [item(1, 0, 2000, 1500, 1500), item(2, 2500, 2000, 4000, 4000), item(3, 5000, 2000, 4500, 4500), item(4, 8000, 2000, 1000, 1000)];
  const p = perceivedStats(items, 3000);
  assert.equal(p.listeningMs, 8000);
  assert.ok(Math.abs((p.shareAboveThreshold ?? 0) - 0.5) < 0.01, `share ${p.shareAboveThreshold}`);
  assert.equal(p.longestAboveMs, 4000);
  assert.equal(p.lagStart.medianMs, 2750);
  assert.equal(p.verdict, 'no cumple');
  const good = perceivedStats([item(1, 0, 2000, 1500, 1500), item(2, 2500, 2000, 2000, 2200)], 3000);
  assert.equal(good.shareAboveThreshold, 0);
  assert.equal(good.verdict, 'cumple');
});

test('veredictos', () => {
  assert.equal(verdictFromLag(2000, 2500, 3000), 'cumple');
  assert.equal(verdictFromLag(2000, 5000, 3000), 'al límite');
  assert.equal(verdictFromLag(3500, 4000, 3000), 'no cumple');
  assert.equal(verdictFromLag(null, null, 3000), 'sin datos');
  assert.equal(verdictFromPassRate(0.95), 'cumple');
  assert.equal(verdictFromPassRate(0.8), 'al límite');
  assert.equal(verdictFromPassRate(0.5), 'no cumple');
  assert.equal(verdictFromPerceived(0.05, 5000), 'cumple');
  assert.equal(verdictFromPerceived(0.05, 30000), 'al límite');
  assert.equal(worst('cumple', 'sin datos', 'al límite'), 'al límite');
  assert.equal(worst('sin datos'), 'sin datos');
});

test('corrida con manifiesto de frases interactivas y motor simulado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-frases-'));
  try {
    const input = join(dir, 'frases.wav');
    const r = writeSynthWav(input, { seconds: 13, rate: 16000, seed: 21, phraseMs: 1200, pauseMs: 3000, jitter: 0 });
    const manifest = join(dir, 'frases.manifest.json');
    writeFileSync(manifest, JSON.stringify({ source: input, createdAt: '', gapMs: 3000, phrases: r.phrases.map((p, i) => ({ id: i + 1, text: `frase ${i + 1}`, startMs: p.start, endMs: p.end })) }));
    const [res] = await runBench({ engines: ['mock'], input, outDir: join(dir, 'runs'), label: 'frases', targetLanguage: 'en', engineOptions: { delayMs: 900 }, manifest, thresholdMs: 2000, finishTimeoutMs: 3000, log: () => {} });
    const p = res.metrics.phrases;
    assert.ok(p, 'debe evaluar las frases');
    assert.equal(p.total, r.phrases.length);
    assert.equal(p.passed, p.total);
    assert.ok(Math.abs((p.endLag.medianMs ?? 0) - 900) <= 250, `fin→fin ${p.endLag.medianMs}`);
    assert.equal(res.metrics.latency.phrases, 'cumple');
    assert.equal(res.metrics.latency.thresholdMs, 2000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
