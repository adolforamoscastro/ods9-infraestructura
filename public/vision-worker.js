"use strict";

/*
 * Motor térmico ODS 9 — versión autónoma.
 * No descarga OpenCV, WASM ni modelos externos. Se ejecuta en un Web Worker
 * y procesa los píxeles de la imagen térmica que el usuario selecciona.
 *
 * IMPORTANTE: segmenta colores de una paleta térmica conocida. No recupera
 * temperaturas radiométricas de una captura JPG/PNG ni sustituye una cámara
 * térmica calibrada o una inspección profesional.
 */

const UMBRAL_MINIMO_COMPONENTE = 0.0015; // 0,15 % de los píxeles
const MAX_PIXELES = 1280 * 1280;

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : delta / max, max];
}

function clasificar(r, g, b, paleta) {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (paleta === "hierro") {
    // Extremo caliente: rojo, naranja, amarillo y blanco brillante.
    if ((h <= 58 || h >= 350) && s >= 0.24 && v >= 0.38) return 1;
    if (v >= 0.88 && s <= 0.22) return 1;
    // Extremo frío: azul/violeta suficientemente visible, evitando negro.
    if (h >= 185 && h <= 265 && s >= 0.20 && v >= 0.16) return 2;
    return 0;
  }
  // Arcoíris: rojo/naranja/amarillo = caliente; azul/cian = frío.
  if ((h <= 58 || h >= 345) && s >= 0.30 && v >= 0.30) return 1;
  if (h >= 175 && h <= 265 && s >= 0.28 && v >= 0.22) return 2;
  return 0;
}

function componentes(mascara, w, h, tipo) {
  const visitado = new Uint8Array(mascara.length);
  const cola = new Int32Array(mascara.length);
  const minArea = Math.max(24, Math.floor(w * h * UMBRAL_MINIMO_COMPONENTE));
  const encontrados = [];
  for (let inicio = 0; inicio < mascara.length; inicio++) {
    if (!mascara[inicio] || visitado[inicio]) continue;
    let cabeza = 0, colaFin = 0;
    cola[colaFin++] = inicio;
    visitado[inicio] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0, sumaX = 0, sumaY = 0;
    while (cabeza < colaFin) {
      const p = cola[cabeza++], x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      sumaX += x; sumaY += y;
      const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
      for (let ny = y0; ny <= y1; ny++) {
        const fila = ny * w;
        for (let nx = x0; nx <= x1; nx++) {
          const q = fila + nx;
          if (!visitado[q] && mascara[q]) {
            visitado[q] = 1;
            cola[colaFin++] = q;
          }
        }
      }
    }
    if (colaFin >= minArea) encontrados.push({
      tipo, area: colaFin, x: minX, y: minY, ancho: maxX - minX + 1,
      alto: maxY - minY + 1, cx: sumaX / colaFin, cy: sumaY / colaFin
    });
  }
  return encontrados;
}

function severidad(p) {
  return p > 15 ? "rojo" : p >= 5 ? "amarillo" : "verde";
}

function analizar(imagen, paleta, progreso = () => {}) {
  if (!imagen || !imagen.data || !imagen.width || !imagen.height) throw new Error("La imagen no es válida.");
  if (!["hierro", "arcoiris"].includes(paleta)) throw new Error("Selecciona una paleta térmica válida.");
  const w = imagen.width, h = imagen.height, total = w * h;
  if (total > MAX_PIXELES) throw new Error("La imagen supera el tamaño de análisis permitido. Reduce su resolución.");

  progreso(8, "Leyendo colores de la imagen térmica…");
  const datos = imagen.data;
  const calientes = new Uint8Array(total), frias = new Uint8Array(total);
  let nCalor = 0, nFrio = 0;
  for (let p = 0, i = 0; p < total; p++, i += 4) {
    const clase = clasificar(datos[i], datos[i + 1], datos[i + 2], paleta);
    if (clase === 1) { calientes[p] = 1; nCalor++; }
    else if (clase === 2) { frias[p] = 1; nFrio++; }
  }

  progreso(48, "Agrupando regiones térmicas…");
  const regiones = componentes(calientes, w, h, "calor")
    .concat(componentes(frias, w, h, "frio"));
  const zonasCalor = regiones.filter(z => z.tipo === "calor").length;
  const zonasFrio = regiones.filter(z => z.tipo === "frio").length;
  const porcentaje = nCalor * 100 / total;
  const porcentajeFrio = nFrio * 100 / total;
  const porcentajeTotal = porcentaje + porcentajeFrio;
  const nivel = severidad(Math.max(porcentaje, porcentajeFrio));

  progreso(78, "Marcando zonas y preparando recomendaciones…");
  const salida = typeof ImageData !== "undefined"
    ? new ImageData(new Uint8ClampedArray(datos), w, h)
    : { data: new Uint8ClampedArray(datos), width: w, height: h };
  const px = salida.data;
  for (const z of regiones) {
    const color = z.tipo === "calor" ? [255, 45, 35] : [30, 145, 255];
    const x0 = Math.max(0, z.x), y0 = Math.max(0, z.y);
    const x1 = Math.min(w - 1, z.x + z.ancho - 1), y1 = Math.min(h - 1, z.y + z.alto - 1);
    // Rectángulo de contorno y centro de referencia, sin ocultar la imagen.
    for (let x = x0; x <= x1; x++) {
      for (const y of [y0, y1]) {
        const i = (y * w + x) * 4;
        px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = 255;
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (const x of [x0, x1]) {
        const i = (y * w + x) * 4;
        px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = 255;
      }
    }
  }

  const recomendaciones = [];
  if (zonasCalor) recomendaciones.push("Zonas cálidas (contorno rojo): revisa juntas de ventanas y puertas, encuentros entre muro y techo, y posibles puentes térmicos. Comprueba primero que la diferencia de temperatura interior/exterior sea suficiente.");
  if (zonasFrio) recomendaciones.push("Zonas frías (contorno azul): verifica infiltraciones de aire, sellos deteriorados y humedad. No cubras una zona húmeda sin identificar y corregir primero la causa.");
  if (!regiones.length) recomendaciones.push("No se detectaron regiones que superen los umbrales de esta paleta. Verifica que la imagen provenga de una cámara térmica, selecciona la paleta correcta y evita capturas con leyendas o escalas dominantes.");
  recomendaciones.push("Estas marcas representan colores de la imagen, no una medición de temperatura ni una confirmación de fuga. Valida el hallazgo con una cámara térmica calibrada y un técnico.");

  progreso(100, "Análisis terminado.");
  return {
    porcentaje, porcentajeFrio, porcentajeTotal, porcentajeAfectado: Math.max(porcentaje, porcentajeFrio), zonas: regiones.length,
    zonasCalor, zonasFrio, severidad: nivel, regiones,
    recomendacion: recomendaciones.join(" "),
    salida
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { analizar, clasificar, componentes, severidad };
}

if (typeof self !== "undefined") {
  self.onmessage = ({ data }) => {
    try {
      const r = analizar(data.imagen, data.paleta, (valor, texto) =>
        self.postMessage({ tipo: "progreso", valor, texto }));
      self.postMessage({ tipo: "resultado", ...r }, [r.salida.data.buffer]);
    } catch (e) {
      self.postMessage({ tipo: "error", mensaje: e && e.message ? e.message : "No se pudo analizar la imagen." });
    }
  };
  self.postMessage({ tipo: "listo", motor: "ODS9 Thermal Engine 1.0" });
}
