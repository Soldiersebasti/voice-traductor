/**
 * Revisión de secretos antes de commitear evidencia.
 *
 * Revisa (1) los archivos preparados para commit (`git diff --cached`) y
 * (2) la carpeta `evidencia/` completa, y falla si encuentra:
 *   - archivos .env / .env.local / llaves privadas preparados para commit;
 *   - claves de API de Google (AIza…), OpenAI/DashScope (sk-…), LiveKit (API…);
 *   - asignaciones de secretos (LIVEKIT_API_SECRET=…, GEMINI_API_KEY=…, PASSWORD=…, TOKEN=…);
 *   - URLs con credenciales (usuario:clave@ o ?key=… / ?token=…);
 *   - handles completos de reanudación de Gemini;
 *   - tokens JWT (eyJ….eyJ….…);
 *   - bloques de llave privada.
 *
 * Uso:  npm run secretos            (revisa lo preparado para commit y evidencia/)
 *       npm run secretos -- --dir <carpeta>   (revisa además esa carpeta)
 * Sale con 0 si está limpio y con 2 si encuentra algo. Nunca imprime el secreto completo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

interface Finding { file: string; line: number; what: string; excerpt: string }

const FORBIDDEN_PATHS: Array<[RegExp, string]> = [
  [/(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/, 'archivo .env'],
  [/\.(pem|key|p12|pfx)$/i, 'llave o certificado privado'],
  [/(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/, 'llave SSH'],
];
const ALLOWED_PATHS = [/(^|\/)\.env\.example$/];

const PATTERNS: Array<[RegExp, string]> = [
  [/AIza[0-9A-Za-z_-]{30,}/, 'clave de API de Google'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'clave de API tipo sk- (OpenAI / DashScope)'],
  [/\bAPI[A-Za-z0-9]{10,}\b/, 'clave de API de LiveKit (API…)'],
  [/\b(LIVEKIT_API_SECRET|LIVEKIT_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY|DASHSCOPE_API_KEY|BROADCAST_PASSWORD|[A-Z_]*API_SECRET|[A-Z_]*SECRET_KEY|[A-Z_]*PASSWORD|[A-Z_]*ACCESS_TOKEN)\s*[=:]\s*['"]?[^\s'"`<>.…()]{8,}/, 'asignación de secreto con valor'],
  [/[a-z][a-z0-9+.-]*:\/\/[^\s\/:@`]+:[^\s\/@`]{3,}@/i, 'URL con usuario:clave@'],
  [/[?&](key|token|apikey|api_key|secret|password|access_token)=[^&\s"'`<>()]{8,}/i, 'URL con credencial en la query'],
  [/with handle: [A-Za-z0-9+/=_-]{20,}/, 'handle de reanudación de Gemini completo'],
  [/"(handle|newHandle)"\s*:\s*"(?![^"]*\[redactado)[^"]{20,}"/, 'handle de reanudación de Gemini completo (JSON)'],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'token JWT'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'bloque de llave privada'],
];

function redact(s: string): string {
  const t = s.trim();
  return t.length <= 10 ? '…' : `${t.slice(0, 6)}…[${t.length} car.]`;
}

function scanText(file: string, text: string, out: Finding[]): void {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [re, what] of PATTERNS) {
      const m = re.exec(line);
      if (m) out.push({ file, line: i + 1, what, excerpt: redact(m[0]) });
    }
  });
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function git(args: string[]): string {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

export function review(opts: { extraDirs?: string[]; cwd?: string } = {}): { findings: Finding[]; forbidden: Array<{ file: string; what: string }>; scanned: number } {
  const cwd = opts.cwd ?? process.cwd();
  const findings: Finding[] = [];
  const forbidden: Array<{ file: string; what: string }> = [];
  let scanned = 0;

  // 1. Archivos preparados para commit
  const staged = git(['-C', cwd, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
  for (const f of staged) {
    if (!ALLOWED_PATHS.some((re) => re.test(f))) {
      for (const [re, what] of FORBIDDEN_PATHS) if (re.test(f)) forbidden.push({ file: f, what });
    }
    const content = git(['-C', cwd, 'show', `:${f}`]);
    if (!content) continue;
    const buf = Buffer.from(content, 'utf8');
    if (buf.length > 5_000_000 || isBinary(buf)) continue;
    scanned++;
    scanText(`[staged] ${f}`, content, findings);
  }

  // 2. evidencia/ completa y carpetas extra
  const dirs = [join(cwd, 'evidencia'), ...(opts.extraDirs ?? []).map((d) => resolve(cwd, d))];
  for (const d of dirs) {
    for (const p of walk(d)) {
      const rel = relative(cwd, p).replace(/\\/g, '/');
      if (!ALLOWED_PATHS.some((re) => re.test(rel))) {
        for (const [re, what] of FORBIDDEN_PATHS) if (re.test(rel)) forbidden.push({ file: rel, what });
      }
      const buf = readFileSync(p);
      if (buf.length > 5_000_000 || isBinary(buf)) continue;
      scanned++;
      scanText(rel, buf.toString('utf8'), findings);
    }
  }
  return { findings, forbidden, scanned };
}

if (process.argv[1] && /revisar-secretos\.(ts|js)$/.test(process.argv[1])) {
  const extraDirs: string[] = [];
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--dir' && process.argv[i + 1]) extraDirs.push(process.argv[++i]);
  const { findings, forbidden, scanned } = review({ extraDirs });
  const bad = findings.length + forbidden.length;
  if (bad === 0) {
    console.log(`Revisión de secretos: ${scanned} archivo(s) revisados (preparados para commit + evidencia/). Sin secretos. Se puede commitear.`);
    process.exit(0);
  }
  console.error(`Revisión de secretos: ${bad} problema(s) en ${scanned} archivo(s). NO commitear hasta corregir.`);
  for (const f of forbidden) console.error(`  - ${f.file}: ${f.what} preparado para commit`);
  for (const f of findings) console.error(`  - ${f.file}:${f.line}: ${f.what} (${f.excerpt})`);
  process.exit(2);
}
