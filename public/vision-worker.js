"use strict";
/* Worker de visión: carga OpenCV.js (WebAssembly), segmenta zonas calientes en HSV,
   limpia con morfología, detecta contornos y mide el área afectada.
   Mensajes al hilo principal:
   {tipo:'listo'} | {tipo:'progreso',valor,texto} | {tipo:'resultado',...} | {tipo:'error',mensaje} */

// Rangos HSV de OpenCV (H: 0-180, S y V: 0-255). Punto de partida: calibrar con imágenes reales.
const RANGOS = {
  hierro:   [[[0, 120, 150], [15, 255, 255]], [[15, 80, 200], [35, 255, 255]], [[170, 120, 150], [180, 255, 255]]],
  arcoiris: [[[0, 150, 120], [10, 255, 255]], [[170, 150, 120], [180, 255, 255]]]
};
const UMBRAL_ZONA = 0.005;                    // se descartan zonas < 0,5 % de la imagen
const UMBRAL_AMARILLO = 5, UMBRAL_ROJO = 15;  // escala didáctica (el servidor usa la misma)

function severidad(p) { return p > UMBRAL_ROJO ? "rojo" : p >= UMBRAL_AMARILLO ? "amarillo" : "verde"; }

function cargarMotor() {
  self.importScripts("/vendor/opencv.js");
  return new Promise((ok, ko) => {
    try {
      let c = self.cv;
      if (typeof c === "function") c = c();
      if (c && c.Mat) return ok(c);
      if (c && typeof c.then === "function") {
        // Se entrega self.cv/m directamente (no el thenable) para no re-resolver la promesa.
        c.then((m) => ok(m && m.Mat ? m : self.cv), ko);
      } else if (c) {
        c.onRuntimeInitialized = () => ok(c);
      } else ko(new Error("OpenCV.js no se pudo cargar."));
    } catch (e) { ko(e); }
  });
}

function analizar(cv, imagen, paleta, progreso) {
  const rangos = RANGOS[paleta];
  if (!rangos) throw new Error("Paleta no válida.");
  const basura = [];
  const mat = (m) => { basura.push(m); return m; };
  try {
    progreso(10, "Convirtiendo a HSV…");
    const src = mat(cv.matFromImageData(imagen));
    const rgb = mat(new cv.Mat()), hsv = mat(new cv.Mat());
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    progreso(30, "Segmentando zonas calientes…");
    const mascara = mat(cv.Mat.zeros(hsv.rows, hsv.cols, cv.CV_8UC1));
    for (const [bajo, alto] of rangos) {
      const lo = mat(new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [...bajo, 0]));
      const hi = mat(new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [...alto, 0]));
      const parcial = mat(new cv.Mat());
      cv.inRange(hsv, lo, hi, parcial);
      cv.bitwise_or(mascara, parcial, mascara);
    }

    progreso(55, "Limpiando ruido (morfología)…");
    const kernel = mat(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)));
    cv.morphologyEx(mascara, mascara, cv.MORPH_OPEN, kernel);   // quita ruido
    cv.morphologyEx(mascara, mascara, cv.MORPH_CLOSE, kernel);  // une huecos

    progreso(75, "Detectando contornos…");
    const contornos = mat(new cv.MatVector()), jerarquia = mat(new cv.Mat());
    cv.findContours(mascara, contornos, jerarquia, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const total = hsv.rows * hsv.cols;
    let zonas = 0;
    for (let i = 0; i < contornos.size(); i++) {
      const c = contornos.get(i);
      if (cv.contourArea(c) / total >= UMBRAL_ZONA) {
        zonas++;
        cv.drawContours(src, contornos, i, new cv.Scalar(0, 255, 255, 255), 3);
      }
      c.delete();
    }

    progreso(92, "Calculando severidad…");
    const porcentaje = (cv.countNonZero(mascara) / total) * 100;
    const salida = new ImageData(new Uint8ClampedArray(src.data), src.cols, src.rows);
    return { porcentaje, zonas, severidad: severidad(porcentaje), salida };
  } finally {
    basura.forEach((m) => { try { m.delete(); } catch (_) {} });  // libera memoria WASM
  }
}

// Exportado solo para las pruebas en Node; en el navegador se ejecuta como Worker.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { analizar, severidad, RANGOS };
} else {
  let cvLib = null;
  const listo = cargarMotor()
    .then((c) => { cvLib = c; self.postMessage({ tipo: "listo" }); })
    .catch((e) => self.postMessage({ tipo: "error", mensaje: "No se pudo cargar el motor de visión: " + (e && e.message || e) }));

  self.onmessage = async ({ data }) => {
    try {
      await listo;
      if (!cvLib) return;
      const r = analizar(cvLib, data.imagen, data.paleta,
        (valor, texto) => self.postMessage({ tipo: "progreso", valor, texto }));
      self.postMessage({ tipo: "resultado", ...r }, [r.salida.data.buffer]);
    } catch (e) {
      self.postMessage({ tipo: "error", mensaje: "Error al analizar la imagen: " + (e && e.message || e) });
    }
  };
}
