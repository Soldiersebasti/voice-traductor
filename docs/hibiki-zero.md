# Hibiki-Zero como tercer motor del banco

Hibiki-Zero (Kyutai, ICML 2026) es un modelo abierto de interpretación
simultánea voz a voz de francés, español, portugués y alemán a inglés, de 3 mil
millones de parámetros, con transferencia de voz y latencia optimizada por
aprendizaje por refuerzo. **Licencia: el código es MIT, pero los pesos del
modelo están bajo CC BY-NC-SA 4.0 según su tarjeta en Hugging Face, es decir,
no comercial.** Sirve como laboratorio y referencia, no para el producto. Repositorio: https://github.com/kyutai-labs/hibiki-zero

## Viabilidad en tu equipo, antes de instalar nada

| Pregunta | Respuesta | Fuente |
|---|---|---|
| ¿Necesita GPU NVIDIA? | **Sí.** El código fija `device="cuda"` y exige CUDA en ambos comandos; no hay modo CPU ni AMD/Intel. | `hibiki_zero/run.py` |
| ¿Cuánta VRAM? | "8 GB deberían funcionar, 12 GB es seguro". Pesos en fp16/bf16 ≈ 6 GB más el códec Mimi y la caché de atención. Con 8 GB va justo; con 6 GB no. | README |
| ¿Cuánto pesa la descarga? | Modelo `kyutai/hibiki-zero-3b-pytorch-bf16`: ≈ 6 GB de pesos del modelo + ≈ 0,4 GB del códec Mimi + tokenizador. Total ≈ **6,5 a 7 GB**, más ≈ 3 GB de dependencias de Python (PyTorch con CUDA). | Hugging Face, pyproject |
| ¿Corre en Windows nativo? | Kyutai dice que **no lo soporta oficialmente**, "esperan que funcione". Las dependencias tienen ruedas para Windows (PyTorch CUDA, aiohttp, sounddevice, sphn hasta Python 3.12; `bitsandbytes` solo se instala en Linux y no hace falta). Es plausible, pero sin garantía. | README de moshi, pyproject de moshi |
| ¿Y en WSL2? | Es el camino con menos sorpresas: Ubuntu en WSL2 usa la GPU con el driver normal de Windows, sin instalar CUDA aparte. El banco (Node) puede quedarse en Windows: WSL2 reenvía `localhost`. | docs de NVIDIA/WSL |
| ¿Tiempo real garantizado? | No. Cada cuadro de 80 ms debe calcularse en menos de 80 ms. En una RTX 3060/4060 de 8 a 12 GB debería ir en tiempo real, pero hay que **medirlo**: el diagnóstico reporta la velocidad de entrega. Si es menor que 1x, el retraso crece por la GPU y la corrida no sirve para comparar política. | — |
| ¿Límite de duración? | El comando `generate` está limitado a 120 s por archivo; el modo `serve` **no tiene límite**: es un WebSocket persistente. Lo que no se sabe es cómo se comporta el modelo tras muchos minutos (Hibiki v1 usaba contexto de 40 s). La corrida base lo mostrará. | `run.py`, `inference.py` |
| ¿Varios clientes? | **Uno a la vez**: el servidor serializa las conexiones con un candado. Cerrar la pestaña de la interfaz web antes de correr el banco. | `inference.py` |
| ¿Cómo detectar si el PC cumple? | En PowerShell: `nvidia-smi` muestra el modelo de GPU, el driver y "xxxx MiB" de memoria total. Si el comando no existe, no hay driver NVIDIA. También: Administrador de tareas → Rendimiento → GPU → "Memoria de GPU dedicada". Para WSL2: `wsl -l -v` debe mostrar versión 2, y dentro de Ubuntu `nvidia-smi` debe ver la misma GPU. | — |

### Si el PC no tiene GPU suficiente

La opción más sencilla es alquilar una GPU por una hora. En RunPod, Vast.ai o
Lambda, una RTX 3090/4090 o una A10 cuesta entre 0,3 y 0,7 USD por hora; la
prueba completa toma menos de una hora. Se corre allí `hibiki-zero serve` y el
puente, y desde Windows se abre un túnel SSH (`ssh -L 8999:localhost:8999 usuario@servidor`)
para que el banco se conecte a `localhost` como si fuera local. El puente mide
la ida y vuelta de red con ping para descontarla al comparar. Google Colab con
una T4 también puede servir con `--gradio-tunnel`, pero la T4 es lenta para un
modelo de 3B en tiempo real y conviene verificar la velocidad de entrega.

## Cómo encaja en el banco

```
samples/PS1.mp3 → bench (Node, Windows) → tools/hibiki_bridge.py (Python, WSL o Windows) → hibiki-zero serve (GPU)
                                   ← PCM16 24 kHz + texto                           ← Opus + texto (protocolo Moshi)
```

