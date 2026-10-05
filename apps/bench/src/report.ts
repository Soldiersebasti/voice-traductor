import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { worst } from './criteria.js';
import type { JudgeResult } from './judge.js';
import type { Metrics } from './metrics.js';
import { fmtClock, fmtSec } from './util.js';

interface Loaded {
  dir: string;
  metrics: Metrics;
  judge: JudgeResult | null;
}

export function loadRun(dir: string): Loaded {
  const mPath = join(dir, 'metricas.json');
  if (!existsSync(mPath)) throw new Error(`No existe ${mPath}`);
  const metrics = JSON.parse(readFileSync(mPath, 'utf8')) as Metrics;
  const jPath = join(dir, 'juez.json');
  const judge = existsSync(jPath) ? (JSON.parse(readFileSync(jPath, 'utf8')) as JudgeResult) : null;
  return { dir, metrics, judge };
}

export function renderReport(runs: Loaded[]): string {
  const cols = runs.map((r) => `${r.metrics.engine} (${r.metrics.label})`);
  const row = (name: string, f: (r: Loaded) => string) => `| ${name} | ${runs.map(f).join(' | ')} |`;
  const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '-' : v.toFixed(d));
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : Math.round(v * 100) + '%');
  const T = runs[0]?.metrics.latency?.thresholdMs ?? 3000;
  const l: string[] = [];
  l.push('# Comparación de motores', '');
  l.push(`| Métrica | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
  l.push(row(`**Latencia ≤ ${fmtSec(T, 1)}: veredicto global**`, (r) => `**${worst(r.metrics.latency?.heuristic ?? 'sin datos', r.metrics.latency?.phrases ?? 'sin datos', r.judge?.perceived?.verdict ?? 'sin datos')}**`));
  l.push(row('Latencia: retraso fin de frase (heurístico)', (r) => r.metrics.latency?.heuristic ?? '-'));
  l.push(row('Latencia: frases interactivas', (r) => r.metrics.latency?.phrases ?? '-'));
  l.push(row('Latencia: retraso percibido (juez)', (r) => r.judge?.perceived?.verdict ?? '-'));
  l.push(row('Duración de la fuente', (r) => fmtClock(r.metrics.sourceDurationMs)));
  l.push(row('Primer audio traducido', (r) => fmtSec(r.metrics.firstAudio?.latencyMs)));
  l.push(row('Retraso fin de frase, mediana', (r) => fmtSec(r.metrics.phraseEndLag.medianMs)));
  l.push(row('Retraso fin de frase, p90', (r) => fmtSec(r.metrics.phraseEndLag.p90Ms)));
  l.push(row('Retraso fin de frase, p95', (r) => fmtSec(r.metrics.phraseEndLag.p95Ms)));
  l.push(row('Retraso inicio de frase, mediana', (r) => fmtSec(r.metrics.phraseStartLag.medianMs)));
  l.push(row('Frases emparejadas', (r) => `${r.metrics.phraseEndLag.anchors} / ${r.metrics.phraseEndLag.candidates}`));
  l.push(row('Deriva (s cada 10 min)', (r) => num(r.metrics.drift.slopeSecPer10Min)));
  l.push(row('Retraso al final', (r) => fmtSec(r.metrics.tailLagMs)));
  l.push(row('Interactivo: frases dentro del umbral', (r) => (r.metrics.phrases ? `${r.metrics.phrases.passed} / ${r.metrics.phrases.total} (${pct(r.metrics.phrases.passRate)})` : '-')));
  l.push(row('Interactivo: fin dicho → fin oído, mediana', (r) => fmtSec(r.metrics.phrases?.endLag.medianMs)));
  l.push(row('Interactivo: fin dicho → fin oído, máximo', (r) => fmtSec(r.metrics.phrases?.endLag.maxMs)));
  l.push(row('Interactivo: fin dicho → inicio oído, mediana', (r) => fmtSec(r.metrics.phrases?.startLag.medianMs)));
  l.push(row('Interactivo: sin traducción', (r) => (r.metrics.phrases ? String(r.metrics.phrases.total - r.metrics.phrases.answered) : '-')));
  l.push(row('Juez: percibido inicio → inicio, mediana', (r) => fmtSec(r.judge?.perceived?.lagStart.medianMs)));
  l.push(row('Juez: percibido inicio → inicio, p90', (r) => fmtSec(r.judge?.perceived?.lagStart.p90Ms)));
  l.push(row('Juez: percibido fin → fin, mediana', (r) => fmtSec(r.judge?.perceived?.lagEnd.medianMs)));
  l.push(row('Juez: percibido fin → fin, p90', (r) => fmtSec(r.judge?.perceived?.lagEnd.p90Ms)));
  l.push(row('Juez: tiempo de escucha sobre el umbral', (r) => pct(r.judge?.perceived?.shareAboveThreshold)));
  l.push(row('Juez: tramo más largo sobre el umbral', (r) => fmtSec(r.judge?.perceived?.longestAboveMs, 1)));
  l.push(row('Continuidad: habla traducida mientras la fuente habla', (r) => pct(r.metrics.continuity?.overlapShare)));
  l.push(row('Continuidad: tramos largos sin pausa', (r) => String(r.metrics.continuity?.longRuns.length ?? '-')));
  l.push(row('Continuidad: cobertura mínima en tramos largos', (r) => (r.metrics.continuity?.longRuns.length ? pct(Math.min(...r.metrics.continuity.longRuns.map((x) => x.coverage))) : '-')));
  l.push(row('Continuidad: mayor hueco de salida en tramos largos', (r) => (r.metrics.continuity?.longRuns.length ? fmtSec(Math.max(...r.metrics.continuity.longRuns.map((x) => x.maxOutputGapMs)), 1) : '-')));
  l.push(row('Continuidad: silencios ≥ 3 s con la fuente hablando', (r) => String(r.metrics.continuity?.silences.length ?? '-')));
  l.push(row('Juez: frases oídas antes de que el pastor terminara', (r) => pct(r.judge?.perceived?.overlapShare)));
  l.push(row('Juez: deriva del retraso (s cada 10 min)', (r) => num(r.judge?.perceived?.drift?.slopeSecPer10Min)));
  l.push(row('Juez: saltos (caídas bruscas del retraso)', (r) => String(r.judge?.perceived?.jumps?.length ?? '-')));
  l.push(row('Juez: calidad media con retraso ≤ 3 s / > 3 s', (r) => (r.judge?.perceived?.qualityByLag ? `${num(r.judge.perceived.qualityByLag.find((b) => b.label === '≤ 3 s')?.meanScore)} / ${num(r.judge.perceived.qualityByLag.find((b) => b.label === '> 3 s')?.meanScore)}` : '-')));
  l.push(row('Relación habla traducción/original', (r) => num(r.metrics.speechRatio)));
  l.push(row('Atascos (silencio > 5 s con fuente hablando)', (r) => String(r.metrics.stalls.length)));
  l.push(row('Reconexiones / rotaciones', (r) => `${r.metrics.stability.reconnects} / ${r.metrics.stability.rotations}`));
  l.push(row('Cierres inesperados / errores', (r) => `${r.metrics.stability.unexpectedCloses} / ${r.metrics.stability.errors}`));
  l.push(row('Audio descartado', (r) => fmtSec(r.metrics.stability.droppedAudioMs)));
  l.push(row('Subtítulos (caracteres)', (r) => String(r.metrics.captions.targetChars)));
  l.push(row('Juez: puntaje medio (1-5)', (r) => num(r.judge?.meanScore)));
  l.push(row('Juez: frases con 4 o más', (r) => pct(r.judge?.shareAtLeast4)));
  l.push(row('Juez: frases con 1 o 2', (r) => (r.judge ? String(r.judge.critical.length) : '-')));
  l.push(row('Juez: original sin traducir', (r) => (r.judge ? String(r.judge.omittedSource.length) : '-')));
  l.push(row('Evaluadores: precisión (1-5)', () => '_pendiente_'));
  l.push(row('Evaluadores: naturalidad (1-5)', () => '_pendiente_'));
  l.push('');
  l.push('Veredictos: `cumple`, `al límite`, `no cumple` o `sin datos`. El global es el peor de los tres. Definiciones en `docs/banco-de-pruebas.md`.', '');
  l.push('Las filas de evaluadores se llenan a mano con el promedio de `docs/plantilla-evaluacion.csv`.', '');
  l.push('Carpetas:', '');
  for (const r of runs) l.push(`- ${r.dir}`);
  l.push('');
  return l.join('\n');
}
