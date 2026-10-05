import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function fmtClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}

export function fmtSec(ms: number | null | undefined, digits = 2): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '-';
  return `${(ms / 1000).toFixed(digits)} s`;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(values: number[]): number {
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

/** Carga .env desde la raíz del repo si existe (Node ≥ 21.7). */
export function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    /* ignorar: variables ya definidas o archivo inválido */
  }
}

export function timestampLabel(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
