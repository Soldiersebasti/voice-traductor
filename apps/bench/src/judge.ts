import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWavHeader, sleep } from '@voice-traductor/engines';
import { renderLagChartSvg } from './chart.js';
import { verdictFromPerceived, type Verdict } from './criteria.js';
import { transcribeAudio, type Reference, type ReferenceSegment } from './transcribe.js';
import { fmtClock, fmtSec, median, percentile } from './util.js';

/**
 * Juez automático.
 *
 * 1. Reconstruye las frases que oyó el oyente, con el instante exacto en que
 *    empezó y terminó de oír cada una. Si existe `traduccion_cruda.wav`, la
 *    transcribe con whisper y proyecta sus tiempos a la línea de tiempo del
 *    oyente usando la tabla de fragmentos de `eventos.jsonl`. Si no, usa los
 *    subtítulos del motor.
 * 2. Alinea cada frase oída con los segmentos del original (transcripción de
 *    referencia con tiempos) y califica el significado de 1 a 5.
 * 3. De la alineación sale el retraso percibido: cuánto después de que el
 *    pastor empezó o terminó una frase el oyente la empezó o terminó de oír,
 *    y qué fracción del tiempo de escucha estuvo por encima del umbral.
 */
export interface JudgeOptions {
  runDir: string;
  reference: Reference;
  apiKey: string;
  model: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  windowSec?: number;
  thresholdMs?: number;
  /** Transcribir la traducción para obtener tiempos exactos de escucha. Por defecto sí. */
  perceived?: boolean;
  log?: (line: string) => void;
}

export interface TargetSentence {
  id: number;
  /** Momento en que el oyente empieza a oír la frase (ms). */
  heardMs: number;
  /** Momento en que termina de oírla (ms). */
  heardEndMs: number;
  text: string;
}

export interface JudgeItem {
  target_id: number;
  source_ids: number[];
  score: number;
  errors: string[];
  note?: string;
  text?: string;
  heardMs?: number;
  heardEndMs?: number;
  sourceStartMs?: number | null;
  sourceEndMs?: number | null;
  /** Inicio de la frase dicha → inicio de la frase oída. */
  lagStartMs?: number | null;
  /** Fin de la frase dicha → fin de la frase oída. */
  lagEndMs?: number | null;
}

