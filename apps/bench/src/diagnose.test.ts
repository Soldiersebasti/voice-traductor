import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ffmpegAvailable } from './audio-load.js';
import { arrivalGapForensics, diagnoseFromData, inputTranscriptLagStat } from './diagnose.js';
import { rawToAlignedMapper, type ChunkEntry, type JudgeItem } from './judge.js';
import { replayRun, trimPauses } from './replay.js';
import { runBench } from './run.js';
import { synthSpeech, writeSynthWav } from './synth.js';

test('diagnoseFromData separa modelo + red de la cola del reproductor', () => {
  const rate = 24000;
  // Dos frases dichas en 0-3 s y 3-6 s. La traducción de cada una llega 1,5 s después de su inicio,
  // pero la primera dura 4 s al oírse, así que la segunda espera 2,5 s en cola.
  const chunks: ChunkEntry[] = [];
  const push = (t: number, playStart: number, ms: number) => chunks.push({ t, playStart, samples: Math.round((ms / 1000) * rate) });
  push(1500, 1500, 4000); // frase 1 llega y suena 1,5 s → 5,5 s
  push(4500, 5500, 2000); // frase 2 llega a 4,5 s pero suena a 5,5 s (cola 1 s)
  const items: JudgeItem[] = [
    { target_id: 1, source_ids: [1], score: 5, errors: [], heardMs: 1500, heardEndMs: 5500, sourceStartMs: 0, sourceEndMs: 3000, lagStartMs: 1500, lagEndMs: 2500 },
    { target_id: 2, source_ids: [2], score: 5, errors: [], heardMs: 5500, heardEndMs: 7500, sourceStartMs: 3000, sourceEndMs: 6000, lagStartMs: 2500, lagEndMs: 1500 },
  ];
  const r = diagnoseFromData({ chunks, rate, items, jumps: [{ heardMs: 5500, fromMs: 2500, toMs: 1500, text: 'x' }], raw: null, speechRatio: 1.2, connectMs: 180, thresholdMs: 3000 });
  assert.equal(r.sentences.arrivalLag.medianMs, 1500);
  assert.equal(r.sentences.queueLag.maxMs, 1000);
  assert.equal(r.sentences.queueLag.medianMs, 500);
  assert.equal(r.connectMs, 180);
  assert.equal(r.jumps.length, 1);
  assert.equal(r.jumps[0].cause, 'traducción más corta');
  assert.ok(Math.abs((r.sentences.durationRatio.medianMs ?? 0) / 1000 - 1) < 0.01);
});

test('diagnoseFromData atribuye un salto a la pausa del pastor', () => {
  const rate = 24000;
  const chunks: ChunkEntry[] = [{ t: 2000, playStart: 2000, samples: 2 * rate }, { t: 12_000, playStart: 12_000, samples: 2 * rate }];
  const items: JudgeItem[] = [
    { target_id: 1, source_ids: [1], score: 5, errors: [], heardMs: 2000, heardEndMs: 4000, sourceStartMs: 0, sourceEndMs: 2000, lagStartMs: 2000, lagEndMs: 2000 },
    { target_id: 2, source_ids: [2], score: 5, errors: [], heardMs: 12_000, heardEndMs: 14_000, sourceStartMs: 10_000, sourceEndMs: 12_000, lagStartMs: 2000, lagEndMs: 2000 },
  ];
  const r = diagnoseFromData({ chunks, rate, items, jumps: [{ heardMs: 12_000, fromMs: 4500, toMs: 2000, text: 'y' }], raw: null, speechRatio: null, connectMs: null, thresholdMs: 3000 });
  assert.equal(r.jumps[0].cause, 'pausa del pastor');
  assert.equal(r.jumps[0].pauseBeforeMs, 8000);
});

test('rawToAlignedMapper escala tramos acelerados o recortados', () => {
  const rate = 24000;
  // Un tramo de 2000 ms crudos reproducido en 1000 ms a partir de 5000 ms.
  const map = rawToAlignedMapper([{ t: 0, playStart: 5000, samples: rate, rawStartMs: 0, rawMs: 2000 }], rate);
  assert.equal(map(0), 5000);
  assert.equal(map(1000), 5500);
  assert.equal(map(2000), 6000);
});

