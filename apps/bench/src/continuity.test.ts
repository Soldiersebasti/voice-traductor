import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLagChartSvg } from './chart.js';
import { backlogSeries, perceivedStats, renderJudge, type JudgeItem } from './judge.js';
import { continuityStats } from './metrics.js';
import { referenceFromManifest, splitSentences } from './phrases.js';
import { synthSpeech } from './synth.js';
import { detectSpeech } from './vad.js';

function item(id: number, heard: number, dur: number, srcStart: number, srcEnd: number, score = 5): JudgeItem {
  return { target_id: id, source_ids: [id], score, errors: [], heardMs: heard, heardEndMs: heard + dur, sourceStartMs: srcStart, sourceEndMs: srcEnd, lagStartMs: heard - srcStart, lagEndMs: heard + dur - srcEnd, text: `frase ${id}` };
}

test('continuityStats: habla continua traducida con 1,5 s de retraso es simultánea y cubre el tramo', () => {
  const rate = 16000;
  const r = synthSpeech({ seconds: 40, rate, seed: 12, phraseMs: 6000, pauseMs: 300, jitter: 0 });
  const shift = Math.round(1.5 * rate);
  const output = new Int16Array(r.pcm.length + shift);
  output.set(r.pcm, shift);
  const src = detectSpeech(r.pcm, rate);
  const out = detectSpeech(output, rate);
  const c = continuityStats(src, out, 1500, 40_000);
  assert.ok((c.overlapShare ?? 0) > 0.8, `simultaneidad ${c.overlapShare}`);
  assert.equal(c.longRuns.length, 1, 'un solo tramo continuo');
  assert.ok(c.longRuns[0].durationMs > 30_000);
  assert.ok(Math.abs((c.longRuns[0].firstOutputOffsetMs ?? 0) - 1500) <= 80);
  assert.ok(c.longRuns[0].coverage > 0.95, `cobertura ${c.longRuns[0].coverage}`);
  assert.ok(c.longRuns[0].maxOutputGapMs < 700, `hueco ${c.longRuns[0].maxOutputGapMs}`);
  assert.equal(c.silences.length, 0);
});

test('continuityStats: una traducción consecutiva (solo en las pausas) da simultaneidad baja y un silencio', () => {
  const rate = 16000;
  const r = synthSpeech({ seconds: 40, rate, seed: 12, phraseMs: 6000, pauseMs: 300, jitter: 0 });
  const output = new Int16Array(r.pcm.length + 8 * rate);
  // Salida que calla durante 6 s mientras la fuente habla.
  output.set(r.pcm, Math.round(1.5 * rate));
  output.fill(0, 10 * rate, 16 * rate);
  const src = detectSpeech(r.pcm, rate);
  const out = detectSpeech(output, rate);
  const c = continuityStats(src, out, 1500, 40_000);
  assert.ok(c.silences.length >= 1, 'debe detectar el silencio');
  assert.ok(c.silences[0].durationMs >= 5000);
  assert.ok(c.longRuns[0].maxOutputGapMs >= 5000);
  assert.ok(c.longRuns[0].coverage < 0.9);
});

test('perceivedStats: solapamiento, deriva, saltos y calidad por franja', () => {
  // Diez frases de 3 s cada 3 s; el retraso fin→fin crece 0,3 s por frase (deriva) hasta la 6, luego cae de golpe (salto).
  const items: JudgeItem[] = [];
  for (let k = 0; k < 10; k++) {
    const srcStart = k * 3000;
    const lag = k < 6 ? 1500 + k * 250 : 1000;
    items.push(item(k + 1, srcStart + lag, 3000, srcStart, srcStart + 3000, k < 6 ? 5 : 3));
  }
  const p = perceivedStats(items, 3000);
  assert.equal(p.overlapShare, 1, 'todas empiezan a oírse antes de que termine la frase dicha');
  assert.equal(p.jumps.length, 1);
  assert.ok(p.jumps[0].fromMs > p.jumps[0].toMs + 1500);
  assert.ok(p.drift.windows.length >= 1);
  const fast = p.qualityByLag.find((b) => b.label === '≤ 2 s');
  assert.ok(fast && fast.n > 0);
  assert.equal(p.qualityByLag.find((b) => b.label === '> 5 s')?.n, 0);
  assert.ok(p.backlog.length > 20);
});

test('backlogSeries crece entre frases y baja cuando se oye la traducción', () => {
  const items = [item(1, 2000, 2000, 0, 2000), item(2, 8000, 2000, 2000, 4000)];
  const s = backlogSeries(items);
  const at = (t: number) => s.find((b) => b.tMs === t)!;
  assert.equal(at(2000).backlogMs, 2000);
  assert.equal(at(4000).backlogMs, 2000);
  assert.equal(at(7000).backlogMs, 5000, 'entre frases el atraso crece');
  assert.equal(at(10000).backlogMs, 6000);
  assert.equal(at(7000).speaking, false);
  assert.equal(at(9000).speaking, true);
});

test('renderJudge incluye la sección de continuidad', () => {
  const items = [item(1, 2000, 2000, 0, 2000), item(2, 5500, 2000, 2000, 4000)];
  const p = perceivedStats(items, 3000);
  const md = renderJudge({ model: 'm', sentencesFrom: 'subtitulos_del_motor', sentences: 2, scored: 2, meanScore: 5, distribution: { '5': 2 }, shareAtLeast4: 1, critical: [], errorCounts: {}, omittedSource: [], perceived: p, items });
  assert.match(md, /antes de que el pastor terminara/);
  assert.match(md, /Deriva/);
  assert.match(md, /Saltos/);
  assert.match(md, /retraso_percibido\.svg/);
});

test('referenceFromManifest y splitSentences', () => {
  const ref = referenceFromManifest({ source: 'x.wav', createdAt: '', gapMs: 300, mode: 'continuo', phrases: [{ id: 1, text: 'Hola.', startMs: 1000, endMs: 1800 }] });
  assert.equal(ref.segments[0].start, 1000);
  assert.equal(ref.model, 'manifiesto');
  const parts = splitSentences('Hermanos, buenas noches. ¿Cuántos creen eso? ¡Digan amén! Juan 3:16 dice algo. Fin');
  assert.deepEqual(parts, ['Hermanos, buenas noches.', '¿Cuántos creen eso?', '¡Digan amén!', 'Juan 3:16 dice algo.', 'Fin']);
});

test('renderLagChartSvg produce un SVG con umbral, series y puntos', () => {
  const svg = renderLagChartSvg({
    title: 'prueba',
    thresholdMs: 3000,
    endMs: 60_000,
    points: [{ tMs: 1000, lagMs: 1500, kind: 'inicio' }, { tMs: 4000, lagMs: 2500, kind: 'fin', text: 'x' }, { tMs: 30_000, lagMs: 4200, kind: 'fin' }],
    backlog: [{ tMs: 0, backlogMs: 0, speaking: false }, { tMs: 1000, backlogMs: 1500, speaking: true }, { tMs: 2000, backlogMs: 1800, speaking: true }],
  });
  assert.match(svg, /^<svg /);
  assert.match(svg, /umbral 3\.0 s/);
  assert.ok((svg.match(/<circle/g) ?? []).length === 3);
  assert.ok((svg.match(/<path/g) ?? []).length === 2);
  assert.match(svg, /0:30/);
});