export interface LagSummary {
  n: number;
  medianMs: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface JudgeResult {
  model: string;
  sentencesFrom: 'transcripcion_de_la_traduccion' | 'subtitulos_del_motor';
  sentences: number;
  scored: number;
  meanScore: number | null;
  distribution: Record<string, number>;
  shareAtLeast4: number | null;
  critical: JudgeItem[];
  errorCounts: Record<string, number>;
  omittedSource: ReferenceSegment[];
  perceived: {
    thresholdMs: number;
    lagStart: LagSummary;
    lagEnd: LagSummary;
    /** Fracción del tiempo de escucha con retraso por encima del umbral. */
    shareAboveThreshold: number | null;
    /** Tramo continuo más largo de escucha por encima del umbral (ms). */
    longestAboveMs: number | null;
    listeningMs: number;
    verdict: Verdict;
    /** Fracción de frases que el oyente empezó a oír antes de que el pastor terminara de decirlas. */
    overlapShare: number | null;
    drift: { slopeSecPer10Min: number | null; windows: Array<{ startMs: number; endMs: number; n: number; medianLagMs: number | null }> };
    /** Caídas bruscas del retraso entre frases consecutivas: el motor se saltó contenido para alcanzar. */
    jumps: Array<{ heardMs: number; fromMs: number; toMs: number; text: string }>;
    qualityByLag: Array<{ label: string; n: number; meanScore: number | null }>;
    backlog: Array<{ tMs: number; backlogMs: number; speaking: boolean }>;
  };
  items: JudgeItem[];
}

const SENTENCE_END = /([.!?…]+["”)]?)(\s+)/g;

/** Reconstruye frases a partir de los fragmentos de subtítulo con tiempo (respaldo sin transcripción). */
export function sentencesFromDeltas(deltas: Array<{ t: number; playRef: number; text: string }>): TargetSentence[] {
  const out: Array<Omit<TargetSentence, 'heardEndMs'>> = [];
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
  return out.map((s, i) => ({ ...s, heardEndMs: i + 1 < out.length ? Math.max(s.heardMs, out[i + 1].heardMs) : s.heardMs + 2000 }));
}

/** Entrada de audio del registro de eventos. Las corridas simuladas (`replay`) traen además el tramo del audio crudo que representan. */
export interface ChunkEntry {
  t: number;
  samples: number;
  playStart: number;
  /** Inicio del tramo en el audio crudo (ms). Si falta, los fragmentos son consecutivos. */
  rawStartMs?: number;
  /** Duración del tramo en el audio crudo (ms). Si falta, igual a la duración reproducida. */
  rawMs?: number;
}

/**
 * Proyección de tiempos del audio crudo (sin silencios) a la línea de tiempo
 * del oyente. Si un tramo se reprodujo acelerado o recortado, el tiempo se
 * escala en proporción a lo que duró reproducido.
 */
export function rawToAlignedMapper(chunks: ChunkEntry[], rate: number): (rawMs: number) => number {
  const rawStarts: number[] = [];
  const rawDurs: number[] = [];
  const playedDurs: number[] = [];
  let acc = 0;
  for (const c of chunks) {
    const played = (c.samples / rate) * 1000;
    const raw = c.rawMs ?? played;
    rawStarts.push(c.rawStartMs ?? acc);
    rawDurs.push(raw);
    playedDurs.push(played);
    acc = (c.rawStartMs ?? acc) + raw;
  }
  return (rawMs: number) => {
    if (!chunks.length) return rawMs;
    let lo = 0;
    let hi = chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rawStarts[mid] <= rawMs) lo = mid;
      else hi = mid - 1;
    }
    const off = Math.min(Math.max(0, rawMs - rawStarts[lo]), rawDurs[lo]);
    const scale = rawDurs[lo] > 0 ? playedDurs[lo] / rawDurs[lo] : 1;
    return chunks[lo].playStart + off * scale;
  };
}

export function loadChunks(runDir: string): ChunkEntry[] {
  const path = join(runDir, 'eventos.jsonl');
  if (!existsSync(path)) return [];
  const out: ChunkEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('"audio"')) continue;
    try {
      const ev = JSON.parse(line) as { type: string; t?: number; samples?: number; playStart?: number; rawStartMs?: number; rawMs?: number };
      if (ev.type === 'audio' && typeof ev.samples === 'number' && typeof ev.playStart === 'number') {
        out.push({ t: ev.t ?? ev.playStart, samples: ev.samples, playStart: ev.playStart, rawStartMs: ev.rawStartMs, rawMs: ev.rawMs });
      }
    } catch {
      /* línea corrupta */
    }
  }
  return out;
}

async function heardSentences(o: JudgeOptions): Promise<{ sentences: TargetSentence[]; from: JudgeResult['sentencesFrom'] }> {
  const log = o.log ?? (() => {});
  const rawPath = join(o.runDir, 'traduccion_cruda.wav');
  const chunks = loadChunks(o.runDir);
  if (o.perceived !== false && existsSync(rawPath) && chunks.length) {
    const { sampleRate } = readWavHeader(rawPath);
    log('Transcribiendo la traducción para obtener los tiempos exactos de escucha...');
    const segs = await transcribeAudio(rawPath, { apiKey: o.apiKey, language: o.targetLanguage ?? 'en', log });
    const map = rawToAlignedMapper(chunks, sampleRate);
    const sentences = segs.map((s, i) => ({ id: i + 1, heardMs: Math.round(map(s.start)), heardEndMs: Math.round(map(s.end)), text: s.text }));
    if (sentences.length) return { sentences, from: 'transcripcion_de_la_traduccion' };
  }
  const deltasPath = join(o.runDir, 'transcripcion_traduccion.jsonl');
  if (!existsSync(deltasPath)) throw new Error(`No existe ${deltasPath}`);
  const deltas = readFileSync(deltasPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { t: number; playRef: number; text: string });
  return { sentences: sentencesFromDeltas(deltas), from: 'subtitulos_del_motor' };
}

