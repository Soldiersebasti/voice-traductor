# Voice Traductor — instrucciones para sesiones de Claude Code

Este repositorio es el **laboratorio** de Voice Traductor (banco de pruebas, juez, diagnóstico). El **producto** se construye en un repositorio aparte derivado de `google-gemini/gemini-live-translate-livekit` (ver `DECISIONS.md` ADR-001 y ADR-011).

Antes de tocar cualquier archivo, lee en este orden:

1. `PROJECT_CONTRACT.md` — qué es el proyecto, arquitectura aprobada, principios, definición de HECHO, reglas de trabajo.
2. `PROJECT_STATUS.md` — fotografía actual: fase, estado, siguiente paso exacto, riesgos. Empieza por "START HERE FOR AI".
3. Últimas entradas de `BITACORA.md`.
4. `DECISIONS.md` si la tarea toca arquitectura; `INFRAESTRUCTURA.md` si toca servidores, claves o despliegue.

Reglas mínimas (detalle en el contrato):

- Nada se marca HECHO sin prueba ejecutada, resultado medido y evidencia registrada en `evidencia/` y `BITACORA.md`.
- No usar agentes, subagentes ni workflows salvo petición explícita del propietario.
- No pedir claves en el chat. Las claves viven en `.env` (ignorado por git).
- Si un hallazgo contradice una decisión registrada: detenerse y reportar antes de cambiar el rumbo.
- Al terminar una sesión que cambió algo: agregar entrada a `BITACORA.md` y actualizar `PROJECT_STATUS.md`.
- Entorno del propietario: Windows, `npm.cmd`, CMD. Comandos para CMD.

Comandos del laboratorio: `npm test` (43 pruebas), `npm run typecheck`, `npm run bench -- <run|judge|diagnose|replay|transcribe|phrases|synth|prepare|report>`.
