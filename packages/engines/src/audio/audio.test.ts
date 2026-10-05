import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { base64FromInt16, dbfs, deepMerge, int16FromBase64, parseDurationMs } from './pcm.js';
import { resampleLinear } from './resample.js';
import { readWav, toMono, WavWriter, writeWav } from './wav.js';

test('base64 ida y vuelta conserva las muestras', () => {
  const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 1234, -4321]);
  assert.deepEqual(Array.from(int16FromBase64(base64FromInt16(pcm))), Array.from(pcm));
});

test('base64 funciona sobre vistas (subarray) con desplazamiento', () => {
  const big = Int16Array.from({ length: 10 }, (_, i) => i * 100);
  const view = big.subarray(3, 7);
  assert.deepEqual(Array.from(int16FromBase64(base64FromInt16(view))), [300, 400, 500, 600]);
});

test('dbfs: silencio muy bajo, escala completa cerca de 0', () => {
  assert.ok(dbfs(new Int16Array(100)) < -150);
  const full = new Int16Array(100).fill(32767);
  assert.ok(Math.abs(dbfs(full)) < 0.1);
});

test('resampleLinear cambia la longitud en proporción', () => {
  const pcm = new Int16Array(24000).fill(1000);
  assert.equal(resampleLinear(pcm, 24000, 16000).length, 16000);
  assert.equal(resampleLinear(pcm, 16000, 24000).length, 36000);
  assert.equal(resampleLinear(pcm, 24000, 24000), pcm);
  assert.equal(resampleLinear(pcm, 24000, 16000)[8000], 1000);
});

test('WAV: escritura incremental y lectura, mono y estéreo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wav-'));
  try {
    const mono = join(dir, 'm.wav');
    const w = new WavWriter(mono, 16000);
    w.write(Int16Array.from([1, 2, 3]));
    w.writeSilence(2);
    w.write(Int16Array.from([4]));
    w.close();
    const r = readWav(mono);
    assert.equal(r.sampleRate, 16000);
    assert.equal(r.channels, 1);
    assert.deepEqual(Array.from(r.samples), [1, 2, 3, 0, 0, 4]);

    const stereo = join(dir, 's.wav');
    writeWav(stereo, [Int16Array.from([10, 20]), Int16Array.from([30, 40, 50])], 8000);
    const s = readWav(stereo);
    assert.equal(s.channels, 2);
    assert.deepEqual(Array.from(s.samples), [10, 30, 20, 40, 0, 50]);
    assert.deepEqual(Array.from(toMono(s)), [20, 30, 25]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deepMerge fusiona objetos y reemplaza primitivos y arreglos', () => {
  const target = { a: { b: 1, c: [1, 2] }, d: 'x' };
  deepMerge(target, { a: { c: [3], e: true }, d: 'y' });
  assert.deepEqual(target, { a: { b: 1, c: [3], e: true }, d: 'y' });
});

test('parseDurationMs entiende duraciones protobuf', () => {
  assert.equal(parseDurationMs('12.5s'), 12500);
  assert.equal(parseDurationMs('3s'), 3000);
  assert.equal(parseDurationMs(undefined), null);
  assert.equal(parseDurationMs('abc'), null);
});