export async function judgeRun(o: JudgeOptions): Promise<JudgeResult> {
  const log = o.log ?? (() => {});
  const thresholdMs = o.thresholdMs ?? 3000;
  const { sentences, from } = await heardSentences(o);
  if (!sentences.length) throw new Error('La corrida no tiene frases traducidas que juzgar');
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
    log(`Juzgando ${fmtClock(ws)} a ${fmtClock(we)}: ${targets.length} frases oídas, ${sources.length} segmentos de referencia...`);
    const result = await askJudge(o, sources, targets);
    for (const it of result) {
      const s = byId.get(it.target_id);
      if (!s) continue;
      const refs = it.source_ids.map((id) => refById.get(id)).filter((v): v is ReferenceSegment => Boolean(v));
      const sourceStartMs = refs.length ? Math.min(...refs.map((r) => r.start)) : null;
      const sourceEndMs = refs.length ? Math.max(...refs.map((r) => r.end)) : null;
      items.push({
        ...it,
        text: s.text,
        heardMs: s.heardMs,
        heardEndMs: s.heardEndMs,
        sourceStartMs,
        sourceEndMs,
        lagStartMs: sourceStartMs === null ? null : s.heardMs - sourceStartMs,
        lagEndMs: sourceEndMs === null ? null : s.heardEndMs - sourceEndMs,
      });
    }
  }
  items.sort((a, b) => (a.heardMs ?? 0) - (b.heardMs ?? 0));

  const scored = items.filter((i) => i.score >= 1 && i.score <= 5);
  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const i of scored) distribution[String(Math.round(i.score))]++;
  const errorCounts: Record<string, number> = {};
  for (const i of items) for (const e of i.errors ?? []) errorCounts[e] = (errorCounts[e] ?? 0) + 1;
  const covered = new Set(items.flatMap((i) => i.source_ids));
  const omitted = o.reference.segments.filter((s) => !covered.has(s.id) && s.text.split(/\s+/).length >= 4);

  const result: JudgeResult = {
    model: o.model,
    sentencesFrom: from,
    sentences: sentences.length,
    scored: scored.length,
    meanScore: scored.length ? scored.reduce((a, i) => a + i.score, 0) / scored.length : null,
    distribution,
    shareAtLeast4: scored.length ? scored.filter((i) => i.score >= 4).length / scored.length : null,
    critical: items.filter((i) => i.score <= 2),
    errorCounts,
    omittedSource: omitted,
    perceived: perceivedStats(items, thresholdMs),
    items,
  };
  writeFileSync(join(o.runDir, 'juez.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(o.runDir, 'juez.md'), renderJudge(result));
  writeFileSync(join(o.runDir, 'retraso_percibido.csv'), perceivedCsv(items));
  writeFileSync(join(o.runDir, 'retraso_continuo.csv'), 'segundo,atraso_s,hablando\n' + result.perceived.backlog.map((b) => `${(b.tMs / 1000).toFixed(0)},${(b.backlogMs / 1000).toFixed(2)},${b.speaking ? 'si' : 'no'}`).join('\n') + '\n');
  writeFileSync(join(o.runDir, 'retraso_percibido.svg'), renderLagChartSvg({
    title: `Retraso percibido por el oyente: ${o.runDir.split(/[\\/]/).pop() ?? ''}`,
    subtitle: `inicio→inicio mediana ${fmtSec(result.perceived.lagStart.medianMs)} · fin→fin mediana ${fmtSec(result.perceived.lagEnd.medianMs)} · ${result.perceived.shareAboveThreshold === null ? '-' : Math.round(result.perceived.shareAboveThreshold * 100) + '%'} del tiempo sobre el umbral · veredicto ${result.perceived.verdict}`,
    thresholdMs,
    endMs: Math.max(...items.map((i) => i.heardEndMs ?? 0), 1000),
    points: items.flatMap((i) => (typeof i.lagStartMs === 'number' && typeof i.lagEndMs === 'number' ? [{ tMs: i.heardMs ?? 0, lagMs: i.lagStartMs, kind: 'inicio' as const, text: i.text }, { tMs: i.heardEndMs ?? 0, lagMs: i.lagEndMs, kind: 'fin' as const, text: i.text }] : [])),
    backlog: result.perceived.backlog,
  }));
  return result;
}

/** Curva de retraso percibido y resumen contra el umbral. */
export function perceivedStats(items: JudgeItem[], thresholdMs: number): JudgeResult['perceived'] {
  const valid = items.filter((i) => typeof i.lagStartMs === 'number' && typeof i.lagEndMs === 'number' && typeof i.heardMs === 'number' && typeof i.heardEndMs === 'number');
  const plausible = valid.filter((i) => (i.lagStartMs as number) > -2000 && (i.lagStartMs as number) < 40_000 && (i.lagEndMs as number) > -2000 && (i.lagEndMs as number) < 40_000);
  const summary = (v: number[]): LagSummary => {
    const s = [...v].sort((a, b) => a - b);
    return { n: s.length, medianMs: s.length ? median(s) : null, p90Ms: s.length ? percentile(s, 0.9) : null, p95Ms: s.length ? percentile(s, 0.95) : null, maxMs: s.length ? s[s.length - 1] : null };
  };
  let listening = 0;
  let above = 0;
  let longest = 0;
  let run = 0;
  let prevEnd = -Infinity;
  for (const i of plausible) {
    const dur = Math.max(0, (i.heardEndMs as number) - (i.heardMs as number));
    const a = i.lagStartMs as number;
    const b = i.lagEndMs as number;
    listening += dur;
    // Retraso interpolado linealmente entre inicio y fin de la frase oída.
    let aboveHere = 0;
    if (a > thresholdMs && b > thresholdMs) aboveHere = dur;
    else if (a > thresholdMs || b > thresholdMs) aboveHere = dur * (Math.max(a, b) - thresholdMs) / Math.max(1, Math.abs(a - b));
    above += aboveHere;
    const contiguous = (i.heardMs as number) - prevEnd < 1500;
    if (aboveHere >= dur * 0.5 && dur > 0) run = (contiguous ? run : 0) + dur;
    else run = 0;
    longest = Math.max(longest, run);
    prevEnd = i.heardEndMs as number;
  }
  const share = listening > 0 ? above / listening : null;
  const sorted = [...plausible].sort((a, b) => (a.heardMs as number) - (b.heardMs as number));

  // ¿Empezó a oírse antes de que el pastor terminara la frase?
  const withEnd = sorted.filter((i) => typeof i.sourceEndMs === 'number');
  const overlapShare = withEnd.length ? withEnd.filter((i) => (i.heardMs as number) < (i.sourceEndMs as number)).length / withEnd.length : null;

  // Deriva: pendiente del retraso fin→fin sobre el tiempo de escucha, y mediana por ventanas de 5 min.
  const endMs = sorted.length ? Math.max(...sorted.map((i) => i.heardEndMs as number)) : 0;
  const windows: JudgeResult['perceived']['drift']['windows'] = [];
  for (let ws = 0; ws < Math.max(endMs, 1); ws += 300_000) {
    const we = Math.min(endMs, ws + 300_000);
    const v = sorted.filter((i) => (i.heardMs as number) >= ws && (i.heardMs as number) < we).map((i) => i.lagEndMs as number);
    windows.push({ startMs: ws, endMs: we, n: v.length, medianLagMs: v.length ? median(v) : null });
  }
  let slope: number | null = null;
  if (sorted.length >= 4) {
    const n = sorted.length;
    const mx = sorted.reduce((a, i) => a + (i.heardMs as number), 0) / n;
    const my = sorted.reduce((a, i) => a + (i.lagEndMs as number), 0) / n;
    let num = 0;
    let den = 0;
    for (const i of sorted) {
      num += ((i.heardMs as number) - mx) * ((i.lagEndMs as number) - my);
      den += ((i.heardMs as number) - mx) ** 2;
    }
    if (den > 0) slope = ((num / den) * 600_000) / 1000;
  }

  // Saltos: el retraso cae más de 1,5 s de una frase a la siguiente.
  const jumps: JudgeResult['perceived']['jumps'] = [];
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1].lagEndMs as number;
    const cur = sorted[k].lagEndMs as number;
    if (prev - cur > 1500) jumps.push({ heardMs: sorted[k].heardMs as number, fromMs: prev, toMs: cur, text: sorted[k].text ?? '' });
  }

  // Calidad según el retraso con el que llegó cada frase.
  const buckets: Array<{ label: string; test: (lag: number) => boolean }> = [
    { label: '≤ 2 s', test: (l) => l <= 2000 },
    { label: '2 a 3 s', test: (l) => l > 2000 && l <= 3000 },
    { label: '3 a 5 s', test: (l) => l > 3000 && l <= 5000 },
    { label: '> 5 s', test: (l) => l > 5000 },
    { label: '≤ 3 s', test: (l) => l <= 3000 },
    { label: '> 3 s', test: (l) => l > 3000 },
  ];
  const qualityByLag = buckets.map((b) => {
    const v = sorted.filter((i) => b.test(i.lagEndMs as number) && i.score >= 1 && i.score <= 5).map((i) => i.score);
    return { label: b.label, n: v.length, meanScore: v.length ? v.reduce((a, x) => a + x, 0) / v.length : null };
  });

  return {
    thresholdMs,
    lagStart: summary(plausible.map((i) => i.lagStartMs as number)),
    lagEnd: summary(plausible.map((i) => i.lagEndMs as number)),
    shareAboveThreshold: share,
    longestAboveMs: listening > 0 ? longest : null,
    listeningMs: listening,
    verdict: verdictFromPerceived(share, listening > 0 ? longest : null),
    overlapShare,
    drift: { slopeSecPer10Min: slope, windows },
    jumps,
    qualityByLag,
    backlog: backlogSeries(sorted),
  };
}

