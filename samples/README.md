# Material de prueba

Poner aquí las grabaciones de sermones. Esta carpeta está ignorada por git salvo este archivo.

Recomendado:

- 3 a 5 fragmentos de 10 a 15 minutos y una prédica completa de 60 minutos.
- Tomados de la consola de sonido, no de un micrófono de ambiente.
- Que incluyan lectura bíblica, oración, predicación rápida y algún tramo con música de fondo.

Formato: cualquier cosa que ffmpeg entienda (mp3, m4a, wav, ...). El comando
`npm run bench -- prepare` los convierte a WAV mono 16-bit a la tasa que necesita cada motor.
