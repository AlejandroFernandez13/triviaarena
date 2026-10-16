# Trivia Arena — MVP online

Juego web en español de preguntas de conocimiento con respuestas escritas, rebotes, perfiles guardados y ligas privadas. Stack: Node.js, Express, Socket.IO y PostgreSQL. Está preparado para subir el repositorio a GitHub y desplegarlo en Render.

## Incluido en esta primera versión

- **Perfiles persistentes:** registro e inicio de sesión con contraseña cifrada; se guardan usuario, estadísticas y últimas partidas.
- **Partida rápida online:** crear sala, código para compartir, unirse mediante código y jugadores sin un límite artificial en la lógica del juego.
- **Reglas configurables:** llegar a una puntuación o jugar un número fijo de preguntas; tema elegido, aleatorio o personalizado.
- **Preguntas sin opciones:** el jugador escribe la respuesta. La pregunta rebota al siguiente jugador si falla; el punto se lo lleva quien finalmente acierte.
- **Orden de juego fijo:** se sortea al comenzar y se conserva durante la partida.
- **Desempate:** si hay empate al terminar el número de preguntas, solo los jugadores empatados participan; gana quien consiga una ventaja de dos puntos de desempate.
- **Modo liga 1 contra 1:** crear o unirse a una liga, tabla de clasificación, enfrentamientos mediante código y 3 puntos por victoria.
- **Registro de partidas:** el servidor guarda los resultados finalizados en PostgreSQL.
- **IA opcional:** con `OPENAI_API_KEY`, crea preguntas nuevas y valora respuestas por significado. Sin clave, hay un banco de respaldo y comparación local para probar el juego.

## Requisitos

- Node.js 20 o posterior.
- PostgreSQL.
- Opcional: una clave de API de OpenAI. El uso de la API puede tener un coste aparte; una suscripción de ChatGPT no incluye automáticamente crédito de API.

## Desplegar en Render + GitHub

1. Crea un repositorio nuevo en GitHub y sube **todo el contenido de esta carpeta** a la raíz del repositorio. No subas archivos `.env` ni claves secretas.
2. En Render, elige **New → Blueprint** y selecciona el repositorio. Render leerá `render.yaml`, creará el servicio Node y una base PostgreSQL.
3. Espera a que termine el primer deploy y abre la URL que Render asigne al servicio.
4. Para activar el árbitro IA, abre **Environment** en el servicio web y añade `OPENAI_API_KEY` con tu clave. Opcionalmente, configura `OPENAI_MODEL`; por defecto usa `gpt-5.5`. Guarda y deja que Render vuelva a desplegar.
5. Para verificar el servidor, abre `/health` en el dominio de la app: debe responder `{"ok":true}`.

### Importante sobre la persistencia y el plan gratuito

El blueprint está preparado para arrancar en el plan gratuito de Render para facilitar las pruebas. **Las bases PostgreSQL gratuitas de Render caducan a los 30 días**. Para que perfiles, estadísticas y ligas no desaparezcan a largo plazo, tendrás que subir la base de datos a un plan persistente de pago antes de que caduque, o configurar otro proveedor PostgreSQL persistente y apuntar `DATABASE_URL` a esa conexión. El servicio web gratuito también puede quedarse dormido tras un periodo sin tráfico. Consulta los límites actuales antes de usar datos importantes: <https://render.com/docs/free>.

La clave de IA es opcional para probar la interfaz y el flujo de partidas. Si quieres preguntas nuevas de cualquier tema y evaluación semántica, debes añadirla como variable de entorno privada en Render; no la pongas en el código ni en GitHub.

## Ejecutar en local

1. Instala Node.js 20+ y PostgreSQL.
2. Crea una base de datos llamada `trivia_arena`.
3. Copia `.env.example` a `.env` y edita `DATABASE_URL` y `SESSION_SECRET`.
4. Instala dependencias y arranca:

   ```bash
   npm install
   npm run dev
   ```

5. Abre <http://localhost:3000>.

El esquema se crea automáticamente en el arranque. Para usar generación/corrección por IA en local, añade `OPENAI_API_KEY` en `.env`.

## Variables de entorno

| Variable | Obligatoria | Para qué sirve |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión a PostgreSQL |
| `SESSION_SECRET` | Recomendado | Firma de sesiones; Render la genera en el blueprint |
| `NODE_ENV` | En Render | Debe ser `production` para cookies seguras |
| `PORT` | No | Puerto HTTP; Render lo define automáticamente |
| `OPENAI_API_KEY` | No | Activa generación y valoración por IA |
| `OPENAI_MODEL` | No | Modelo de IA, por defecto `gpt-5.5` |

## Cómo funciona el árbitro

- La clave de respuesta y los alias aceptados solo se guardan en el servidor; el navegador recibe el enunciado, no la solución.
- Mientras la pregunta siga rebotando, no se revela la solución a los demás jugadores.
- Cuando el árbitro IA está habilitado, se le pide aceptar sinónimos, nombres alternativos y respuestas semánticamente equivalentes. Si la API falla, el juego intenta usar la comparación local y registra el error en los logs del servidor.
- Sin IA, el juego es una versión de demostración: funciona con un banco de preguntas finito y no puede cubrir de manera fiable cualquier tema personalizado.

## Límites conocidos de este MVP

- Las salas activas viven en memoria del proceso. Si Render reinicia o despliega la app durante una partida, esa sala se pierde; las partidas ya finalizadas siguen registradas en PostgreSQL. Una siguiente fase puede persistir y recuperar el estado completo de las salas.
- No hay chat, rankings globales ni sistema de moderación entre usuarios todavía.
- La IA puede equivocarse. Para partidas importantes, revisa los logs y ajusta las instrucciones de evaluación.
- Este proyecto todavía no ha sido desplegado en una cuenta real de Render ni conectado a una clave de IA del propietario; hay que completar esos pasos en sus respectivos paneles.

## Archivos principales

```text
trivia-arena/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── server.js
│   ├── quiz.js
│   └── questions.js
├── .env.example
├── .gitignore
├── package.json
├── render.yaml
└── README.md
```
