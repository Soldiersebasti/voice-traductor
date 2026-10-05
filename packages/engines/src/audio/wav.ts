import { closeSync, openSync, readFileSync, readSync, writeSync } from 'node:fs';

export interface WavData {
  sampleRate: number;
  channels: number;
  /** Muestras intercaladas por canal. */
  samples: Int16Array;
}

/** Lee un WAV PCM 16-bit (incluye WAVE_FORMAT_EXTENSIBLE y salidas de ffmpeg por tubería con tamaño desconocido). */
export function parseWav(buf: Buffer): WavData {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('No es un archivo WAV (falta cabecera RIFF/WAVE)');
  }
  let pos = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const sampleRate = buf.readUInt32LE(body + 4);
      const bits = buf.readUInt16LE(body + 14);
      if (format === 0xfffe && size >= 40) format = buf.readUInt16LE(body + 24);
      fmt = { format, channels, sampleRate, bits };
    } else if (id === 'data') {
      const unknown = size === 0 || size === 0xffffffff || body + size > buf.length;
      data = unknown ? buf.subarray(body) : buf.subarray(body, body + size);
      break;
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV sin chunk fmt o data');
  if (fmt.format !== 1 || fmt.bits !== 16) {
    throw new Error(`WAV no soportado (formato ${fmt.format}, ${fmt.bits} bits). Convertir con: ffmpeg -i entrada -acodec pcm_s16le salida.wav`);
  }
  const n = data.length >> 1;
  const samples = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + n * 2));
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples };
}

export function readWav(path: string): WavData {
  return parseWav(readFileSync(path));
}

/** Tasa de muestreo y canales sin cargar el archivo completo. */
export function readWavHeader(path: string): { sampleRate: number; channels: number } {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(4096);
    const n = readSync(fd, head, 0, head.length, 0);
    const w = parseWav(head.subarray(0, n));
    return { sampleRate: w.sampleRate, channels: w.channels };
  } finally {
    closeSync(fd);
  }
}

export function toMono(w: WavData): Int16Array {
  if (w.channels === 1) return w.samples;
  const frames = Math.floor(w.samples.length / w.channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < w.channels; c++) acc += w.samples[i * w.channels + c];
    out[i] = Math.round(acc / w.channels);
  }
  return out;
}

function header(dataBytes: number, sampleRate: number, channels: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Escritor WAV incremental: escribe muestras según llegan y corrige la cabecera al cerrar. */
export class WavWriter {
  private fd: number;
  private bytes = 0;
  private closed = false;

  constructor(
    public readonly path: string,
    public readonly sampleRate: number,
    public readonly channels = 1,
  ) {
    this.fd = openSync(path, 'w');
    writeSync(this.fd, header(0, sampleRate, channels));
  }

  /** `pcm` intercalado si hay más de un canal. */
  write(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const b = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    writeSync(this.fd, b);
    this.bytes += b.length;
  }

  /** Escribe `frames` cuadros de silencio (un cuadro = una muestra por canal). */
  writeSilence(frames: number): void {
    let left = Math.max(0, Math.floor(frames)) * this.channels;
    const block = new Int16Array(Math.min(left, 1 << 20));
    while (left > 0) {
      const n = Math.min(left, block.length);
      this.write(n === block.length ? block : block.subarray(0, n));
      left -= n;
    }
  }

  /** Cuadros escritos hasta ahora. */
  get frames(): number {
    return this.bytes / 2 / this.channels;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    writeSync(this.fd, header(this.bytes, this.sampleRate, this.channels), 0, 44, 0);
    closeSync(this.fd);
  }
}

export function writeWav(path: string, channels: Int16Array[], sampleRate: number): void {
  const w = new WavWriter(path, sampleRate, channels.length);
  if (channels.length === 1) {
    w.write(channels[0]);
  } else {
    const frames = Math.max(...channels.map((c) => c.length));
    const inter = new Int16Array(frames * channels.length);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels.length; c++) inter[i * channels.length + c] = channels[c][i] ?? 0;
    }
    w.write(inter);
  }
  w.close();
}
