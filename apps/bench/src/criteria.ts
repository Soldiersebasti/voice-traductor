/** Veredictos contra el umbral de latencia del MVP. */
export type Verdict = 'cumple' | 'al límite' | 'no cumple' | 'sin datos';

/** Retraso por frase: la mediana debe estar bajo el umbral y el p90 no muy por encima. */
export function verdictFromLag(medianMs: number | null, p90Ms: number | null, thresholdMs: number, anchors?: number): Verdict {
  if (medianMs === null || (anchors !== undefined && anchors < 5)) return 'sin datos';
  if (medianMs > thresholdMs) return 'no cumple';
  if (p90Ms !== null && p90Ms > thresholdMs * 1.5) return 'al límite';
  return 'cumple';
}

/** Frases interactivas: proporción de frases cuya traducción terminó dentro del umbral. */
export function verdictFromPassRate(passRate: number | null): Verdict {
  if (passRate === null) return 'sin datos';
  if (passRate >= 0.9) return 'cumple';
  if (passRate >= 0.7) return 'al límite';
  return 'no cumple';
}

/** Retraso percibido: fracción del tiempo de escucha por encima del umbral y tramo más largo sostenido. */
export function verdictFromPerceived(shareAbove: number | null, longestAboveMs: number | null): Verdict {
  if (shareAbove === null) return 'sin datos';
  if (shareAbove <= 0.1 && (longestAboveMs ?? 0) <= 20_000) return 'cumple';
  if (shareAbove <= 0.25) return 'al límite';
  return 'no cumple';
}

export function worst(...vs: Verdict[]): Verdict {
  const rank: Record<Verdict, number> = { 'no cumple': 0, 'al límite': 1, cumple: 2, 'sin datos': 3 };
  let out: Verdict = 'sin datos';
  for (const v of vs) if (rank[v] < rank[out]) out = v;
  return out;
}
