/**
 * Fase 0: analiza la consola del repositorio ORIGINAL de Google
 * (gemini-live-translate-livekit) capturada con tools/fase0-run.ps1.
 *
 * No modifica la aplicación de Google: solo lee lo que su código ya imprime
 * (translation-bridge.ts y translation-session-manager.ts) y lo ordena en una
 * línea de tiempo con los criterios de aceptación de la Fase 0 que se pueden
 * comprobar desde la consola. Lo que solo puede juzgar una persona (qué se oyó
 * en el teléfono) queda en evidencia/fase-0/observacion-oyente.md.
 *
 * Uso:  npm run fase0:analizar -- evidencia/fase-0/consola-dev.txt
 * Escribe <carpeta del log>/analisis-consola.md y lo imprime.
 * Sale con código 2 si detecta un posible secreto sin redactar.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface Line { n: number; t: number | null; iso: string; text: string }
interface Ev { kind: string; t: number; n: number; text: string; data?: Record<string, string | number> }

const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s(.*)$/;

function parseLines(raw: string): Line[] {
  const out: Line[] = [];
  let last: number | null = null;
  raw.split(/\r?\n/).forEach((l, i) => {
    const m = STAMP.exec(l);
    if (m) {
      const t = Date.parse(m[1]);
      last = Number.isNaN(t) ? last : t;
      out.push({ n: i + 1, t: Number.isNaN(t) ? last : t, iso: m[1], text: m[2] });
    } else if (l.trim()) {
      out.push({ n: i + 1, t: last, iso: '', text: l });
    }
  });
  return out;
}

const RULES: Array<[RegExp, string, (m: RegExpExecArray) => Record<string, string | number> | undefined]> = [
  [/Ready in\s+([\d.]+\s*\w+)/, 'app.ready', (m) => ({ en: m[1] })],
  [/\[SessionManager\] Created session (\S+)/, 'manager.session_created', (m) => ({ sesion: m[1] })],
  [/\[SessionManager\] Creating new bridge for (\S+)/, 'manager.bridge_create', (m) => ({ idioma: m[1] })],
  [/\[SessionManager\] Reusing existing bridge for (\S+)/, 'manager.bridge_reuse', (m) => ({ idioma: m[1] })],
  [/\[SessionManager\] No more subscribers for (\S+)/, 'manager.bridge_teardown', (m) => ({ idioma: m[1] })],
  [/\[SessionManager\] Unsubscribed from (\S+) .*\((\d+) remaining\)/, 'manager.unsubscribe', (m) => ({ idioma: m[1], restantes: Number(m[2]) })],
  [/Starting bridge for session (\S+)/, 'bridge.start', (m) => ({ sesion: m[1] })],
  [/Joined room as (\S+)/, 'livekit.joined', (m) => ({ identidad: m[1] })],
  [/Published translated audio track/, 'livekit.published', () => undefined],
  [/Waiting for organizer/, 'livekit.waiting_organizer', () => undefined],
  [/Subscribed to organizer audio track, piping to Gemini/, 'livekit.subscribed_organizer', () => undefined],
  [/Bridge is active/, 'bridge.active', () => undefined],
  [/Stopping bridge/, 'bridge.stop', () => undefined],
  [/Organizer (\S+) disconnected, stopping bridge/, 'livekit.organizer_left', (m) => ({ identidad: m[1] })],
  [/Disconnected from room/, 'livekit.disconnected', () => undefined],
  [/Gemini WebSocket connected/, 'gemini.connected', () => undefined],
  [/Sending Gemini setup \(resuming: (true|false)\)/, 'gemini.setup_sent', (m) => ({ reanuda: m[1] })],
  [/Gemini reconnect setup complete/, 'gemini.reconnect_setup_complete', () => undefined],
  [/Gemini setup complete/, 'gemini.setup_complete', () => undefined],
  [/Gemini reconnect WebSocket opened/, 'gemini.reconnect_opened', () => undefined],
  [/Received goAway message from Gemini\. Time left: (\S+)\./, 'gemini.goaway', (m) => ({ timeLeft: m[1] })],
  [/Reconnecting Gemini WebSocket with handle: (.+?)\.{3}\s*$/, 'gemini.reconnect_start', (m) => ({ handle: m[1].trim() === 'none' ? 'none' : 'presente' })],
  [/Reconnecting Gemini WebSocket\.\.\./, 'gemini.reconnect_after_close', () => undefined],
  [/Reconnection already in progress/, 'gemini.reconnect_duplicate', () => undefined],
  [/Gracefully closing old Gemini WebSocket/, 'gemini.old_closed', () => undefined],
  [/Gemini reconnect WebSocket closed.*?code:\s*(\d+)(?:.*?reason:\s*'([^']*)')?/, 'gemini.reconnect_closed', (m) => ({ code: Number(m[1]), reason: m[2] ?? '' })],
  [/Gemini WebSocket closed.*?code:\s*(\d+)(?:.*?reason:\s*'([^']*)')?/, 'gemini.closed', (m) => ({ code: Number(m[1]), reason: m[2] ?? '' })],
  [/Gemini WebSocket closed/, 'gemini.closed', () => undefined],
  [/Gemini setup timeout/, 'error.setup_timeout', () => undefined],
  [/Received audio frame #(\d+) from Gemini/, 'audio.rx', (m) => ({ n: Number(m[1]) })],
  [/Sent audio frame #(\d+) to Gemini/, 'audio.tx', (m) => ({ n: Number(m[1]) })],
  [/Audio resumed after (\d+)ms gap \(frame #(\d+)\)/, 'audio.gap', (m) => ({ ms: Number(m[1]), frame: Number(m[2]) })],
  [/Final Transcription:/, 'gemini.transcript_final', () => undefined],
  [/AudioSource closed/, 'error.audiosource_closed', () => undefined],
];

function classify(lines: Line[]): Ev[] {
  const evs: Ev[] = [];
  for (const l of lines) {
    if (l.t === null) continue;
    let matched = false;
    for (const [re, kind, fn] of RULES) {
      const m = re.exec(l.text);
      if (m) { evs.push({ kind, t: l.t, n: l.n, text: l.text, data: fn(m) }); matched = true; break; }
    }
    if (!matched && /\b(error|Error|ERROR|failed|Failed|unhandled|ECONN|ETIMEDOUT|403|401|429)\b/.test(l.text)) {
      evs.push({ kind: 'error.other', t: l.t, n: l.n, text: l.text });
    }
  }
  return evs;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/AIza[A-Za-z0-9_-]{20,}/, 'clave de API de Google'],
  [/key=[A-Za-z0-9_-]{20,}/, 'parámetro key= en una URL'],
  [/with handle: [A-Za-z0-9+/=_-]{20,}/, 'handle de reanudación completo'],
  [/"(?:handle|newHandle)"\s*:\s*"(?![^"]*\[redactado)[^"]{20,}"/, 'handle de reanudación completo en JSON'],
  [/API[_ ]?SECRET\s*[=:]\s*\S{10,}/i, 'secreto de LiveKit'],
];

function fmtClock(ms: number, t0: number): string {
  const s = Math.max(0, Math.round((ms - t0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
const sec = (ms: number) => (ms / 1000).toFixed(1) + ' s';

export interface Renewal {
  idx: number; goAwayT: number; timeLeft: string; reconnectStartT?: number; openedT?: number; setupCompleteT?: number;
  oldClosedT?: number; closedCodes: Array<{ t: number; code?: number; reason?: string }>; handle: string;
  rxBefore?: number; rxAfter?: number; rxAfterT?: number; firstGapAfter?: { t: number; ms: number };
  txBefore?: number; txAfter?: number;
}

export function analyze(raw: string): { md: string; secretHits: Array<{ n: number; what: string }>; ok: Record<string, boolean | null> } {
  const lines = parseLines(raw);
  const secretHits: Array<{ n: number; what: string }> = [];
  for (const l of lines) for (const [re, what] of SECRET_PATTERNS) if (re.test(l.text)) secretHits.push({ n: l.n, what });

  const evs = classify(lines);
  const stamped = lines.filter((l) => l.t !== null && l.iso !== '');
  const t0 = stamped.length ? (stamped[0].t as number) : 0;
  const tEnd = stamped.length ? (stamped[stamped.length - 1].t as number) : 0;
  const durationMs = tEnd - t0;
  const first = (k: string) => evs.find((e) => e.kind === k);
  const all = (k: string) => evs.filter((e) => e.kind === k);
  const lastBefore = (k: string, t: number) => [...evs].reverse().find((e) => e.kind === k && e.t <= t);
  const firstAfter = (k: string, t: number, limitMs = Infinity) => evs.find((e) => e.kind === k && e.t > t && e.t - t <= limitMs);

  // Renovaciones: una por goAway
  const renewals: Renewal[] = all('gemini.goaway').map((g, i) => {
    const r: Renewal = { idx: i + 1, goAwayT: g.t, timeLeft: String(g.data?.timeLeft ?? '?'), closedCodes: [], handle: '?' };
    const rs = firstAfter('gemini.reconnect_start', g.t - 1, 120_000);
    if (rs) { r.reconnectStartT = rs.t; r.handle = String(rs.data?.handle ?? '?'); }
    const op = firstAfter('gemini.reconnect_opened', g.t, 120_000); if (op) r.openedT = op.t;
    const sc = firstAfter('gemini.reconnect_setup_complete', g.t, 120_000); if (sc) r.setupCompleteT = sc.t;
    const oc = firstAfter('gemini.old_closed', g.t, 120_000); if (oc) r.oldClosedT = oc.t;
    for (const c of evs.filter((e) => (e.kind === 'gemini.closed' || e.kind === 'gemini.reconnect_closed') && e.t >= g.t && e.t - g.t <= 120_000)) {
      r.closedCodes.push({ t: c.t, code: c.data?.code as number | undefined, reason: c.data?.reason as string | undefined });
    }
    const rb = lastBefore('audio.rx', g.t); if (rb) r.rxBefore = rb.data?.n as number;
    const tb = lastBefore('audio.tx', g.t); if (tb) r.txBefore = tb.data?.n as number;
    const after = r.setupCompleteT ?? g.t;
    const ra = firstAfter('audio.rx', after); if (ra) { r.rxAfter = ra.data?.n as number; r.rxAfterT = ra.t; }
    const ta = firstAfter('audio.tx', after); if (ta) r.txAfter = ta.data?.n as number;
    const gap = firstAfter('audio.gap', g.t, 90_000); if (gap) r.firstGapAfter = { t: gap.t, ms: gap.data?.ms as number };
    return r;
  });

  // Cierres sin goAway previo (inesperados)
  const stops = [...all('bridge.stop'), ...all('livekit.organizer_left'), ...all('manager.bridge_teardown')];
  const unexpectedCloses = evs.filter((e) => (e.kind === 'gemini.closed' || e.kind === 'gemini.reconnect_closed')
    && !all('gemini.goaway').some((g) => e.t >= g.t && e.t - g.t <= 120_000)
    && !stops.some((s) => e.t >= s.t - 1000 && e.t - s.t <= 5000));
  const errors = evs.filter((e) => e.kind.startsWith('error.'));
  const fatal = errors.some((e) => e.kind === 'error.setup_timeout') || all('bridge.stop').some((s) => !all('manager.bridge_teardown').some((d) => Math.abs(d.t - s.t) < 2000) && !all('livekit.organizer_left').some((o) => Math.abs(o.t - s.t) < 2000));

  const lastRx = [...all('audio.rx')].pop();
  const firstRx = first('audio.rx');
  const bridgeStart = first('bridge.start');
  const lastRenewal = renewals[renewals.length - 1];
  const continuedAfterRenewal = lastRenewal ? (lastRenewal.rxAfter !== undefined && (lastRenewal.rxBefore === undefined || lastRenewal.rxAfter > lastRenewal.rxBefore)) : null;

  const ok: Record<string, boolean | null> = {
    'aplicación inicia': Boolean(first('app.ready')),
    'LiveKit conecta (puente entra a la sala)': Boolean(first('livekit.joined')),
    'Gemini conecta (setup complete)': Boolean(first('gemini.setup_complete')),
    'llega audio traducido (primer fragmento de Gemini)': Boolean(firstRx),
    'duración ≥ 12 min': durationMs >= 12 * 60_000,
    'al menos un goAway': renewals.length >= 1,
    'reconexión con handle presente': renewals.length ? renewals.every((r) => r.handle === 'presente') : null,
    'nueva conexión confirmada (reconnect setup complete) tras cada goAway': renewals.length ? renewals.every((r) => r.setupCompleteT !== undefined) : null,
    'la traducción continúa después de la última renovación': continuedAfterRenewal,
    'sin error fatal (setup timeout, puente detenido por error)': !fatal,
    'sin cierres de Gemini fuera de una renovación': unexpectedCloses.length === 0,
  };

  const L: string[] = [];
  L.push('# Análisis de la consola — Fase 0 (código original de Google)');
  L.push('');
  L.push(`Fuente: consola capturada con \`tools/fase0-run.ps1\`. Líneas con marca de tiempo: ${stamped.length}. Inicio ${stamped[0]?.iso ?? '?'} · fin ${stamped[stamped.length - 1]?.iso ?? '?'} · duración **${fmtClock(tEnd, t0)}** (${Math.round(durationMs / 60_000)} min).`);
  L.push('');
  if (secretHits.length) {
    L.push(`> **ATENCIÓN: ${secretHits.length} línea(s) con posible secreto sin redactar.** No commitear este log hasta corregirlo. Líneas: ${secretHits.map((s) => `${s.n} (${s.what})`).join(', ')}.`);
    L.push('');
  }
  L.push('## Criterios de la Fase 0 comprobables desde la consola');
  L.push('');
  L.push('| Criterio | Resultado |');
  L.push('|---|---|');
  for (const [k, v] of Object.entries(ok)) L.push(`| ${k} | ${v === null ? 'sin datos' : v ? 'CUMPLE' : '**NO CUMPLE**'} |`);
  L.push('');
  L.push('Los criterios humanos (teléfono real: se oye inglés, corte perceptible, repetición, pérdida, tocar Play, reconexión de LiveKit) están en `observacion-oyente.md`.');
  L.push('');
  L.push('## Arranque');
  L.push('');
  const row = (label: string, e?: Ev) => L.push(`| ${label} | ${e ? fmtClock(e.t, t0) : '—'} | ${e ? e.text.slice(0, 110) : ''} |`);
  L.push('| Hito | Reloj | Línea |'); L.push('|---|---|---|');
  row('Aplicación lista', first('app.ready'));
  row('Sesión creada', first('manager.session_created'));
  row('Puente creado', first('manager.bridge_create'));
  row('Puente entra a la sala de LiveKit', first('livekit.joined'));
  row('Pista traducida publicada', first('livekit.published'));
  row('Gemini WebSocket conectado', first('gemini.connected'));
  row('Gemini setup completo', first('gemini.setup_complete'));
  row('Suscrito al audio de la cabina', first('livekit.subscribed_organizer'));
  row('Primer fragmento enviado a Gemini', first('audio.tx'));
  row('Primer fragmento de audio traducido recibido', firstRx);
  if (bridgeStart && firstRx) L.push(`\nDesde el inicio del puente hasta el primer audio traducido: **${sec(firstRx.t - bridgeStart.t)}** (incluye entrar a la sala, conectar Gemini y esperar a que la cabina hable; no es la latencia del modelo).`);
  L.push('');
  L.push(`## Renovaciones de Gemini (${renewals.length})`);
  L.push('');
  if (!renewals.length) L.push('No se registró ningún `goAway`. Si la prueba duró más de 10 min sin goAway, revisar si la cabina estaba publicando audio y si el puente seguía activo.');
  for (const r of renewals) {
    L.push(`### Renovación ${r.idx} — goAway a las ${fmtClock(r.goAwayT, t0)} (timeLeft: ${r.timeLeft})`);
    L.push('');
    L.push('| Paso | Reloj | Δ desde goAway |'); L.push('|---|---|---|');
    const step = (label: string, t?: number) => L.push(`| ${label} | ${t !== undefined ? fmtClock(t, t0) : '—'} | ${t !== undefined ? sec(t - r.goAwayT) : '—'} |`);
    step(`Reconexión iniciada (handle: ${r.handle})`, r.reconnectStartT);
    step('Nueva conexión abierta', r.openedT);
    step('Nueva conexión confirmada (setupComplete)', r.setupCompleteT);
    step('Conexión vieja cerrada por el puente', r.oldClosedT);
    for (const c of r.closedCodes) step(`Cierre de WebSocket (code ${c.code ?? '?'}${c.reason ? `, "${c.reason}"` : ''})`, c.t);
    L.push('');
    L.push(`- Audio recibido de Gemini: último fragmento antes del goAway #${r.rxBefore ?? '?'}; primero después de la confirmación #${r.rxAfter ?? '—'}${r.rxAfterT !== undefined && r.setupCompleteT !== undefined ? ` (${sec(r.rxAfterT - r.setupCompleteT)} después de confirmar)` : ''}. Nota: el código original solo imprime los fragmentos #1–3 y cada 100, así que el conteo es grueso.`);
    L.push(`- Audio enviado a Gemini: antes #${r.txBefore ?? '?'}, después #${r.txAfter ?? '—'} (impresión cada 500).`);
    L.push(r.firstGapAfter ? `- Hueco de audio detectado por el código original: **${(r.firstGapAfter.ms / 1000).toFixed(1)} s** (a las ${fmtClock(r.firstGapAfter.t, t0)}). El código solo reporta huecos > 2 s; un hueco menor no aparece.` : '- Sin hueco > 2 s reportado en los 90 s posteriores al goAway (el código original no detecta huecos menores).');
    L.push('');
  }
  if (unexpectedCloses.length) {
    L.push('## Cierres de Gemini fuera de una renovación');
    L.push('');
    for (const c of unexpectedCloses) L.push(`- ${fmtClock(c.t, t0)} · ${c.text.slice(0, 140)}`);
    L.push('');
  }
  L.push(`## Errores (${errors.length})`);
  L.push('');
  if (!errors.length) L.push('Ninguna línea con error, timeout o fallo.');
  for (const e of errors.slice(0, 50)) L.push(`- ${fmtClock(e.t, t0)} · línea ${e.n} · ${e.text.slice(0, 160)}`);
  if (errors.length > 50) L.push(`- … y ${errors.length - 50} más`);
  L.push('');
  L.push('## Actividad de audio');
  L.push('');
  L.push(`- Fragmentos recibidos de Gemini (último impreso): #${lastRx?.data?.n ?? '—'}. Huecos > 2 s reportados: ${all('audio.gap').length}${all('audio.gap').length ? ' → ' + all('audio.gap').map((g) => `${fmtClock(g.t, t0)} (${((g.data?.ms as number) / 1000).toFixed(1)} s)`).join(', ') : ''}.`);
  L.push(`- Oyentes: altas ${all('manager.bridge_reuse').length + all('manager.bridge_create').length}, bajas ${all('manager.unsubscribe').length}, desmontajes del puente por falta de oyentes ${all('manager.bridge_teardown').length}.`);
  L.push('');
  L.push('## Línea de tiempo completa');
  L.push('');
  L.push('| Reloj | Evento | Detalle |'); L.push('|---|---|---|');
  for (const e of evs) {
    if (e.kind === 'audio.rx' || e.kind === 'audio.tx') continue;
    const d = e.data ? Object.entries(e.data).map(([k, v]) => `${k}=${v}`).join(' ') : '';
    L.push(`| ${fmtClock(e.t, t0)} | ${e.kind} | ${d || e.text.slice(0, 100).replace(/\|/g, '\\|')} |`);
  }
  L.push('');
  return { md: L.join('\n'), secretHits, ok };
}

if (process.argv[1] && /analizar-consola-fase0\.(ts|js)$/.test(process.argv[1])) {
  const path = process.argv[2];
  if (!path || !existsSync(path)) {
    console.error('Uso: npm run fase0:analizar -- evidencia/fase-0/consola-dev.txt');
    process.exit(1);
  }
  const { md, secretHits } = analyze(readFileSync(path, 'utf8'));
  const out = join(dirname(path), 'analisis-consola.md');
  writeFileSync(out, md);
  console.log(md);
  console.log(`\nEscrito: ${out}`);
  if (secretHits.length) {
    console.error(`\nATENCIÓN: ${secretHits.length} posible(s) secreto(s) sin redactar. No commitear el log.`);
    process.exit(2);
  }
}
