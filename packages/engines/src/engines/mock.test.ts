import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockEngine } from './mock.js';
import type { EngineEvent } from '../types.js';

test('el motor simulado devuelve el audio con el retraso configurado', async () => {
  const engine = new MockEngine({ delayMs: 200, inputSampleRate: 16000, outputSampleRate: 24000 });
  const events: Array<{ at: number; ev: EngineEvent }> = [];
  const t0 = Date.now();
  engine.on((ev) => events.push({ at: Date.now() - t0, ev }));
  await engine.start();
  engine.sendAudio(new Int16Array(1600)); // 100 ms
  await engine.finish();
  await engine.stop();
  const audio = events.find((e) => e.ev.type === 'audio');
  assert.ok(audio, 'debe emitir audio');
  assert.ok(audio.at >= 190 && audio.at < 600, `retraso medido ${audio.at} ms`);
  assert.equal(audio.ev.type === 'audio' ? audio.ev.pcm.length : 0, 2400);
});
