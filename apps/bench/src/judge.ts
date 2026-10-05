import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '@voice-traductor/engines';
import type { Reference, ReferenceSegment } from './transcribe.js';
import { fmtClock, fmtSec, median, percentile } from './util.js';

/**
 * Juez automático: alinea cada frase traducida con los segmentos del original
 * (transcripción de referencia con tiempos) y la califica por significado.
 * De la alineación sale el retraso exacto "frase dicha → frase escuchada".
 */
export interface JudgeOptions {
  runDir: string;
  reference: Reference;
  apiKey: string;
  model: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  windowSec?: number;
  log?: (line: string) => void;
}

export interface TargetSentence {
  id: number;
  /** Momento en que el oyente empieza a oír la frase (ms). */
  heardMs: number;
  text: string;
}

export interface JudgeItem {
  target_id: number;
  source_ids: number[];
  score: number;
  errors: string[];
  note?: string;
  heardMs?: number;
  sourceEndMs?: number | null;
  lagMs?: number | null;
  text?: string;
}

export interface JudgeResult {
  model: string;
  sentences: number;
  scored: number;
  meanScore: number | null;
  distribution: Record<string, number>;
  shareAtLeast4: number | null;
  critical: JudgeItem[];
  errorCounts: Record<string, number>;
  lag: { aligned: number; medianMs: number | null; p90Ms: number | null; p95Ms: number | null };
  omittedSource: ReferenceSegment[];
  items: JudgeItem[];
}

