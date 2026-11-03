# ODS 9 — Infraestructura inteligente

Página web en español sobre el Objetivo de Desarrollo Sostenible 9 (Industria, innovación e infraestructura). Incluye las secciones **Objetivo**, **Método**, **Juego** y **Contacto**, más un minijuego de detección y reparación de filtraciones térmicas.

## Contenido

- `public/index.html`, `public/styles.css`, `public/game.js`: la página y el minijuego (como antes).
- `public/auth.js`: botón **UNETENOS**, ventana de registro / inicio de sesión y contador de apoyos.
- `server.js`: servidor Node.js (Express) con la API y la conexión a PostgreSQL.
- `db/schema.sql`: tabla `usuarios` (se crea sola al arrancar).
- `db/inspecciones.sql`: tabla `inspecciones` (se crea sola al arrancar, después de `schema.sql`).
- `public/inspeccion.html` + `public/inspeccion.js`: herramienta de inspección térmica (subir/cámara, paleta, resultados, guardar, historial y antes/después).
- `public/vision-worker.js`: Web Worker que carga OpenCV.js y hace HSV → máscara → morfología → `findContours` → % de área y severidad.
- `public/vendor/opencv.js`: build de OpenCV.js 4.x (WebAssembly embebido, ~10 MB; solo se carga en la página de inspección).
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
| POST | `/api/inspecciones` | Guarda inspección (multipart: `original`, `procesada`, `titulo`, `ubicacion`, `paleta`, `porcentaje`, `zonas`, `previa`). Recalcula la severidad en el servidor |
| GET | `/api/inspecciones` | Lista las inspecciones del usuario |
| GET | `/api/inspecciones/:id` | Detalle + inspección previa (antes/después). 403 si es de otro usuario |
| GET | `/api/inspecciones/:id/imagen/:tipo` | Imagen `original` o `procesada` con su Content-Type |
| DELETE | `/api/inspecciones/:id` | Elimina una inspección propia |

## Ejecutar en local

Necesitas Node.js 18+ y una base PostgreSQL.

1. `npm install`
2. Copia `.env.example` como `.env` y completa `DATABASE_URL` y `JWT_SECRET`.
3. `npm start` y abre http://localhost:3000


Nota: la base PostgreSQL del plan gratuito de Render tiene vencimiento; revisa las condiciones vigentes de Render o cambia de plan para conservar los datos a largo plazo.

## Inspección térmica

Abre `/inspeccion.html`: sube una imagen térmica (JPG/PNG, máx. 5 MB) o usa la cámara, elige la paleta («hierro» o «arcoíris») y pulsa **Analizar**. Todo se procesa en el navegador dentro de un Web Worker. Severidad: verde < 5 %, amarillo 5–15 %, rojo > 15 % (escala didáctica; se cambia en `vision-worker.js` y `server.js`).

**Limitación:** con una foto normal solo se segmentan colores; para inferir temperatura hace falta una imagen de cámara térmica con paleta conocida. Los rangos HSV (`RANGOS` en `vision-worker.js`) son un punto de partida: calíbralos con ≥10 imágenes por paleta y documenta la tabla en el informe.

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
