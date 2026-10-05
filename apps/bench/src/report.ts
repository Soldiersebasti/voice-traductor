import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const l: string[] = [];
  l.push('# Comparación de motores', '');
  l.push(`| Métrica | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
  l.push(row('Duración de la fuente', (r) => fmtClock(r.metrics.sourceDurationMs)));
  l.push(row('Primer audio traducido', (r) => fmtSec(r.metrics.firstAudio?.latencyMs)));
  l.push(row('Retraso fin de frase, mediana', (r) => fmtSec(r.metrics.phraseEndLag.medianMs)));
  l.push(row('Retraso fin de frase, p95', (r) => fmtSec(r.metrics.phraseEndLag.p95Ms)));
  l.push(row('Retraso inicio de frase, mediana', (r) => fmtSec(r.metrics.phraseStartLag.medianMs)));
  l.push(row('Frases emparejadas', (r) => `${r.metrics.phraseEndLag.anchors} / ${r.metrics.phraseEndLag.candidates}`));
  l.push(row('Deriva (s cada 10 min)', (r) => num(r.metrics.drift.slopeSecPer10Min)));
  l.push(row('Retraso al final', (r) => fmtSec(r.metrics.tailLagMs)));
  l.push(row('Relación habla traducción/original', (r) => num(r.metrics.speechRatio)));
  l.push(row('Atascos (silencio > 5 s con fuente hablando)', (r) => String(r.metrics.stalls.length)));
  l.push(row('Reconexiones / rotaciones', (r) => `${r.metrics.stability.reconnects} / ${r.metrics.stability.rotations}`));
  l.push(row('Cierres inesperados / errores', (r) => `${r.metrics.stability.unexpectedCloses} / ${r.metrics.stability.errors}`));
  l.push(row('Audio descartado', (r) => fmtSec(r.metrics.stability.droppedAudioMs)));
  l.push(row('Subtítulos (caracteres)', (r) => String(r.metrics.captions.targetChars)));
  l.push(row('Juez: puntaje medio (1-5)', (r) => num(r.judge?.meanScore)));
  l.push(row('Juez: frases con 4 o más', (r) => (r.judge?.shareAtLeast4 == null ? '-' : Math.round(r.judge.shareAtLeast4 * 100) + '%')));
  l.push(row('Juez: frases con 1 o 2', (r) => (r.judge ? String(r.judge.critical.length) : '-')));
  l.push(row('Juez: retraso alineado, mediana', (r) => fmtSec(r.judge?.lag.medianMs)));
  l.push(row('Juez: retraso alineado, p95', (r) => fmtSec(r.judge?.lag.p95Ms)));
  l.push(row('Juez: original sin traducir', (r) => (r.judge ? String(r.judge.omittedSource.length) : '-')));
  l.push(row('Evaluadores: precisión (1-5)', () => '_pendiente_'));
  l.push(row('Evaluadores: naturalidad (1-5)', () => '_pendiente_'));
  l.push('');
  l.push('Las filas de evaluadores se llenan a mano con el promedio de `docs/plantilla-evaluacion.csv`.', '');
  l.push('Carpetas:', '');
  for (const r of runs) l.push(`- ${r.dir}`);
  l.push('');
  return l.join('\n');
}
