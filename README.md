# ODS 9 — Infraestructura inteligente

Página web en español sobre el Objetivo de Desarrollo Sostenible 9 (Industria, innovación e infraestructura). Incluye las secciones **Objetivo**, **Método**, **Juego** y **Contacto**, más un minijuego de detección y reparación de filtraciones térmicas.

## Contenido

- `public/index.html`, `public/styles.css`, `public/game.js`: la página y el minijuego (como antes).
- `public/auth.js`: botón **UNETENOS**, ventana de registro / inicio de sesión y contador de apoyos.
- `server.js`: servidor Node.js (Express) con la API y la conexión a PostgreSQL.
- `db/schema.sql`: tabla `usuarios` (se crea sola al arrancar).
- `render.yaml`: servicio web + base de datos PostgreSQL en Render.

## Cómo funciona

- El botón **UNETENOS** (arriba a la derecha) abre una ventana para **crear cuenta** o **iniciar sesión** con correo y contraseña.
- Cada correo registrado cuenta como una persona que apoya el proyecto; el total se muestra en el encabezado, en la portada y en la ventana.
- Las contraseñas se guardan cifradas (bcrypt), la sesión va en una cookie `httpOnly` y hay límite de intentos contra abusos.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/apoyos` | Total de personas que apoyan |
| GET | `/api/yo` | Usuario con sesión activa |
| POST | `/api/registro` | Crea cuenta `{email, password}` |
| POST | `/api/login` | Inicia sesión |
| POST | `/api/logout` | Cierra sesión |

## Ejecutar en local

Necesitas Node.js 18+ y una base PostgreSQL.

1. `npm install`
2. Copia `.env.example` como `.env` y completa `DATABASE_URL` y `JWT_SECRET`.
3. `npm start` y abre http://localhost:3000

## Publicar en GitHub

Sube **todo** el contenido (incluidas las carpetas `public/` y `db/`, `package.json`, `server.js`, `render.yaml`). **No subas `.env`** (ya está en `.gitignore`).

## Desplegar en Render (con base de datos)

Ya no es un sitio estático: ahora necesita un servicio web y PostgreSQL.

1. En [Render](https://render.com/) elige **New + → Blueprint** y conecta el repositorio.
2. Render leerá `render.yaml` y creará el servicio web y la base `ods9-db`, enlazando `DATABASE_URL` y generando `JWT_SECRET` automáticamente.
3. Pulsa **Apply**. Al terminar tendrás una URL `onrender.com`.

Nota: la base PostgreSQL del plan gratuito de Render tiene vencimiento; revisa las condiciones vigentes de Render o cambia de plan para conservar los datos a largo plazo.

## Cómo jugar

- Muévete con las flechas o con **W, A, S, D**.
- Acércate a una pared amarilla o roja.
- Pulsa **Espacio** para reparar la filtración y sumar 100 puntos.
- Si una filtración llega al rojo máximo, termina la partida.
- Pulsa **Reiniciar** para empezar otra vez.

## Fuentes y alcance

- ODS 9 — Naciones Unidas: https://www.un.org/sustainabledevelopment/es/infrastructure/
- Video de referencia: https://www.youtube.com/watch?v=nw6Uu-wFoXw&themeRefresh=1

El método de detección térmica y reparación con pasta de barro se presenta como una propuesta conceptual educativa, no como una recomendación técnica validada para obras reales. La simulación del juego no mide temperaturas reales.
