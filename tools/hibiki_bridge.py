#!/usr/bin/env python3
"""
Puente entre el banco (Node) y un servidor `hibiki-zero serve`.

El servidor de Hibiki-Zero habla el protocolo de Moshi por WebSocket en
/api/chat: el servidor envía un byte 0x00 al conectar; el cliente manda
audio Opus (flujo Ogg/Opus generado con sphn.OpusStreamWriter) con prefijo
0x01; el servidor devuelve audio Opus con prefijo 0x01 y texto UTF-8 con
prefijo 0x02. Este puente expone a Node un protocolo trivial en JSON con PCM16
en base64, usando exactamente las mismas librerías que el cliente oficial
(sphn y aiohttp), que ya vienen instaladas con hibiki-zero.

Uso:
  python tools/hibiki_bridge.py --listen 127.0.0.1:8999 --upstream ws://127.0.0.1:8998/api/chat

Protocolo con Node (JSON por mensaje de texto):
  Node → puente: {"type":"start","upstream":"ws://..."}      abre una sesión nueva con Hibiki
                 {"type":"audio","pcm":"<base64 PCM16 mono 24 kHz>"}
                 {"type":"end"}                               cierra la sesión actual
  puente → Node: {"type":"ready"}                             Hibiki respondió el saludo
                 {"type":"audio","pcm":"<base64 PCM16 mono 24 kHz>"}
                 {"type":"text","text":"..."}                 fragmento de transcripción traducida
                 {"type":"status","code":"...","message":"...","data":{...}}
                 {"type":"error","message":"..."}
                 {"type":"closed","code":..,"reason":"..."}  Hibiki cerró la conexión
"""
import argparse
import asyncio
import base64
import json
import sys
import time

try:
    import numpy as np
    import sphn
    from aiohttp import ClientSession, WSMsgType, web
except ImportError as exc:  # pragma: no cover
    sys.stderr.write(
        f"Falta una dependencia ({exc.name}). Ejecutar este puente con el mismo Python donde está instalado hibiki-zero "
        "(trae aiohttp, numpy y sphn).\n"
    )
    sys.exit(2)

SAMPLE_RATE = 24000
LOG_PREFIX = "[hibiki-bridge]"


def log(msg: str) -> None:
    sys.stderr.write(f"{LOG_PREFIX} {time.strftime('%H:%M:%S')} {msg}\n")
    sys.stderr.flush()


