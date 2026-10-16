# Trivia Arena — versión plana para GitHub

Proyecto web de preguntas y respuestas en español, con perfiles, partidas rápidas online, preguntas con rebote, modo liga y árbitro de IA opcional. Esta variante tiene **todos los archivos en una sola carpeta**, sin subcarpetas, para poder subirlos directamente desde GitHub en el navegador.

## Archivos que debes subir

Sube **los 11 archivos** de esta carpeta directamente a la raíz de tu repositorio: `README.md`, `package.json`, `.env.example`, `.gitignore`, `render.yaml`, `server.js`, `quiz.js`, `questions.js`, `index.html`, `styles.css` y `app.js`.

No subas el ZIP como único archivo: descárgalo, descomprímelo en tu ordenador y sube los archivos que contiene. No hace falta crear carpetas en GitHub. Respeta los nombres de archivo, incluidos los puntos iniciales de `.env.example` y `.gitignore`.

## Qué incluye

- Registro e inicio de sesión; contraseñas cifradas y perfil persistente.
- Partidas rápidas online, código para unirse, tema, puntuación objetivo o número de preguntas configurable.
- Respuestas escritas y rebote de la misma pregunta si alguien falla.
- Desempate entre los jugadores empatados.
- Ligas privadas 1 contra 1 y tabla de clasificación persistente.
- Estadísticas e historial guardados en PostgreSQL.
- Preguntas nuevas y evaluación semántica mediante OpenAI si configuras `OPENAI_API_KEY`; banco local para probar sin esa clave.

## Desplegar en Render

1. Sube todos los archivos de esta carpeta a la raíz del repositorio de GitHub.
2. En Render, elige **New → Blueprint** y selecciona el repositorio. Render utilizará `render.yaml` para configurar el servicio web Node y PostgreSQL.
3. Espera a que termine el despliegue y abre la URL que te facilite Render.
4. Opcionalmente, añade `OPENAI_API_KEY` en las variables de entorno privadas del servicio de Render para activar generación y corrección con IA. No publiques esa clave en GitHub.
5. Comprueba que `https://TU-DOMINIO/health` devuelve `{"ok":true}`.

## Variables de entorno

- `DATABASE_URL`: conexión a PostgreSQL; Render la configura mediante el Blueprint.
- `SESSION_SECRET`: secreto de sesión; Render lo genera en el Blueprint.
- `NODE_ENV`: Render lo establece como `production`.
- `PORT`: Render lo establece automáticamente.
- `OPENAI_API_KEY`: opcional; habilita generación/corrección con IA y puede tener coste de API separado de ChatGPT.
- `OPENAI_MODEL`: opcional; el modelo utilizado por la API.

Para desarrollo local, copia `.env.example` como `.env`, rellena una conexión PostgreSQL y ejecuta `npm install` y `npm start` con Node.js 20 o posterior.

## Disposición de archivos

Todos están al mismo nivel; no hay carpetas dentro del proyecto:

```text
README.md
package.json
.env.example
.gitignore
render.yaml
server.js
quiz.js
questions.js
index.html
styles.css
app.js
```

## Limitaciones conocidas

- Las salas de partida activas se guardan en la memoria del servidor y se pierden si Render reinicia o despliega la aplicación. Las partidas terminadas sí quedan registradas en PostgreSQL.
- Sin `OPENAI_API_KEY`, se utiliza un banco de preguntas limitado y una comparación local de respuestas; no puede cubrir cualquier tema personalizado.
- Antes de confiar en los datos a largo plazo, revisa las condiciones y la caducidad del plan de PostgreSQL que elijas en Render.
- Esta versión todavía debe probarse en una cuenta real de Render y con la base de datos conectada.
