/** Utilidades PCM16 mono little-endian. */

export function int16FromBase64(b64: string): Int16Array {
  const buf = Buffer.from(b64, 'base64');
  const n = buf.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

export function base64FromInt16(pcm: Int16Array): string {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64');
}

export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768;
    acc += v * v;
  }
  return Math.sqrt(acc / pcm.length);
}

/** Nivel en dBFS (0 dBFS = escala completa). Silencio digital ≈ -180. */
export function dbfs(pcm: Int16Array): number {
  return 20 * Math.log10(rms(pcm) + 1e-9);
}

export function silence(samples: number): Int16Array {
  return new Int16Array(Math.max(0, Math.floor(samples)));
}

export function msToSamples(ms: number, rate: number): number {
  return Math.round((ms / 1000) * rate);
}

export function samplesToMs(samples: number, rate: number): number {
  return (samples / rate) * 1000;
}

export function concatInt16(parts: Int16Array[]): Int16Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Int16Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

type Plain = Record<string, unknown>;

/** Fusión profunda de objetos planos. Los arreglos y valores primitivos se reemplazan. */
export function deepMerge<T extends Plain>(target: T, source?: Plain): T {
  if (!source) return target;
  for (const [k, v] of Object.entries(source)) {
    const cur = (target as Plain)[k];
    if (isPlain(v) && isPlain(cur)) {
      deepMerge(cur, v);
    } else {
      (target as Plain)[k] = v;
    }
  }
  return target;
}

function isPlain(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Int16Array);
}

/** Convierte duraciones tipo protobuf ("12.5s") a milisegundos. */
export function parseDurationMs(v: unknown): number | null {
  if (typeof v === 'number') return v * 1000;
  if (typeof v !== 'string') return null;
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(v.trim());
  return m ? Math.round(parseFloat(m[1]) * 1000) : null;
}
