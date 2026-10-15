# ODS 9 — Infraestructura inteligente

Página web estática en español sobre el Objetivo de Desarrollo Sostenible 9 (Industria, innovación e infraestructura). Incluye las secciones **Objetivo**, **Método**, **Juego** y **Contacto**, más un minijuego de detección y reparación de filtraciones térmicas.

## Contenido

- `index.html`: estructura de la página y contenido.
- `styles.css`: estilos adaptables a móvil y escritorio, navegación animada y diseño.
- `game.js`: minijuego en Canvas HTML5, sin librerías externas.

## Ejecutar en local

1. Descarga o descomprime el repositorio.
2. Abre `index.html` en un navegador moderno.

No requiere Node.js, instalación de dependencias, base de datos ni comandos Bash.

## Publicar en GitHub

1. Entra a [GitHub](https://github.com/) e inicia sesión.
2. Pulsa **New repository** y ponle un nombre, por ejemplo `ods9-infraestructura`.
3. Crea el repositorio (puede ser público).
4. Pulsa **Add file → Upload files**.
5. Sube `index.html`, `styles.css`, `game.js` y `README.md`; confirma con **Commit changes**.

## Desplegar en Render como sitio estático

1. Entra a [Render](https://render.com/) e inicia sesión.
2. Selecciona **New + → Static Site**.
3. Conecta GitHub y elige el repositorio `ods9-infraestructura`.
4. Configura:
   - **Name:** `ods9-infraestructura` (o el nombre que prefieras)
   - **Branch:** `main`
   - **Root Directory:** vacío
   - **Build Command:** vacío / no necesario
   - **Publish Directory:** `.`
5. Pulsa **Create Static Site**. Render publicará el sitio y proporcionará una URL `onrender.com`.
6. Cuando actualices archivos en GitHub y hagas commit, Render puede volver a desplegar automáticamente.

También se incluye `render.yaml` como configuración opcional de infraestructura como código.

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