/**
 * Atraso acumulado segundo a segundo: en cada instante de escucha, cuánto
 * tiempo del original lleva el oyente "por detrás". Dentro de una frase oída
 * se interpola entre su inicio y su fin; entre frases, el original avanza y
 * lo oído no, así que el atraso crece hasta la siguiente frase.
 */
export function backlogSeries(sorted: JudgeItem[]): Array<{ tMs: number; backlogMs: number; speaking: boolean }> {
  const out: Array<{ tMs: number; backlogMs: number; speaking: boolean }> = [];
  if (!sorted.length) return out;
  const endMs = Math.max(...sorted.map((i) => i.heardEndMs as number));
  let k = 0;
  let deliveredIdle = 0;
  for (let t = Math.floor((sorted[0].heardMs as number) / 1000) * 1000; t <= endMs; t += 1000) {
    while (k + 1 < sorted.length && (sorted[k + 1].heardMs as number) <= t) k++;
    const it = sorted[k];
    const hs = it.heardMs as number;
    const he = it.heardEndMs as number;
    const ss = it.sourceStartMs as number;
    const se = it.sourceEndMs as number;
    deliveredIdle = Math.max(deliveredIdle, ...sorted.slice(0, k).map((p) => p.sourceEndMs as number));
    if (t >= hs && t <= he && he > hs) {
      const delivered = ss + ((t - hs) / (he - hs)) * (se - ss);
      out.push({ tMs: t, backlogMs: Math.max(0, t - Math.max(delivered, deliveredIdle)), speaking: true });
    } else {
      const delivered = Math.max(deliveredIdle, t > he ? se : deliveredIdle);
      out.push({ tMs: t, backlogMs: Math.max(0, t - delivered), speaking: false });
    }
  }
  return out;
}

