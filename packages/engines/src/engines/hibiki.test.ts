import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocketServer, type WebSocket } from 'ws';
import { HibikiEngine } from './hibiki.js';
import type { EngineEvent } from '../types.js';

/** Puente simulado: responde `ready` al `start`, devuelve el audio con retraso y un token de texto. */
function fakeBridge(o: { delayMs: number; closeAfterChunks?: number }): Promise<{ port: number; close: () => void; starts: () => number }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    let starts = 0;
    let closedOnce = false;
    wss.on('connection', (ws: WebSocket) => {
      let chunks = 0;
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { type: string; pcm?: string };
        if (msg.type === 'start') {
          starts++;
          chunks = 0;
          setTimeout(() => ws.send(JSON.stringify({ type: 'ready' })), 20);
        } else if (msg.type === 'audio') {
          chunks++;
          if (o.closeAfterChunks && !closedOnce && chunks === o.closeAfterChunks) {
            closedOnce = true;
            ws.send(JSON.stringify({ type: 'closed', code: 1000, reason: 'simulado' }));
            return;
          }
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'audio', pcm: msg.pcm }));
            ws.send(JSON.stringify({ type: 'text', text: ' hello' }));
          }, o.delayMs);
        }
      });
    });
    wss.on('listening', () => {
      const addr = wss.address();
      resolve({ port: typeof addr === 'object' && addr ? addr.port : 0, close: () => wss.close(), starts: () => starts });
    });
  });
}

test('HibikiEngine: saludo, audio con retraso y texto a través del puente', async () => {
  const bridge = await fakeBridge({ delayMs: 150 });
  try {
    const engine = new HibikiEngine({ targetLanguage: 'en', bridgeUrl: `ws://127.0.0.1:${bridge.port}`, tailMs: 300 });
    const events: Array<{ at: number; ev: EngineEvent }> = [];
    const t0 = Date.now();
    engine.on((ev) => events.push({ at: Date.now() - t0, ev }));
    await engine.start();
    engine.sendAudio(new Int16Array(2400).fill(1000));
    await engine.finish({ timeoutMs: 3000 });
    await engine.stop();
    const audio = events.find((e) => e.ev.type === 'audio');
    assert.ok(audio, 'debe recibir audio');
    assert.ok(audio.at >= 140, `retraso ${audio.at}`);
    assert.equal(audio.ev.type === 'audio' ? audio.ev.pcm[0] : 0, 1000);
    assert.ok(events.some((e) => e.ev.type === 'transcript' && e.ev.text === ' hello'));
    assert.ok(events.some((e) => e.ev.type === 'status' && e.ev.code === 'session.ready'));
  } finally {
    bridge.close();
  }
});

test('HibikiEngine: si Hibiki cierra la sesión, abre otra y lo registra como reconexión', async () => {
  const bridge = await fakeBridge({ delayMs: 50, closeAfterChunks: 2 });
  try {
    const engine = new HibikiEngine({ targetLanguage: 'en', bridgeUrl: `ws://127.0.0.1:${bridge.port}`, tailMs: 0 });
    const codes: string[] = [];
    engine.on((ev) => {
      if (ev.type === 'status') codes.push(ev.code);
    });
    await engine.start();
    for (let i = 0; i < 4; i++) {
      engine.sendAudio(new Int16Array(2400));
      await new Promise((r) => setTimeout(r, 120));
    }
    await engine.finish({ timeoutMs: 2500 });
    await engine.stop();
    assert.ok(codes.includes('session.closed_unexpectedly'));
    assert.ok(codes.includes('session.reconnected'));
    assert.equal(bridge.starts(), 2);
  } finally {
    bridge.close();
  }
});

test('HibikiEngine rechaza un idioma destino distinto de inglés', () => {
  assert.throws(() => new HibikiEngine({ targetLanguage: 'es' }), /solo traduce a inglés/);
});
