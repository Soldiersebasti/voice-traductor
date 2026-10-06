import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocketServer, type WebSocket } from 'ws';
import { base64FromInt16 } from '../audio/pcm.js';
import { QwenLiveTranslateEngine } from './qwen-livetranslate.js';
import type { EngineEvent } from '../types.js';

interface FakeOptions {
  delayMs: number;
  /** Cerrar la conexión (una sola vez) al recibir este fragmento. */
  closeAfterChunks?: number;
  /** Responder `session.finished` a `session.finish`. Por defecto sí. */
  replyFinished?: boolean;
}

/** Servidor simulado con el protocolo Realtime de Model Studio: created/updated, VAD, audio y texto, finish/finished. */
function fakeQwen(o: FakeOptions): Promise<{ port: number; close: () => void; connections: () => number; updates: () => Record<string, unknown>[]; headers: () => Record<string, string | undefined>[] }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    let connections = 0;
    let closedOnce = false;
    const updates: Record<string, unknown>[] = [];
    const headers: Record<string, string | undefined>[] = [];
    wss.on('connection', (ws: WebSocket, req) => {
      connections++;
      headers.push({ authorization: req.headers.authorization, url: req.url });
      let chunks = 0;
      ws.send(JSON.stringify({ event_id: 'e1', type: 'session.created', session: { id: `sess_${connections}`, input_audio_format: 'pcm', output_audio_format: 'pcm' } }));
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { type: string; session?: Record<string, unknown>; audio?: string };
        if (msg.type === 'session.update') {
          updates.push(msg.session ?? {});
          ws.send(JSON.stringify({ event_id: 'e2', type: 'session.updated', session: msg.session }));
        } else if (msg.type === 'input_audio_buffer.append') {
          chunks++;
          if (o.closeAfterChunks && !closedOnce && chunks === o.closeAfterChunks) {
            closedOnce = true;
            ws.close(1011, 'simulado');
            return;
          }
          if (chunks === 2) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.speech_started', audio_start_ms: 0, item_id: 'item_1' }));
            ws.send(JSON.stringify({ type: 'response.created', response: { id: 'resp_1' } }));
            const audio = msg.audio;
            setTimeout(() => {
              if (ws.readyState !== ws.OPEN) return;
              ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: ' hola' }));
              ws.send(JSON.stringify({ type: 'response.audio.delta', delta: audio }));
              ws.send(JSON.stringify({ type: 'response.audio_transcript.delta', delta: ' hello' }));
              ws.send(JSON.stringify({ type: 'response.audio.done' }));
              ws.send(JSON.stringify({ type: 'response.audio_transcript.done', transcript: ' hello' }));
              ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: ' hola' }));
              ws.send(JSON.stringify({ type: 'response.done', response: { id: 'resp_1', usage: { total_tokens: 15, input_tokens: 10, output_tokens: 5, input_tokens_details: { audio_tokens: 7, text_tokens: 3 }, output_tokens_details: { audio_tokens: 4, text_tokens: 1 } } } }));
            }, o.delayMs);
          }
        } else if (msg.type === 'session.finish') {
          if (o.replyFinished !== false) setTimeout(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'session.finished' })), 30);
        }
      });
    });
    wss.on('listening', () => {
      const addr = wss.address();
      resolve({ port: typeof addr === 'object' && addr ? addr.port : 0, close: () => wss.close(), connections: () => connections, updates: () => updates, headers: () => headers });
    });
  });
}

test('QwenLiveTranslateEngine: configura la sesión, recibe audio y texto, cierra con session.finish', async () => {
  const srv = await fakeQwen({ delayMs: 150 });
  try {
    const engine = new QwenLiveTranslateEngine({ apiKey: 'sk-test', targetLanguage: 'en', sourceLanguageHint: 'es', url: `ws://127.0.0.1:${srv.port}` });
    const events: Array<{ at: number; ev: EngineEvent }> = [];
    const t0 = Date.now();
    engine.on((ev) => events.push({ at: Date.now() - t0, ev }));
    await engine.start();
    engine.sendAudio(new Int16Array(1600).fill(1000));
    engine.sendAudio(new Int16Array(1600).fill(1000));
    engine.sendAudio(new Int16Array(1600));
    await engine.finish({ timeoutMs: 3000 });
    await engine.stop();

    // Conexión: modelo en la URL y clave en la cabecera.
    const h = srv.headers()[0];
    assert.equal(h.authorization, 'Bearer sk-test');
    assert.ok(h.url?.includes('model=qwen3.8-livetranslate-flash-realtime'), h.url);

    // session.update con idioma destino, audio y transcripción del original.
    const upd = srv.updates()[0];
    assert.deepEqual(upd.translation, { language: 'en' });
    assert.deepEqual(upd.modalities, ['text', 'audio']);
    assert.equal(upd.input_audio_format, 'pcm');
    assert.deepEqual(upd.input_audio_transcription, { model: 'qwen3-asr-flash-realtime', language: 'es' });

    const audio = events.find((e) => e.ev.type === 'audio');
    assert.ok(audio, 'debe recibir audio');
    assert.ok(audio.at >= 140, `retraso ${audio.at}`);
    assert.equal(audio.ev.type === 'audio' ? audio.ev.pcm[0] : 0, 1000);
    assert.equal(audio.ev.type === 'audio' ? audio.ev.sampleRate : 0, 24000);
    assert.ok(events.some((e) => e.ev.type === 'transcript' && e.ev.channel === 'target' && e.ev.text === ' hello' && !e.ev.final));
    assert.ok(events.some((e) => e.ev.type === 'transcript' && e.ev.channel === 'target' && e.ev.final));
    assert.ok(events.some((e) => e.ev.type === 'transcript' && e.ev.channel === 'source' && e.ev.text === ' hola'));

    const codes = events.filter((e) => e.ev.type === 'status').map((e) => (e.ev.type === 'status' ? e.ev.code : ''));
    for (const c of ['session.opened', 'session.ready', 'audio.first_output', 'session.finished', 'session.usage', 'session.closed']) assert.ok(codes.includes(c), `falta ${c} en ${codes.join(',')}`);
    assert.ok(!codes.includes('session.closed_unexpectedly'));
    assert.ok(!codes.includes('session.finish_unconfirmed'));

    const ready = events.find((e) => e.ev.type === 'status' && e.ev.code === 'session.ready');
    assert.equal((ready?.ev as { data?: { confirmed?: boolean } }).data?.confirmed, true);
    const usage = events.find((e) => e.ev.type === 'status' && e.ev.code === 'session.usage');
    const u = (usage?.ev as { data?: Record<string, number> }).data ?? {};
    assert.equal(u.inputTokens, 10);
    assert.equal(u.inputAudioTokens, 7);
    assert.equal(u.outputAudioTokens, 4);
    assert.equal(u.responses, 1);

    // Cada fragmento enviado queda registrado con su momento exacto, sin el audio.
    const sends = events.filter((e) => e.ev.type === 'raw' && e.ev.direction === 'out' && (e.ev.payload as { type?: string }).type === 'input_audio_buffer.append');
    assert.equal(sends.length, 3);
    const p = sends[2].ev.type === 'raw' ? (sends[2].ev.payload as { seq: number; audioMs: number; sentAt: number; audio?: string }) : null;
    assert.equal(p?.seq, 3);
    assert.equal(p?.audioMs, 300);
    assert.ok(typeof p?.sentAt === 'number' && p.sentAt >= t0);
    assert.equal(p?.audio, undefined);
    assert.ok(events.some((e) => e.ev.type === 'raw' && e.ev.direction === 'out' && (e.ev.payload as { type?: string }).type === 'session.finish'));
    // Los eventos del VAD del servidor quedan como raw de entrada.
    assert.ok(events.some((e) => e.ev.type === 'raw' && e.ev.direction === 'in' && (e.ev.payload as { type?: string }).type === 'input_audio_buffer.speech_started'));
  } finally {
    srv.close();
  }
});