function perceivedCsv(items: JudgeItem[]): string {
  const rows = ['oido_s,retraso_s,punto,frase_id,puntaje,texto'];
  for (const i of items) {
    if (typeof i.lagStartMs !== 'number' || typeof i.lagEndMs !== 'number') continue;
    const text = `"${(i.text ?? '').replace(/"/g, '""')}"`;
    rows.push(`${((i.heardMs ?? 0) / 1000).toFixed(2)},${(i.lagStartMs / 1000).toFixed(2)},inicio,${i.target_id},${i.score},${text}`);
    rows.push(`${((i.heardEndMs ?? 0) / 1000).toFixed(2)},${(i.lagEndMs / 1000).toFixed(2)},fin,${i.target_id},${i.score},${text}`);
  }
  return rows.join('\n') + '\n';
}

async function askJudge(o: JudgeOptions, sources: ReferenceSegment[], targets: TargetSentence[]): Promise<JudgeItem[]> {
  const src = o.sourceLanguage ?? o.reference.language ?? 'the source language';
  const tgt = o.targetLanguage ?? 'the target language';
  const system = [
    `You evaluate live AI interpretation of a church sermon from ${src} into ${tgt}.`,
    'You receive SOURCE segments (reference transcript with ids and times) and TARGET sentences (what listeners heard, with ids and times).',
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
    ...targets.map((t) => `[${t.id} @${(t.heardMs / 1000).toFixed(1)}-${(t.heardEndMs / 1000).toFixed(1)}s] ${t.text}`),
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
  const p = r.perceived;
  const l: string[] = [];
  l.push(`# Juez automático (${r.model})`, '');
  l.push(`Frases oídas reconstruidas desde: ${r.sentencesFrom === 'transcripcion_de_la_traduccion' ? 'la transcripción del audio traducido (tiempos exactos de escucha)' : 'los subtítulos del motor (tiempos aproximados)'}.`, '');
  l.push(`## Retraso percibido por el oyente (umbral ${fmtSec(p.thresholdMs, 1)})`, '');
  l.push(`- **Veredicto: ${p.verdict}.**`);
  l.push(`- Inicio de frase dicha → inicio de frase oída: mediana ${fmtSec(p.lagStart.medianMs)}, p90 ${fmtSec(p.lagStart.p90Ms)}, p95 ${fmtSec(p.lagStart.p95Ms)}, máx ${fmtSec(p.lagStart.maxMs)} (${p.lagStart.n} frases).`);
  l.push(`- Fin de frase dicha → fin de frase oída: mediana ${fmtSec(p.lagEnd.medianMs)}, p90 ${fmtSec(p.lagEnd.p90Ms)}, p95 ${fmtSec(p.lagEnd.p95Ms)}, máx ${fmtSec(p.lagEnd.maxMs)}.`);
  l.push(`- Tiempo de escucha con retraso por encima del umbral: ${p.shareAboveThreshold === null ? '-' : Math.round(p.shareAboveThreshold * 100) + '%'} de ${fmtClock(p.listeningMs)}.`);
  l.push(`- Tramo continuo más largo por encima del umbral: ${fmtSec(p.longestAboveMs, 1)}.`);
  l.push(`- Frases que el oyente empezó a oír antes de que el pastor terminara de decirlas: ${p.overlapShare === null ? '-' : Math.round(p.overlapShare * 100) + '%'} (interpretación simultánea real si es alto; consecutiva si es bajo).`);
  l.push(`- Deriva: ${p.drift.slopeSecPer10Min === null ? '-' : p.drift.slopeSecPer10Min.toFixed(2) + ' s cada 10 min'}. Mediana por ventana: ${p.drift.windows.map((w) => `${fmtClock(w.startMs)} ${fmtSec(w.medianLagMs, 1)}`).join(' · ')}.`);
  l.push(`- Saltos (el retraso cae más de 1,5 s de una frase a la siguiente, señal de contenido saltado): ${p.jumps.length}.`);
  for (const j of p.jumps.slice(0, 15)) l.push(`  - [${fmtClock(j.heardMs)}] de ${fmtSec(j.fromMs, 1)} a ${fmtSec(j.toMs, 1)}: "${j.text}"`);
  l.push(`- Calidad según el retraso de llegada: ${p.qualityByLag.filter((b) => !['≤ 3 s', '> 3 s'].includes(b.label)).map((b) => `${b.label}: ${b.meanScore === null ? '-' : b.meanScore.toFixed(2)} (${b.n})`).join(' · ')}.`);
  l.push(`- Gráfica en \`retraso_percibido.svg\`; curvas en \`retraso_percibido.csv\` (por frase) y \`retraso_continuo.csv\` (segundo a segundo).`, '');
  l.push('## Calidad', '');
  l.push(`- Frases oídas: ${r.sentences}; calificadas: ${r.scored}.`);
  l.push(`- Puntaje medio: ${r.meanScore === null ? '-' : r.meanScore.toFixed(2)} de 5. Frases con 4 o más: ${r.shareAtLeast4 === null ? '-' : Math.round(r.shareAtLeast4 * 100) + '%'}.`);
  l.push(`- Distribución: ${Object.entries(r.distribution).map(([k, v]) => `${k}★ ${v}`).join(', ')}.`);
  l.push(`- Errores por tipo: ${Object.entries(r.errorCounts).map(([k, v]) => `${k} ${v}`).join(', ') || 'ninguno'}.`);
  l.push(`- Segmentos del original sin traducción detectada: ${r.omittedSource.length}.`, '');
  if (r.critical.length) {
    l.push('## Frases con puntaje 1 o 2', '');
    for (const c of r.critical) l.push(`- [${fmtClock(c.heardMs ?? 0)}] (${c.score}) "${c.text}" — fuentes ${c.source_ids.join(', ') || 'ninguna'}; ${c.errors.join(', ')}${c.note ? '; ' + c.note : ''}`);
    l.push('');
  }
  const slow = r.items.filter((i) => typeof i.lagEndMs === 'number' && i.lagEndMs > p.thresholdMs);
  if (slow.length) {
    l.push(`## Frases oídas más de ${fmtSec(p.thresholdMs, 1)} después de dichas`, '');
    for (const s of slow.slice(0, 40)) l.push(`- [${fmtClock(s.heardMs ?? 0)}] inicio ${fmtSec(s.lagStartMs, 1)}, fin ${fmtSec(s.lagEndMs, 1)}: "${s.text}"`);
    if (slow.length > 40) l.push(`- ... y ${slow.length - 40} más en retraso_percibido.csv`);
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
