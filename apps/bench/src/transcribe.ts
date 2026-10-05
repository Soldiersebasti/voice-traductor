import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sleep } from '@voice-traductor/engines';

const execFileP = promisify(execFile);

export interface ReferenceSegment {
  id: number;
  start: number; // ms
  end: number; // ms
  text: string;
}

export interface Reference {
  source: string;
  language: string;
  model: string;
  createdAt: string;
  segments: ReferenceSegment[];
}

export interface TranscribeOptions {
  input: string;
  out: string;
  apiKey: string;
  language?: string;
  model?: string;
  pieceSec?: number;
  log?: (line: string) => void;
}

/**
 * Transcripción de referencia del audio original con marcas de tiempo por
 * segmento (whisper-1, verbose_json). El archivo se parte en trozos de 10 min
 * con ffmpeg para respetar el límite de tamaño de la API.
 */
export async function transcribeReference(o: TranscribeOptions): Promise<Reference> {
  const log = o.log ?? (() => {});
  const model = o.model ?? 'whisper-1';
  const pieceSec = o.pieceSec ?? 600;
  const tmp = mkdtempSync(join(tmpdir(), 'bench-transcribe-'));
  try {
    await execFileP('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-i', o.input, '-f', 'segment', '-segment_time', String(pieceSec), '-reset_timestamps', '1', '-ac', '1', '-ar', '16000', '-b:a', '48k', join(tmp, 'parte_%03d.mp3')]);
    const pieces = readdirSync(tmp).filter((f) => f.endsWith('.mp3')).sort();
    const segments: ReferenceSegment[] = [];
    for (let i = 0; i < pieces.length; i++) {
      log(`Transcribiendo parte ${i + 1} de ${pieces.length}...`);
      const offset = i * pieceSec * 1000;
      const result = await callWhisper(join(tmp, pieces[i]), o.apiKey, model, o.language);
      for (const s of result) segments.push({ id: segments.length + 1, start: Math.round(offset + s.start * 1000), end: Math.round(offset + s.end * 1000), text: s.text.trim() });
    }
    const ref: Reference = { source: o.input, language: o.language ?? 'auto', model, createdAt: new Date().toISOString(), segments };
    writeFileSync(o.out, JSON.stringify(ref, null, 2));
    writeFileSync(o.out.replace(/\.json$/, '') + '.txt', segments.map((s) => `[${(s.start / 1000).toFixed(1)}] ${s.text}`).join('\n') + '\n');
    return ref;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function callWhisper(path: string, apiKey: string, model: string, language?: string): Promise<Array<{ start: number; end: number; text: string }>> {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(path)], { type: 'audio/mpeg' }), 'audio.mp3');
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (language) form.append('language', language);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    if (res.ok) {
      const json = (await res.json()) as { segments?: Array<{ start: number; end: number; text: string }>; text?: string; duration?: number };
      if (json.segments?.length) return json.segments;
      return json.text ? [{ start: 0, end: json.duration ?? 0, text: json.text }] : [];
    }
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * attempt);
      continue;
    }
    throw new Error(`Transcripción fallida (HTTP ${res.status}): ${body.slice(0, 400)}`);
  }
}

export function loadReference(path: string): Reference {
  return JSON.parse(readFileSync(path, 'utf8')) as Reference;
}
