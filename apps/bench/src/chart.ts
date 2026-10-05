/**
 * Gráfica SVG estática del retraso percibido a lo largo de la corrida.
 * Un solo eje vertical (segundos de retraso), dos series: el retraso medido en
 * cada frase oída y el atraso acumulado segundo a segundo. Línea de referencia
 * en el umbral. Sin dependencias; se abre en cualquier navegador.
 */
export interface LagChartInput {
  title: string;
  subtitle?: string;
  thresholdMs: number;
  endMs: number;
  points: Array<{ tMs: number; lagMs: number; kind: 'inicio' | 'fin'; text?: string }>;
  backlog: Array<{ tMs: number; backlogMs: number; speaking: boolean }>;
}

const C = {
  surface: '#fcfcfb',
  text: '#0b0b0b',
  text2: '#52514e',
  grid: '#e6e6e3',
  axis: '#c3c2b7',
  s1: '#2a78d6', // retraso por frase
  s2: '#eb6834', // atraso acumulado
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function renderLagChartSvg(i: LagChartInput): string {
  const W = 1100;
  const H = 380;
  const m = { l: 60, r: 28, t: 64, b: 52 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const endMs = Math.max(1000, i.endMs);
  const lags = [...i.points.map((p) => p.lagMs), ...i.backlog.map((b) => b.backlogMs)].filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const p95 = lags.length ? lags[Math.floor((lags.length - 1) * 0.95)] : 0;
  const yMaxMs = Math.max(i.thresholdMs * 2, Math.ceil((p95 * 1.2) / 1000) * 1000, 4000);
  const x = (ms: number) => m.l + (Math.min(Math.max(0, ms), endMs) / endMs) * pw;
  const y = (ms: number) => m.t + ph - (Math.min(Math.max(0, ms), yMaxMs) / yMaxMs) * ph;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="12">`);
  out.push(`<rect width="${W}" height="${H}" fill="${C.surface}"/>`);
  out.push(`<text x="${m.l}" y="26" font-size="16" font-weight="600" fill="${C.text}">${esc(i.title)}</text>`);
  if (i.subtitle) out.push(`<text x="${m.l}" y="46" fill="${C.text2}">${esc(i.subtitle)}</text>`);

  // Rejilla y eje vertical (segundos)
  const yStep = yMaxMs > 12000 ? 2000 : 1000;
  for (let v = 0; v <= yMaxMs; v += yStep) {
    out.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${C.grid}" stroke-width="1"/>`);
    out.push(`<text x="${m.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" fill="${C.text2}">${(v / 1000).toFixed(0)} s</text>`);
  }
  // Eje horizontal (minutos)
  const totalMin = endMs / 60000;
  const xStep = totalMin > 40 ? 10 : totalMin > 15 ? 5 : totalMin > 6 ? 2 : totalMin > 2 ? 1 : 0.5;
  for (let t = 0; t <= totalMin + 1e-9; t += xStep) {
    const ms = t * 60000;
    if (ms > endMs) break;
    out.push(`<line x1="${x(ms).toFixed(1)}" x2="${x(ms).toFixed(1)}" y1="${m.t + ph}" y2="${m.t + ph + 5}" stroke="${C.axis}"/>`);
    out.push(`<text x="${x(ms).toFixed(1)}" y="${m.t + ph + 20}" text-anchor="middle" fill="${C.text2}">${clock(ms)}</text>`);
  }
  out.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${C.axis}"/>`);
  out.push(`<text x="${m.l + pw / 2}" y="${H - 14}" text-anchor="middle" fill="${C.text2}">tiempo de escucha (min:s)</text>`);

  // Umbral
  const yT = y(i.thresholdMs);
  out.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${yT.toFixed(1)}" y2="${yT.toFixed(1)}" stroke="${C.text2}" stroke-width="1.5" stroke-dasharray="6 4"/>`);
  out.push(`<text x="${m.l + pw - 4}" y="${(yT - 6).toFixed(1)}" text-anchor="end" fill="${C.text2}">umbral ${(i.thresholdMs / 1000).toFixed(1)} s</text>`);

  // Atraso acumulado segundo a segundo
  if (i.backlog.length > 1) {
    const d = i.backlog.map((b, k) => `${k === 0 ? 'M' : 'L'}${x(b.tMs).toFixed(1)} ${y(b.backlogMs).toFixed(1)}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="${C.s2}" stroke-width="2" stroke-opacity="0.85"/>`);
  }
  // Retraso en cada frase oída
  const pts = [...i.points].sort((a, b) => a.tMs - b.tMs);
  if (pts.length > 1) {
    const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.tMs).toFixed(1)} ${y(p.lagMs).toFixed(1)}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="${C.s1}" stroke-width="2"/>`);
  }
  for (const p of pts) {
    const above = p.lagMs > i.thresholdMs;
    const r = above ? 4 : 2.5;
    out.push(`<circle cx="${x(p.tMs).toFixed(1)}" cy="${y(p.lagMs).toFixed(1)}" r="${r}" fill="${C.s1}" stroke="${C.surface}" stroke-width="${above ? 2 : 1}"><title>${esc(`${clock(p.tMs)} · ${p.kind} de frase · retraso ${(p.lagMs / 1000).toFixed(1)} s${p.text ? ' · ' + p.text : ''}`)}</title></circle>`);
  }

  // Leyenda
  const lx = m.l + pw - 420;
  out.push(`<line x1="${lx}" x2="${lx + 22}" y1="${m.t - 12}" y2="${m.t - 12}" stroke="${C.s1}" stroke-width="2"/>`);
  out.push(`<text x="${lx + 28}" y="${m.t - 8}" fill="${C.text}">retraso al oír cada frase</text>`);
  out.push(`<line x1="${lx + 190}" x2="${lx + 212}" y1="${m.t - 12}" y2="${m.t - 12}" stroke="${C.s2}" stroke-width="2"/>`);
  out.push(`<text x="${lx + 218}" y="${m.t - 8}" fill="${C.text}">atraso acumulado, segundo a segundo</text>`);
  out.push('</svg>');
  return out.join('\n');
}
