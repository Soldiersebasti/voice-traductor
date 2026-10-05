/**
 * Remuestreo lineal PCM16. Suficiente para audio de voz en pruebas y para el
 * motor simulado. Para preparar material real conviene ffmpeg, que filtra
 * correctamente antes de bajar la tasa.
 */
export function resampleLinear(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to || pcm.length === 0) return pcm;
  let src = pcm;
  if (to < from) {
    // Promedio móvil simple como filtro anti-alias barato antes de diezmar.
    const win = Math.ceil(from / to);
    if (win > 1) {
      src = new Int16Array(pcm.length);
      let acc = 0;
      for (let i = 0; i < pcm.length; i++) {
        acc += pcm[i];
        if (i >= win) acc -= pcm[i - win];
        src[i] = Math.round(acc / Math.min(win, i + 1));
      }
    }
  }
  const outLen = Math.max(1, Math.round((src.length * to) / from));
  const out = new Int16Array(outLen);
  const ratio = from / to;
  const last = src.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.min(last, Math.floor(pos));
    const i1 = Math.min(last, i0 + 1);
    const f = pos - i0;
    out[i] = Math.round(src[i0] * (1 - f) + src[i1] * f);
  }
  return out;
}
