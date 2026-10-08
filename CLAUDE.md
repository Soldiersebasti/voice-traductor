# Voice Traductor — puerta de entrada para sesiones de Claude Code

1. **Qué leer, en orden:** `PROJECT_CONTRACT.md` → `PROJECT_STATUS.md` (empieza en "START HERE FOR AI") → últimas entradas de `BITACORA.md` → `DECISIONS.md` si la tarea toca arquitectura → `INFRAESTRUCTURA.md` si toca servidores, claves o despliegue. Antes de tocar cualquier archivo.
2. **Fuente de verdad:** esos cinco documentos, hasta que exista el repositorio del PRODUCTO (privado, derivado de `google-gemini/gemini-live-translate-livekit`); entonces migran allí (contrato §T). Este repositorio es el **LABORATORIO** (bench, judge, diagnose), no el producto.
3. **Fase actual:** FASE 0 — `PENDIENTE`. El siguiente paso exacto está en `PROJECT_STATUS.md` §5.
4. **Reglas operativas fundamentales:** nada es HECHO sin prueba ejecutada, resultado medido y evidencia registrada · sin agentes, subagentes ni workflows salvo petición explícita del propietario · nunca pedir claves en el chat · ante un hallazgo que contradiga una decisión registrada, detenerse y reportar · al cerrar una sesión con cambios, agregar entrada a `BITACORA.md` y actualizar `PROJECT_STATUS.md` · entorno del propietario: Windows, `npm.cmd`, CMD.
