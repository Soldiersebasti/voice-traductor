import { readFileSync } from 'node:fs';
import type { TranscriptRec } from './metrics.js';
import { median, percentile } from './util.js';
import { detectSpeech } from './vad.js';

/**
 * Prueba de frases cortas e interactivas ("aplaudan", "repitan conmigo",
 * preguntas, instrucciones). Cada frase está aislada por silencios largos, así
 * que su traducción se identifica sin ambigüedad y el retraso se mide exacto:
 * desde que el pastor termina de decirla hasta que el oyente termina de oírla.
 */
export interface PhraseSpec {
  id: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface PhraseManifest {
  source: string;
  createdAt: string;
  gapMs: number;
  phrases: PhraseSpec[];
}

export interface PhraseResult extends PhraseSpec {
  durationMs: number;
  outStartMs: number | null;
  outEndMs: number | null;
  /** Fin de la frase dicha → inicio de la traducción. */
  startLagMs: number | null;
  /** Fin de la frase dicha → fin de la traducción. La cifra que decide. */
  endLagMs: number | null;
  /** Inicio de la frase dicha → inicio de la traducción. */
  startToStartMs: number | null;
  heardText: string;
  /** true: dentro del umbral; false: fuera; null: no hubo traducción. */
  ok: boolean | null;
}

export interface PhraseStats {
  thresholdMs: number;
  total: number;
  answered: number;
  passed: number;
  passRate: number | null;
  endLag: { medianMs: number | null; p90Ms: number | null; maxMs: number | null };
  startLag: { medianMs: number | null; p90Ms: number | null; maxMs: number | null };
  results: PhraseResult[];
}

export function loadPhraseList(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export function loadManifest(path: string): PhraseManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PhraseManifest;
}

/**
 * Para grabaciones propias del guion: encuentra las frases por los silencios
 * largos entre ellas y las empareja en orden con el texto del guion.
 */
export function detectPhrasesByVad(source: Int16Array, rate: number, texts: string[] = [], o: { minGapMs?: number; thresholdDb?: number } = {}): PhraseSpec[] {
  const segs = detectSpeech(source, rate, { mergeGapMs: o.minGapMs ?? 1500, minSegmentMs: 200, ...(o.thresholdDb !== undefined ? { thresholdDb: o.thresholdDb } : {}) });
  return segs.map((s, i) => ({ id: i + 1, text: texts[i] ?? `(frase ${i + 1})`, startMs: s.start, endMs: s.end }));
}

export function evaluatePhrases(phrases: PhraseSpec[], output: Int16Array, outRate: number, transcripts: TranscriptRec[], thresholdMs: number, vadThresholdDb?: number): PhraseStats {
  const out = detectSpeech(output, outRate, { mergeGapMs: 400, ...(vadThresholdDb !== undefined ? { thresholdDb: vadThresholdDb } : {}) });
  const results: PhraseResult[] = phrases.map((p, i) => {
    const winStart = p.startMs + 100;
    const winEnd = i + 1 < phrases.length ? phrases[i + 1].startMs + 100 : p.endMs + 15_000;
    const segs = out.filter((s) => s.start >= winStart && s.start < winEnd);
    const heardText = transcripts
      .filter((t) => t.channel === 'target' && !t.final && t.playRef >= winStart - 500 && t.playRef < winEnd + 1500)
      .map((t) => t.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    const base = { ...p, durationMs: p.endMs - p.startMs, heardText };
    if (!segs.length) return { ...base, outStartMs: null, outEndMs: null, startLagMs: null, endLagMs: null, startToStartMs: null, ok: null };
    const outStart = segs[0].start;
    const outEnd = segs[segs.length - 1].end;
    const endLag = outEnd - p.endMs;
    return { ...base, outStartMs: outStart, outEndMs: outEnd, startLagMs: outStart - p.endMs, endLagMs: endLag, startToStartMs: outStart - p.startMs, ok: endLag <= thresholdMs };
  });
  const answered = results.filter((r) => r.endLagMs !== null);
  const endLags = answered.map((r) => r.endLagMs as number).sort((a, b) => a - b);
  const startLags = answered.map((r) => r.startLagMs as number).sort((a, b) => a - b);
  const stats = (v: number[]) => ({ medianMs: v.length ? median(v) : null, p90Ms: v.length ? percentile(v, 0.9) : null, maxMs: v.length ? v[v.length - 1] : null });
  return {
    thresholdMs,
    total: results.length,
    answered: answered.length,
    passed: results.filter((r) => r.ok === true).length,
    passRate: results.length ? results.filter((r) => r.ok === true).length / results.length : null,
    endLag: stats(endLags),
    startLag: stats(startLags),
    results,
  };
}
