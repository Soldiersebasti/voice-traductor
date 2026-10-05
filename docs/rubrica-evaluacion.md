# Rúbrica para evaluadores

Gracias por ayudar. Vas a escuchar fragmentos de una prédica en español y su
traducción al inglés hecha por un sistema automático. Hay dos sistemas, A y B.
No sabes cuál es cuál y no importa: califica lo que oyes.

Para cada fragmento recibes dos archivos:

- `comparacion`: estéreo. Oído izquierdo, el pastor en español. Oído derecho,
  la traducción en inglés tal como la oiría alguien en la iglesia, con el mismo
  retraso. Úsalo para **precisión** y **retraso**.
- `traduccion`: solo la voz en inglés, sin silencios. Úsalo para **naturalidad**.

Escucha con audífonos. Puedes pausar y repetir.

## Qué calificar (1 a 5)

**Precisión.** ¿La traducción dice lo que dijo el pastor?

- 5: Todo el sentido llega. Nombres, citas bíblicas y números correctos.
- 4: Alguna palabra rara o frase torpe, pero el sentido está intacto.
- 3: Se pierde o se confunde parte del sentido; hay que adivinar.
- 2: Errores que cambian el mensaje.
- 1: Dice otra cosa, lo contrario, o inventa.

**Naturalidad.** ¿Suena como una persona hablando?

- 5: Fluida, con ritmo y entonación naturales. Podría ser un intérprete.
- 4: Clara y agradable; se nota que es sintética solo si prestas atención.
- 3: Entendible pero plana, robótica o con cortes.
- 2: Cansa escucharla; pausas raras, velocidad irregular.
- 1: Difícil de seguir.

**Voz.** Dos preguntas aparte de la naturalidad:

- ¿La voz en inglés "suena al pastor"? Sí, algo, no.
- ¿La voz cambió en algún momento de forma que distrajera, por ejemplo al
  cambiar quien hablaba o después de una pausa larga? Anota el minuto.

**Retraso.** ¿Cuánto molesta la distancia entre el pastor y la traducción?

- 5: No molesta; se siente en vivo.
- 4: Se nota pero es cómodo, como un intérprete humano.
- 3: Hay momentos en que se pierde el hilo con lo que pasa en la sala.
- 2: Molesta la mayor parte del tiempo.
- 1: Inservible.

**Estabilidad.** ¿Hubo cortes, silencios largos, frases saltadas o repetidas?

- 5: Nada raro en todo el fragmento.
- 4: Un detalle menor.
- 3: Dos o tres cosas notorias.
- 2: Frecuentes.
- 1: Se cae constantemente.

**¿Lo usarías?** Sí o no: ¿preferirías esto a no tener traducción? ¿Y a un
intérprete humano?

## Anota además

- Las citas bíblicas que oíste y si salieron bien (libro, capítulo, versículo).
- Nombres propios mal traducidos.
- Cualquier frase donde la traducción dijo algo distinto. Anota el minuto.
- Momentos donde el retraso te hizo perder el hilo. Anota el minuto.

Todo va en `plantilla-evaluacion.csv`, una fila por fragmento y sistema.