const SENTENCE_END = /([.!?…]+["”)]?)(\s+)/g;

/** Reconstruye frases a partir de los fragmentos de subtítulo con tiempo. */
export function sentencesFromDeltas(deltas: Array<{ t: number; playRef: number; text: string }>): TargetSentence[] {
  const out: TargetSentence[] = [];
  let buffer = '';
  let startAt: number | null = null;
  for (const d of deltas) {
    if (startAt === null && d.text.trim()) startAt = Math.max(d.playRef, d.t);
    buffer += d.text;
    let m: RegExpExecArray | null;
    let consumed = 0;
    SENTENCE_END.lastIndex = 0;
    while ((m = SENTENCE_END.exec(buffer))) {
      const end = m.index + m[1].length;
      const text = buffer.slice(consumed, end).trim();
      if (text) out.push({ id: out.length + 1, heardMs: startAt ?? Math.max(d.playRef, d.t), text });
      consumed = end + m[2].length;
      startAt = Math.max(d.playRef, d.t);
    }
    buffer = buffer.slice(consumed);
    if (!buffer.trim()) startAt = null;
  }
  if (buffer.trim()) out.push({ id: out.length + 1, heardMs: startAt ?? 0, text: buffer.trim() });
  return out;
}

export async function judgeRun(o: JudgeOptions): Promise<JudgeResult> {
  const log = o.log ?? (() => {});
  const deltasPath = join(o.runDir, 'transcripcion_traduccion.jsonl');
  if (!existsSync(deltasPath)) throw new Error(`No existe ${deltasPath}`);
  const deltas = readFileSync(deltasPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { t: number; playRef: number; text: string });
  const sentences = sentencesFromDeltas(deltas);
  if (!sentences.length) throw new Error('La corrida no tiene subtítulos traducidos que juzgar');
  const windowMs = (o.windowSec ?? 240) * 1000;
  const lastMs = Math.max(sentences[sentences.length - 1].heardMs, o.reference.segments[o.reference.segments.length - 1]?.end ?? 0);
  const items: JudgeItem[] = [];
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const refById = new Map(o.reference.segments.map((s) => [s.id, s]));

  for (let ws = 0; ws <= lastMs; ws += windowMs) {
    const we = ws + windowMs;
    const targets = sentences.filter((s) => s.heardMs >= ws && s.heardMs < we);
    if (!targets.length) continue;
    const sources = o.reference.segments.filter((s) => s.end >= ws - 25_000 && s.start < we);
    log(`Juzgando ${fmtClock(ws)} a ${fmtClock(we)}: ${targets.length} frases traducidas, ${sources.length} segmentos de referencia...`);
    const result = await askJudge(o, sources, targets);
    for (const it of result) {
      const s = byId.get(it.target_id);
      if (!s) continue;
      const ends = it.source_ids.map((id) => refById.get(id)?.end).filter((v): v is number => typeof v === 'number');
      const sourceEndMs = ends.length ? Math.max(...ends) : null;
      items.push({ ...it, heardMs: s.heardMs, sourceEndMs, lagMs: sourceEndMs === null ? null : s.heardMs - sourceEndMs, text: s.text });
    }
  }

  const scored = items.filter((i) => i.score >= 1 && i.score <= 5);
  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const i of scored) distribution[String(Math.round(i.score))]++;
  const errorCounts: Record<string, number> = {};
  for (const i of items) for (const e of i.errors ?? []) errorCounts[e] = (errorCounts[e] ?? 0) + 1;
  const lags = items.map((i) => i.lagMs).filter((v): v is number => typeof v === 'number' && v > -2000 && v < 30_000).sort((a, b) => a - b);
  const covered = new Set(items.flatMap((i) => i.source_ids));
  const omitted = o.reference.segments.filter((s) => !covered.has(s.id) && s.text.split(/\s+/).length >= 4);

  const result: JudgeResult = {
    model: o.model,
    sentences: sentences.length,
    scored: scored.length,
    meanScore: scored.length ? scored.reduce((a, i) => a + i.score, 0) / scored.length : null,
    distribution,
    shareAtLeast4: scored.length ? scored.filter((i) => i.score >= 4).length / scored.length : null,
    critical: items.filter((i) => i.score <= 2),
    errorCounts,
    lag: { aligned: lags.length, medianMs: lags.length ? median(lags) : null, p90Ms: lags.length ? percentile(lags, 0.9) : null, p95Ms: lags.length ? percentile(lags, 0.95) : null },
    omittedSource: omitted,
    items,
  };
  writeFileSync(join(o.runDir, 'juez.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(o.runDir, 'juez.md'), renderJudge(result));
  return result;
}

async function askJudge(o: JudgeOptions, sources: ReferenceSegment[], targets: TargetSentence[]): Promise<JudgeItem[]> {
  const src = o.sourceLanguage ?? o.reference.language ?? 'the source language';
  const tgt = o.targetLanguage ?? 'the target language';
  const system = [
    `You evaluate live AI interpretation of a church sermon from ${src} into ${tgt}.`,
    'You receive SOURCE segments (reference transcript with ids and times) and TARGET sentences (what listeners heard, with ids).',
    'For EVERY target sentence, return which source segment ids it translates (may be several, or none if it is not a translation of anything provided).',
    'Score meaning preservation 1-5: 5 = meaning fully preserved including names, numbers and scripture references; 4 = minor wording issues, meaning intact; 3 = partial loss or ambiguity; 2 = significant error that changes meaning; 1 = wrong, opposite, or invented content.',
    'Error tags (use any that apply): omission, mistranslation, hallucination, name_or_reference, number, tone, untranslated, fragment.',
    'Judge meaning, not wording. Sermons quote scripture: a reference like "Juan 3:16" must become "John 3:16".',
    'Respond ONLY with JSON: {"items":[{"target_id":1,"source_ids":[12],"score":5,"errors":[],"note":"optional short note"}]}',
  ].join(' ');
  const user = [
    'SOURCE segments:',
    ...sources.map((s) => `[${s.id} @${(s.start / 1000).toFixed(1)}-${(s.end / 1000).toFixed(1)}s] ${s.text}`),
    '',
    'TARGET sentences:',
    ...targets.map((t) => `[${t.id} @${(t.heardMs / 1000).toFixed(1)}s] ${t.text}`),
  ].join('\n');
  const body = { model: o.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(content) as { items?: JudgeItem[] };
      return (parsed.items ?? []).map((i) => ({
        target_id: Number(i.target_id),
        source_ids: Array.isArray(i.source_ids) ? i.source_ids.map(Number).filter((n) => Number.isFinite(n)) : [],
        score: Number(i.score),
        errors: Array.isArray(i.errors) ? i.errors.map(String) : [],
        note: typeof i.note === 'string' ? i.note : undefined,
      }));
    }
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(3000 * attempt);
      continue;
    }
    throw new Error(`Juez (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }
}

export function renderJudge(r: JudgeResult): string {
  const l: string[] = [];
  l.push(`# Juez automático (${r.model})`, '');
  l.push(`- Frases traducidas: ${r.sentences}; calificadas: ${r.scored}.`);
  l.push(`- Puntaje medio: ${r.meanScore === null ? '-' : r.meanScore.toFixed(2)} de 5. Frases con 4 o más: ${r.shareAtLeast4 === null ? '-' : Math.round(r.shareAtLeast4 * 100) + '%'}.`);
  l.push(`- Distribución: ${Object.entries(r.distribution).map(([k, v]) => `${k}★ ${v}`).join(', ')}.`);
  l.push(`- Errores por tipo: ${Object.entries(r.errorCounts).map(([k, v]) => `${k} ${v}`).join(', ') || 'ninguno'}.`);
  l.push(`- Retraso frase dicha → frase escuchada (alineación exacta): mediana ${fmtSec(r.lag.medianMs)}, p90 ${fmtSec(r.lag.p90Ms)}, p95 ${fmtSec(r.lag.p95Ms)} sobre ${r.lag.aligned} frases.`);
  l.push(`- Segmentos del original sin traducción detectada: ${r.omittedSource.length}.`, '');
  if (r.critical.length) {
    l.push('## Frases con puntaje 1 o 2', '');
    for (const c of r.critical) l.push(`- [${fmtClock(c.heardMs ?? 0)}] (${c.score}) "${c.text}" — fuentes ${c.source_ids.join(', ') || 'ninguna'}; ${c.errors.join(', ')}${c.note ? '; ' + c.note : ''}`);
    l.push('');
  }
  if (r.omittedSource.length) {
    l.push('## Original sin traducir (posibles omisiones)', '');
    for (const s of r.omittedSource.slice(0, 40)) l.push(`- [${fmtClock(s.start)}] ${s.text}`);
    if (r.omittedSource.length > 40) l.push(`- ... y ${r.omittedSource.length - 40} más`);
    l.push('');
  }
  return l.join('\n');
}
