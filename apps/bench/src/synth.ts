import { writeWav } from '@voice-traductor/engines';

/**
 * Genera "habla" sintética: ráfagas de ruido moduladas a ritmo de sílaba,
 * separadas por pausas. No suena a voz, pero tiene la misma envolvente y
 * permite probar el banco y validar las métricas sin material real.
 */
export interface SynthOptions {
  seconds: number;
  rate?: number;
  phraseMs?: number;
  pauseMs?: number;
  /** Variación aleatoria de duración de frase y pausa (0 a 1). */
  jitter?: number;
  seed?: number;
}

export interface SynthResult {
  pcm: Int16Array;
  phrases: Array<{ start: number; end: number }>;
}

export function synthSpeech(o: SynthOptions): SynthResult {
  const rate = o.rate ?? 16000;
  const total = Math.round(o.seconds * rate);
  const pcm = new Int16Array(total);
  let seed = o.seed ?? 42;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const jitter = o.jitter ?? 0.3;
  const phraseMs = o.phraseMs ?? 3500;
  const pauseMs = o.pauseMs ?? 1200;
  const phrases: SynthResult['phrases'] = [];
  // Piso de ruido muy bajo en todo el archivo (≈ -66 dBFS)
  for (let i = 0; i < total; i++) pcm[i] = Math.round((rnd() * 2 - 1) * 16);
  let t = 400;
  while (t < o.seconds * 1000 - 200) {
    const dur = Math.round(phraseMs * (1 + (rnd() * 2 - 1) * jitter));
    const start = Math.round((t / 1000) * rate);
    const end = Math.min(total, Math.round(((t + dur) / 1000) * rate));
    for (let i = start; i < end; i++) {
      const sec = i / rate;
      const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * sec); // 4 sílabas por segundo
      const tone = Math.sin(2 * Math.PI * 180 * sec) * 0.5 + (rnd() * 2 - 1) * 0.5;
      pcm[i] = Math.round(tone * syllable * 0.35 * 32767);
    }
    phrases.push({ start: t, end: t + (end - start) / rate * 1000 });
    t += dur + Math.round(pauseMs * (1 + (rnd() * 2 - 1) * jitter));
  }
  return { pcm, phrases };
}

export function writeSynthWav(path: string, o: SynthOptions): SynthResult {
  const r = synthSpeech(o);
  writeWav(path, [r.pcm], o.rate ?? 16000);
  return r;
}