test('trimPauses acorta pausas largas sin tocar la voz', () => {
  const rate = 16000;
  const r = synthSpeech({ seconds: 6, rate, seed: 3, phraseMs: 1500, pauseMs: 1000, jitter: 0 });
  const out = trimPauses(r.pcm, rate);
  assert.ok(out.length < r.pcm.length - 0.5 * rate, `recortó ${(r.pcm.length - out.length) / rate} s`);
  assert.ok(out.length > r.pcm.length * 0.5);
});

test('replay con alcance reduce el retraso al final de una corrida simulada', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-replay-'));
  try {
    const input = join(dir, 'in.wav');
    writeSynthWav(input, { seconds: 14, rate: 16000, seed: 5, phraseMs: 2500, pauseMs: 700, jitter: 0 });
    // Modelo simulado que entrega por ráfagas de 2 s y cuya "traducción" dura un 25 % más que el original: la cola crece.
    const [orig] = await runBench({ engines: ['mock'], input, outDir: join(dir, 'runs'), label: 'r', targetLanguage: 'en', engineOptions: { delayMs: 1500, burstMs: 2000, durationFactor: 1.25 }, finishTimeoutMs: 6000, log: () => {} });
    assert.ok((orig.metrics.maxQueueMs ?? 0) > 1000, `debe haber cola en la corrida original: ${orig.metrics.maxQueueMs}`);
    const hasFfmpeg = await ffmpegAvailable();
    const rep = await replayRun({ runDir: orig.dir, triggerMs: 1000, stretch: hasFfmpeg ? 1.25 : 1, trimSilence: true, log: () => {} });
    assert.ok(rep.listeningMsAfter <= rep.listeningMsBefore, 'la escucha simulada no puede ser más larga');
    if (hasFfmpeg) {
      assert.ok(rep.stretchedMs > 0, 'debe haber acelerado algo');
      assert.ok((rep.metrics.tailLagMs ?? 99_999) < (orig.metrics.tailLagMs ?? 0), `cola final ${rep.metrics.tailLagMs} vs ${orig.metrics.tailLagMs}`);
    }
    assert.ok(rep.dir.endsWith('x'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('arrivalGapForensics explica un hueco con la transcripción de entrada', () => {
  const rate = 24000;
  const chunks = [
    { t: 1000, playStart: 1000, samples: rate },
    { t: 12_000, playStart: 12_000, samples: rate },
  ];
  const source = [{ start: 0, end: 11_000 }];
  const events = [
    { t: 3000, type: 'transcript', channel: 'source', text: 'hermanos ', final: false },
    { t: 5000, type: 'transcript', channel: 'source', text: 'buenas noches ', final: false },
    { t: 12_100, type: 'transcript', channel: 'target', text: 'Brothers, good evening.', final: false },
  ];
  const gaps = arrivalGapForensics({ chunks, rate, events, source, lagMs: 2000, reference: null });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].durationMs, 10_000);
  assert.equal(gaps[0].inputDeltas, 2);
  assert.equal(gaps[0].verdict, 'el modelo recibía audio y retuvo la salida');
  assert.match(gaps[0].outputAfter, /Brothers/);

  const noInput = arrivalGapForensics({ chunks, rate, events: events.filter((e) => e.channel !== 'source'), source, lagMs: 2000, reference: null });
  assert.equal(noInput[0].verdict, 'sin transcripción de entrada activada');

  const inputElsewhere = arrivalGapForensics({ chunks, rate, events: [{ t: 500, type: 'transcript', channel: 'source', text: 'x', final: false }, ...events.filter((e) => e.channel !== 'source')], source, lagMs: 2000, reference: null });
  assert.equal(inputElsewhere[0].verdict, 'no llegó transcripción de entrada: revisar red o envío');
});

test('inputTranscriptLagStat mide inicio de habla → primer fragmento de transcripción', () => {
  const source = [{ start: 0, end: 3000 }, { start: 5000, end: 8000 }];
  const events = [
    { t: 800, type: 'transcript', channel: 'source', text: 'a', final: false },
    { t: 1500, type: 'transcript', channel: 'source', text: 'b', final: false },
    { t: 5900, type: 'transcript', channel: 'source', text: 'c', final: false },
  ];
  const s = inputTranscriptLagStat(events, source);
  assert.ok(s);
  assert.equal(s.n, 2);
  assert.equal(s.medianMs, 850);
});