- `hibiki-zero serve` habla el protocolo de Moshi: WebSocket en `/api/chat`, saludo `0x00`, audio Opus con prefijo `0x01`, texto con prefijo `0x02`.
- El puente usa las mismas librerías que el cliente oficial (`sphn` para Opus, `aiohttp`) y expone a Node JSON con PCM16 en base64. Aporta menos de 2 ms.
- El adaptador `hibiki` del banco es simétrico al de OpenAI: audio enviado cada 100 ms al ritmo real, salida reproducida según llega, mismos eventos, mismas marcas de tiempo, mismos archivos. Los comandos `judge`, `diagnose` y `report` no cambian. No hay ninguna métrica especial.
- Diferencias de condiciones que hay que tener presentes al comparar: OpenAI incluye la ida y vuelta por internet (50 a 150 ms) y Hibiki local no; Hibiki depende de la GPU del equipo. El diagnóstico reporta ambas cosas.
- Si Hibiki cerrara la sesión a mitad de corrida, el adaptador abre otra y lo registra como reconexión, igual que con OpenAI y Gemini, sin perder audio (lo guarda hasta 10 s).

## Instalación (solo cuando se confirme la GPU)

Opción recomendada, WSL2 con Ubuntu:

```bash
# Dentro de Ubuntu (WSL2). Primero comprobar que la GPU se ve:
nvidia-smi
# Entorno con hibiki-zero (uv instala Python 3.13 y las dependencias; descarga ≈ 3 GB)
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv --python 3.13 ~/hibiki && source ~/hibiki/bin/activate
uv pip install hibiki-zero
# Servidor (la primera vez descarga ≈ 7 GB de pesos a ~/.cache/huggingface)
hibiki-zero serve
```

En una segunda terminal de Ubuntu, con el mismo entorno activado, el puente
(el repositorio de Windows se ve en WSL bajo `/mnt/c/...`):

```bash
source ~/hibiki/bin/activate
python /mnt/c/ruta/al/repo/tools/hibiki_bridge.py --listen 127.0.0.1:8999 --upstream ws://127.0.0.1:8998/api/chat
```

Windows nativo, sin garantía oficial:

```powershell
py -3.12 -m venv hibiki-env
.\hibiki-env\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install hibiki-zero
hibiki-zero serve
# segunda terminal
.\hibiki-env\Scripts\activate
python tools\hibiki_bridge.py
```

Comprobación rápida antes del banco: abrir http://localhost:8998 en el
navegador, hablar unos segundos y oír la traducción. **Cerrar esa pestaña**
antes de correr el banco, porque el servidor atiende un cliente a la vez.

## La corrida base

```powershell
npm.cmd run bench -- run --engine hibiki --input samples/PS1.mp3 --label continua-ps1 --mp3
npm.cmd run bench -- judge --run runs/continua-ps1-hibiki --reference samples/PS1.referencia.json
npm.cmd run bench -- diagnose --run runs/continua-ps1-hibiki --reference samples/PS1.referencia.json
npm.cmd run bench -- report runs/continua-ps1-openai runs/continua-ps1-hibiki
```

La etiqueta `continua-ps1` produce la carpeta `runs/continua-ps1-hibiki`, al
lado de `runs/continua-ps1-openai`, y el reporte compara las dos con las
mismas filas: calidad del juez, inicio→inicio y fin→fin con mediana y p90,
porcentaje del tiempo sobre 3 s, deriva, huecos y silencios con la fuente
hablando, omisiones, porcentaje de frases que empiezan antes de que el pastor
termine, y estabilidad.

Variables de entorno opcionales en `.env`: `HIBIKI_BRIDGE_URL`, `HIBIKI_URL`,
`HIBIKI_AUTOSTART=1` con `HIBIKI_PYTHON` para que el banco lance el puente
solo (útil en Windows nativo; en WSL es más simple lanzarlo a mano).

## Qué mirar en la corrida base, sin optimizar nada

1. En `diagnostico.md`, la velocidad de entrega: si es menor que 1x, la GPU no da para tiempo real y la corrida no es comparable.
2. En `juez.md`, inicio→inicio y fin→fin, el porcentaje de tiempo sobre 3 s y la deriva: la pregunta es si Hibiki sostiene 2 a 3 s en habla continua o también acumula.
3. Calidad: puntaje medio, frases críticas y omisiones. Hibiki-Zero no está entrenado en vocabulario bíblico; aquí puede perder frente a OpenAI.
4. Voz: Hibiki transfiere la voz del pastor; anotar si suena natural.
5. Estabilidad: reconexiones, huecos y qué pasa pasados los 5 y 10 minutos.
