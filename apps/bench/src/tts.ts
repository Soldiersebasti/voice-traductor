import { writeFileSync } from 'node:fs';
import { parseWav, resampleLinear, sleep, toMono, writeWav } from '@voice-traductor/engines';
import type { PhraseManifest, PhraseSpec } from './phrases.js';
import { detectSpeech } from './vad.js';

/**
 * Construye el audio de la prueba interactiva con voz sintética: cada frase del
 * guion separada por un silencio largo, y un manifiesto con el instante exacto
 * en que empieza y termina cada una. Sirve para una medición repetible; la
 * versión con la voz real del pastor se hace grabando el mismo guion.
 */
export interface SynthesizeOptions {
  phrases: string[];
  out: string;
  apiKey: string;
  gapMs?: number;
  leadMs?: number;
  rate?: number;
  voice?: string;
  model?: string;
  instructions?: string;
  mode?: 'aislado' | 'continuo';
  log?: (line: string) => void;
}

export async function synthesizePhraseFile(o: SynthesizeOptions): Promise<PhraseManifest> {
  const log = o.log ?? (() => {});
  const rate = o.rate ?? 24000;
  const gapMs = o.gapMs ?? 6000;
  const leadMs = o.leadMs ?? 1500;
  const parts: Int16Array[] = [new Int16Array(Math.round((leadMs / 1000) * rate))];
  const phrases: PhraseSpec[] = [];
  let posMs = leadMs;
  for (let i = 0; i < o.phrases.length; i++) {
    const text = o.phrases[i];
    log(`Sintetizando ${i + 1}/${o.phrases.length}: ${text}`);
    const clip = await ttsClip(text, o, rate);
    const speech = detectSpeech(clip, rate, { thresholdDb: -45, mergeGapMs: 500 });
    const clipMs = (clip.length / rate) * 1000;
    const start = speech.length ? speech[0].start : 0;
    const end = speech.length ? speech[speech.length - 1].end : clipMs;
    phrases.push({ id: i + 1, text, startMs: Math.round(posMs + start), endMs: Math.round(posMs + end) });
    parts.push(clip, new Int16Array(Math.round((gapMs / 1000) * rate)));
    posMs += clipMs + gapMs;
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const pcm = new Int16Array(total);
  let off = 0;
  for (const p of parts) {
    pcm.set(p, off);
    off += p.length;
  }
  writeWav(o.out, [pcm], rate);
  const manifest: PhraseManifest = { source: o.out, createdAt: new Date().toISOString(), gapMs, mode: o.mode ?? 'aislado', phrases };
  writeFileSync(manifestPathFor(o.out), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function manifestPathFor(wavPath: string): string {
  return wavPath.replace(/\.wav$/i, '') + '.manifest.json';
}

async function ttsClip(text: string, o: SynthesizeOptions, rate: number): Promise<Int16Array> {
  const body: Record<string, unknown> = {
    model: o.model ?? 'gpt-4o-mini-tts',
    voice: o.voice ?? 'onyx',
    input: text,
    response_format: 'wav',
  };
  if (o.instructions !== '') body.instructions = o.instructions ?? 'Habla en español latino, como un pastor dirigiéndose a la congregación durante un servicio: con energía, claro y natural.';
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const wav = parseWav(Buffer.from(await res.arrayBuffer()));
      return resampleLinear(toMono(wav), wav.sampleRate, rate);
    }
    const detail = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * attempt);
      continue;
    }
    throw new Error(`TTS falló (HTTP ${res.status}): ${detail.slice(0, 300)}`);
  }
}