test('QwenLiveTranslateEngine: si el servidor cierra, reconecta y lo registra', async () => {
  const srv = await fakeQwen({ delayMs: 30, closeAfterChunks: 3 });
  try {
    const engine = new QwenLiveTranslateEngine({ apiKey: 'sk-test', targetLanguage: 'en', url: `ws://127.0.0.1:${srv.port}`, rttEveryMs: 0 });
    const codes: string[] = [];
    engine.on((ev) => {
      if (ev.type === 'status') codes.push(ev.code);
    });
    await engine.start();
    for (let i = 0; i < 6; i++) {
      engine.sendAudio(new Int16Array(1600).fill(500));
      await new Promise((r) => setTimeout(r, 100));
    }
    await engine.finish({ timeoutMs: 2000 });
    await engine.stop();
    assert.ok(codes.includes('session.closed_unexpectedly'), codes.join(','));
    assert.ok(codes.includes('session.reconnecting'));
    assert.ok(codes.includes('session.reconnected'));
    assert.equal(srv.connections(), 2);
    assert.equal(srv.updates().length, 2, 'la sesión nueva vuelve a configurarse');
  } finally {
    srv.close();
  }
});

test('QwenLiveTranslateEngine: sin session.finished, finish termina por tiempo y lo deja registrado', async () => {
  const srv = await fakeQwen({ delayMs: 30, replyFinished: false });
  try {
    const engine = new QwenLiveTranslateEngine({ apiKey: 'sk-test', targetLanguage: 'en', url: `ws://127.0.0.1:${srv.port}`, rttEveryMs: 0 });
    const codes: string[] = [];
    engine.on((ev) => {
      if (ev.type === 'status') codes.push(ev.code);
    });
    await engine.start();
    engine.sendAudio(new Int16Array(1600).fill(500));
    const t = Date.now();
    await engine.finish({ timeoutMs: 1200 });
    const took = Date.now() - t;
    await engine.stop();
    assert.ok(codes.includes('session.finish_unconfirmed'), codes.join(','));
    assert.ok(took >= 1200 && took < 4000, `tardó ${took} ms`);
  } finally {
    srv.close();
  }
});

test('QwenLiveTranslateEngine: sin modalidad de audio pide solo texto y acepta sobrescrituras', async () => {
  const srv = await fakeQwen({ delayMs: 10 });
  try {
    const engine = new QwenLiveTranslateEngine({ apiKey: 'sk-test', targetLanguage: 'en', url: `ws://127.0.0.1:${srv.port}`, audioOutput: false, voice: 'Tina', inputTranscription: false, rttEveryMs: 0, extra: { turn_detection: { type: 'server_vad' } } });
    await engine.start();
    await engine.stop();
    const upd = srv.updates()[0];
    assert.deepEqual(upd.modalities, ['text']);
    assert.equal(upd.voice, 'Tina');
    assert.equal(upd.input_audio_transcription, undefined);
    assert.deepEqual(upd.turn_detection, { type: 'server_vad' });
  } finally {
    srv.close();
  }
});

test('QwenLiveTranslateEngine exige la clave de Model Studio', () => {
  assert.throws(() => new QwenLiveTranslateEngine({ apiKey: '', targetLanguage: 'en' }), /DASHSCOPE_API_KEY/);
});

test('QwenLiveTranslateEngine: base64 de 16 kHz ida y vuelta', () => {
  const pcm = new Int16Array([1, -1, 32767, -32768]);
  assert.equal(base64FromInt16(pcm).length > 0, true);
});
