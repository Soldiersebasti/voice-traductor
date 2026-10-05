import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { parseWav, readWav, resampleLinear, toMono } from '@voice-traductor/engines';

const execFileP = promisify(execFile);

export interface LoadOptions {
  /** Recortar a este máximo (ms). */
  maxMs?: number;
  /** Empezar en este punto (ms). */
  startMs?: number;
  log?: (line: string) => void;
}

/**
 * Carga cualquier archivo de audio como PCM16 mono a `rate`. Usa ffmpeg si está
 * disponible (filtra bien al cambiar de tasa). Si no, acepta WAV PCM16 y
 * remuestrea de forma lineal con un aviso.
 */
export async function loadAudioAtRate(path: string, rate: number, o: LoadOptions = {}): Promise<Int16Array> {
  const log = o.log ?? (() => {});
  try {
    const args = ['-nostdin', '-loglevel', 'error'];
    if (o.startMs) args.push('-ss', (o.startMs / 1000).toFixed(3));
    args.push('-i', path);
    if (o.maxMs) args.push('-t', (o.maxMs / 1000).toFixed(3));
    args.push('-ac', '1', '-ar', String(rate), '-acodec', 'pcm_s16le', '-f', 'wav', 'pipe:1');
    const { stdout } = await execFileP('ffmpeg', args, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 });
    return toMono(parseWav(stdout));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
    if (e.code !== 'ENOENT') {
      const detail = e.stderr ? e.stderr.toString().trim() : e.message;
      throw new Error(`ffmpeg no pudo leer ${path}: ${detail}`);
    }
    if (extname(path).toLowerCase() !== '.wav') throw new Error(`No hay ffmpeg y ${path} no es WAV. Instalar ffmpeg o convertir a WAV PCM16.`);
    log('Aviso: ffmpeg no está instalado; se usa remuestreo lineal interno (calidad menor).');
    const w = readWav(path);
    let mono = toMono(w);
    if (o.startMs || o.maxMs) {
      const a = Math.round(((o.startMs ?? 0) / 1000) * w.sampleRate);
      const b = o.maxMs ? Math.min(mono.length, a + Math.round((o.maxMs / 1000) * w.sampleRate)) : mono.length;
      mono = mono.subarray(a, b);
    }
    return resampleLinear(mono, w.sampleRate, rate);
  }
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileP('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/** Convierte un archivo a WAV PCM16 mono a `rate` (comando `prepare`). */
export async function convertToWav(input: string, output: string, rate: number, o: { startMs?: number; maxMs?: number } = {}): Promise<void> {
  const args = ['-nostdin', '-y', '-loglevel', 'error'];
  if (o.startMs) args.push('-ss', (o.startMs / 1000).toFixed(3));
  args.push('-i', input);
  if (o.maxMs) args.push('-t', (o.maxMs / 1000).toFixed(3));
  args.push('-ac', '1', '-ar', String(rate), '-acodec', 'pcm_s16le', output);
  await execFileP('ffmpeg', args);
}

export async function encodeMp3(input: string, output: string): Promise<void> {
  await execFileP('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-i', input, '-b:a', '96k', output]);
}