class Session:
    """Una conexión con Hibiki por cada 'start' recibido de Node."""

    def __init__(self, node_ws: web.WebSocketResponse, upstream: str, ping_every: float):
        self.node_ws = node_ws
        self.upstream = upstream
        self.ping_every = ping_every
        self.ws = None
        self.session = None
        self.writer = sphn.OpusStreamWriter(SAMPLE_RATE)
        self.reader = sphn.OpusStreamReader(SAMPLE_RATE)
        self.ready = asyncio.Event()
        self.closed = False
        self.tasks: list[asyncio.Task] = []
        self.audio_in_ms = 0.0
        self.audio_out_ms = 0.0

    async def open(self) -> None:
        self.session = ClientSession()
        t0 = time.time()
        self.ws = await self.session.ws_connect(self.upstream, autoping=False, max_msg_size=0)
        await self.send_json({"type": "status", "code": "session.opened", "message": f"Conectado a {self.upstream}", "data": {"connectMs": int((time.time() - t0) * 1000)}})
        self.tasks.append(asyncio.create_task(self.recv_loop()))
        self.tasks.append(asyncio.create_task(self.ping_loop()))

    async def send_json(self, obj: dict) -> None:
        if not self.node_ws.closed:
            await self.node_ws.send_str(json.dumps(obj))

    async def recv_loop(self) -> None:
        try:
            async for msg in self.ws:
                if msg.type == WSMsgType.BINARY:
                    data = msg.data
                    if not data:
                        continue
                    kind = data[0]
                    payload = data[1:]
                    if kind == 0x00:
                        if not self.ready.is_set():
                            self.ready.set()
                            await self.send_json({"type": "ready"})
                    elif kind == 0x01:
                        self.reader.append_bytes(payload)
                        pcm = self.reader.read_pcm()
                        if pcm is not None and len(pcm) > 0:
                            pcm16 = np.clip(pcm * 32768.0, -32768, 32767).astype("<i2")
                            self.audio_out_ms += len(pcm16) * 1000.0 / SAMPLE_RATE
                            await self.send_json({"type": "audio", "pcm": base64.b64encode(pcm16.tobytes()).decode("ascii")})
                    elif kind == 0x02:
                        await self.send_json({"type": "text", "text": payload.decode("utf-8", errors="replace")})
                    else:
                        await self.send_json({"type": "status", "code": "upstream.unknown", "message": f"Mensaje binario de tipo {kind} ({len(payload)} bytes)"})
                elif msg.type == WSMsgType.PONG:
                    sent = getattr(self, "_ping_sent", None)
                    if sent is not None:
                        rtt = int((time.time() - sent) * 1000)
                        await self.send_json({"type": "status", "code": "net.rtt", "message": f"Ida y vuelta: {rtt} ms", "data": {"rttMs": rtt}})
                elif msg.type == WSMsgType.TEXT:
                    await self.send_json({"type": "status", "code": "upstream.text", "message": msg.data[:200]})
                elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED):
                    break
                elif msg.type == WSMsgType.ERROR:
                    await self.send_json({"type": "error", "message": f"Error del WebSocket de Hibiki: {self.ws.exception()}"})
                    break
        except Exception as exc:  # noqa: BLE001
            await self.send_json({"type": "error", "message": f"Fallo leyendo de Hibiki: {exc!r}"})
        finally:
            if not self.closed:
                self.closed = True
                code = self.ws.close_code if self.ws is not None else None
                await self.send_json({"type": "closed", "code": code, "reason": "Hibiki cerró la conexión", "data": {"audioInMs": self.audio_in_ms, "audioOutMs": self.audio_out_ms}})

    async def ping_loop(self) -> None:
        try:
            while not self.closed and self.ws is not None and not self.ws.closed:
                await asyncio.sleep(self.ping_every)
                if self.ws.closed:
                    break
                self._ping_sent = time.time()
                await self.ws.ping()
        except Exception:  # noqa: BLE001
            pass

    async def send_audio(self, pcm16: bytes) -> None:
        if self.ws is None or self.ws.closed:
            return
        samples = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
        self.audio_in_ms += len(samples) * 1000.0 / SAMPLE_RATE
        opus = self.writer.append_pcm(samples)
        if opus:
            await self.ws.send_bytes(b"\x01" + opus)

    async def close(self) -> None:
        self.closed = True
        for t in self.tasks:
            t.cancel()
        if self.ws is not None and not self.ws.closed:
            await self.ws.close()
        if self.session is not None:
            await self.session.close()


async def handle_node(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(max_msg_size=0)
    await ws.prepare(request)
    upstream_default = request.app["upstream"]
    ping_every = request.app["ping_every"]
    session: Session | None = None
    log("Node conectado")
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                obj = json.loads(msg.data)
            except json.JSONDecodeError:
                await ws.send_str(json.dumps({"type": "error", "message": "JSON inválido"}))
                continue
            kind = obj.get("type")
            if kind == "start":
                if session is not None:
                    await session.close()
                session = Session(ws, obj.get("upstream") or upstream_default, ping_every)
                try:
                    await session.open()
                except Exception as exc:  # noqa: BLE001
                    await ws.send_str(json.dumps({"type": "error", "message": f"No se pudo conectar a Hibiki en {session.upstream}: {exc!r}", "fatal": True}))
                    session = None
            elif kind == "audio":
                if session is None:
                    continue
                await session.send_audio(base64.b64decode(obj.get("pcm", "")))
            elif kind == "end":
                if session is not None:
                    await session.close()
                    session = None
            elif kind == "ping":
                await ws.send_str(json.dumps({"type": "pong"}))
    finally:
        if session is not None:
            await session.close()
        log("Node desconectado")
    return ws


def main() -> None:
    parser = argparse.ArgumentParser(description="Puente Node ↔ hibiki-zero serve")
    parser.add_argument("--listen", default="127.0.0.1:8999", help="host:puerto donde escucha el puente (Node se conecta aquí)")
    parser.add_argument("--upstream", default="ws://127.0.0.1:8998/api/chat", help="WebSocket de hibiki-zero serve")
    parser.add_argument("--ping-every", type=float, default=15.0, help="segundos entre pings a Hibiki para medir ida y vuelta")
    args = parser.parse_args()
    host, _, port = args.listen.rpartition(":")
    app = web.Application()
    app["upstream"] = args.upstream
    app["ping_every"] = args.ping_every
    app.router.add_get("/", handle_node)
    log(f"Escuchando en ws://{host}:{port} y reenviando a {args.upstream}")
    web.run_app(app, host=host or "127.0.0.1", port=int(port), print=None)


if __name__ == "__main__":
    main()
