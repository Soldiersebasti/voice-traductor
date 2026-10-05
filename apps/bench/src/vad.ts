/**
 * Detector de voz por energía. No pretende ser perfecto: sirve para encontrar
 * los límites de frase (pausas) en el audio original y en el traducido, que es
 * lo que anclan las métricas de retraso.
 */
export interface Segment {
  start: number; // ms
  end: number; // ms
}

export interface VadOptions {
  frameMs?: number;
  /** Umbral fijo en dBFS. Si no se da, se calcula a partir del piso de ruido. */
  thresholdDb?: number;
  /** Huecos menores a esto se fusionan (ms). */
  mergeGapMs?: number;
  /** Segmentos menores a esto se descartan (ms). */
  minSegmentMs?: number;
}

export function detectSpeech(pcm: Int16Array, rate: number, o: VadOptions = {}): Segment[] {
  const frameMs = o.frameMs ?? 20;
  const frame = Math.max(1, Math.round((rate * frameMs) / 1000));
  const nF = Math.floor(pcm.length / frame);
  if (nF === 0) return [];
  const db = new Float64Array(nF);
  for (let f = 0; f < nF; f++) {
    let acc = 0;
    const base = f * frame;
    for (let i = 0; i < frame; i++) {
      const v = pcm[base + i] / 32768;
      acc += v * v;
    }
    db[f] = 20 * Math.log10(Math.sqrt(acc / frame) + 1e-9);
  }
  let thr = o.thresholdDb;
  if (thr === undefined) {
    const sorted = Float64Array.from(db).sort();
    const floor = sorted[Math.floor(sorted.length * 0.1)];
    thr = Math.min(-38, Math.max(-65, floor + 10));
  }
  const mergeGap = o.mergeGapMs ?? 300;
  const minSeg = o.minSegmentMs ?? 250;
  const raw: Segment[] = [];
  let cur: Segment | null = null;
  for (let f = 0; f < nF; f++) {
    const t = f * frameMs;
    if (db[f] > thr) {
      if (cur && t - cur.end <= mergeGap) cur.end = t + frameMs;
      else {
        if (cur) raw.push(cur);
        cur = { start: t, end: t + frameMs };
      }
    }
  }
  if (cur) raw.push(cur);
  return raw.filter((s) => s.end - s.start >= minSeg);
}

export function totalMs(segs: Segment[]): number {
  return segs.reduce((a, s) => a + (s.end - s.start), 0);
}

/** Milisegundos de `segs` que caen dentro de [from, to]. */
export function overlapMs(segs: Segment[], from: number, to: number): number {
  let acc = 0;
  for (const s of segs) {
    const a = Math.max(from, s.start);
    const b = Math.min(to, s.end);
    if (b > a) acc += b - a;
  }
  return acc;
}
