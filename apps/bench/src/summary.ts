import type { LagStats, Metrics } from './metrics.js';
import { fmtClock, fmtSec } from './util.js';

function lagLine(l: LagStats): string {
  if (!l.anchors) return `sin anclas (${l.candidates} límites de frase en la fuente)`;
  return `mediana ${fmtSec(l.medianMs)}, p10 ${fmtSec(l.p10Ms)}, p90 ${fmtSec(l.p90Ms)}, p95 ${fmtSec(l.p95Ms)}, mín ${fmtSec(l.minMs)}, máx ${fmtSec(l.maxMs)} (${l.anchors} de ${l.candidates} frases emparejadas)`;
}

export function renderSummary(m: Metrics, o: { fatal?: string | null } = {}): string {
  const T = m.latency.thresholdMs;
  const lines: string[] = [];
  lines.push(`# Resumen: ${m.label}`, '');
  lines.push(`Motor: **${m.engine}**. Fuente: ${fmtClock(m.sourceDurationMs)}. Corrida total: ${fmtClock(m.runDurationMs)}.`, '');
  if (o.fatal) lines.push(`> **Error fatal durante la corrida:** ${o.fatal}`, '');

  lines.push(`## Criterio de latencia (umbral ${fmtSec(T, 1)})`, '');
  lines.push(`- Retraso fin de frase (heurístico): **${m.latency.heuristic}** (mediana ${fmtSec(m.phraseEndLag.medianMs)}, p90 ${fmtSec(m.phraseEndLag.p90Ms)}).`);
  if (m.phrases) lines.push(`- Frases interactivas: **${m.latency.phrases}** (${m.phrases.passed} de ${m.phrases.total} dentro del umbral).`);
  lines.push('- Retraso percibido frase a frase: ver `juez.md` después de correr `judge`.');
  lines.push(`- El sistema en vivo suma entre 0,4 y 0,7 s por la distribución y el reproductor del celular. Para cumplir ${fmtSec(T, 1)} en la iglesia, aquí conviene quedar por debajo de ${fmtSec(T - 500, 1)}.`, '');

  lines.push('## Retraso', '');
  lines.push(`- Primer audio traducido: ${m.firstAudio?.latencyMs != null ? fmtSec(m.firstAudio.latencyMs) : '-'} después de que empezó a hablar la fuente.`);
  lines.push(`- Primer subtítulo: ${fmtSec(m.firstCaptionMs)}.`);
  lines.push(`- Fin de frase → fin de traducción: ${lagLine(m.phraseEndLag)}.`);
  lines.push(`- Inicio de frase → inicio de traducción: ${lagLine(m.phraseStartLag)}.`);
  lines.push(`- Retraso al final del audio: ${fmtSec(m.tailLagMs)}.`);
  lines.push(`- Cola máxima del reproductor: ${fmtSec(m.maxQueueMs)} (cuánto audio llegó "de golpe" por delante de su reproducción).`, '');

  if (m.phrases) {
    const p = m.phrases;
    lines.push('## Frases interactivas', '');
    lines.push(`- ${p.total} frases del guion; ${p.answered} con traducción; ${p.passed} terminaron de oírse dentro de ${fmtSec(T, 1)} tras ser dichas (${p.passRate === null ? '-' : Math.round(p.passRate * 100) + '%'}).`);
    lines.push(`- Fin dicho → fin oído: mediana ${fmtSec(p.endLag.medianMs)}, p90 ${fmtSec(p.endLag.p90Ms)}, máx ${fmtSec(p.endLag.maxMs)}.`);
    lines.push(`- Fin dicho → inicio oído: mediana ${fmtSec(p.startLag.medianMs)}, p90 ${fmtSec(p.startLag.p90Ms)}, máx ${fmtSec(p.startLag.maxMs)}.`, '');
    lines.push('| # | Frase | Dura | Fin dicho → inicio oído | Fin dicho → fin oído | Estado | Lo que se oyó |', '|---|---|---|---|---|---|---|');
    for (const r of p.results) {
      const estado = r.ok === null ? 'sin traducción' : r.ok ? 'ok' : 'tarde';
      lines.push(`| ${r.id} | ${r.text} | ${fmtSec(r.durationMs, 1)} | ${fmtSec(r.startLagMs)} | ${fmtSec(r.endLagMs)} | ${estado} | ${r.heardText.replace(/\|/g, '/') || '-'} |`);
    }
    lines.push('');
  }

  lines.push('## Deriva (¿el retraso crece con el tiempo?)', '');
  lines.push(`- Pendiente: ${m.drift.slopeSecPer10Min === null ? '-' : m.drift.slopeSecPer10Min.toFixed(2) + ' s cada 10 min'}.`);
  lines.push('', '| Ventana | Frases | Retraso mediano |', '|---|---|---|');
  for (const w of m.drift.windows) lines.push(`| ${fmtClock(w.startMs)} a ${fmtClock(w.endMs)} | ${w.anchors} | ${fmtSec(w.medianLagMs)} |`);
  lines.push('');

  lines.push('## Habla', '');
  lines.push(`- Habla en la fuente: ${fmtClock(m.sourceSpeechMs)} en ${m.sourceSegments} segmentos.`);
  lines.push(`- Habla en la traducción: ${fmtClock(m.outputSpeechMs)} en ${m.outputSegments} segmentos.`);
  lines.push(`- Relación traducción/original: ${m.speechRatio === null ? '-' : m.speechRatio.toFixed(2)} (mayor que 1 = la traducción habla más tiempo que el original).`);
  lines.push(`- Subtítulos: ${m.captions.targetChars} caracteres traducidos en ${m.captions.targetDeltas} fragmentos; ${m.captions.sourceChars} caracteres de transcripción original.`, '');

  lines.push('## Estabilidad', '');
  lines.push(`- Reconexiones: ${m.stability.reconnects}. Rotaciones de sesión: ${m.stability.rotations}. Cierres inesperados: ${m.stability.unexpectedCloses}. Errores: ${m.stability.errors}.`);
  lines.push(`- Audio descartado durante reconexiones: ${fmtSec(m.stability.droppedAudioMs)}.`);
  lines.push(`- Silencios largos con la fuente hablando (atascos): ${m.stalls.length}.`);
  for (const s of m.stalls) lines.push(`  - ${fmtClock(s.startMs)} a ${fmtClock(s.endMs)} (${fmtSec(s.durationMs, 1)} sin salida; la fuente habló ${fmtSec(s.sourceSpeechMs, 1)}).`);
  if (m.stability.finishTimedOut) lines.push('- El motor no terminó de hablar dentro del tiempo límite al final.');
  if (m.stability.events.length) {
    lines.push('', 'Eventos:', '');
    for (const e of m.stability.events.slice(0, 60)) lines.push(`- [${fmtClock(e.t)}] ${e.kind}${e.code ? ' ' + e.code : ''}: ${e.message}`);
    if (m.stability.events.length > 60) lines.push(`- ... y ${m.stability.events.length - 60} más en eventos.jsonl`);
  }
  lines.push('');

  lines.push('## Archivos', '');
  lines.push('- `comparacion.wav`: estéreo, izquierda original y derecha traducción alineada en el tiempo. Es el archivo para juzgar retraso y calidad.');
  lines.push('- `traduccion_cruda.wav`: solo la traducción, sin silencios, para juzgar naturalidad.');
  lines.push('- `transcripcion_traduccion.txt` y `transcripcion_original.txt`: textos devueltos por el motor.');
  lines.push('- `metricas.json`: todas las cifras. `eventos.jsonl`: registro completo para depurar.', '');
  lines.push('Nota: los retrasos por frase de esta página salen de un detector de voz por energía y un emparejamiento por pausas; son una heurística robusta en la mediana. El comando `judge` transcribe la traducción, alinea frase a frase con un modelo de lenguaje y entrega el retraso percibido exacto.', '');
  return lines.join('\n');
}
