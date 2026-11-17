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
  return new Promise((resolve, reject) => {
    let terminado = false;
    let cvModule = null;
    let temporizador;

    const finalizar = (error, modulo) => {
      if (terminado) return;
      if (!error && (!modulo || !modulo.Mat)) {
        error = new Error("OpenCV terminó de cargar, pero no expuso cv.Mat.");
      }
      terminado = true;
      clearTimeout(temporizador);
      if (error) reject(error);
      else resolve(modulo);
    };

    temporizador = setTimeout(() => {
      finalizar(new Error("Tiempo de espera agotado al inicializar OpenCV/WebAssembly (30 s)."));
    }, 30000);

    try {
      // Carga la librería desde la carpeta pública del servidor.
      self.importScripts("/vendor/opencv.js");
      const fabrica = self.cv;
      if (typeof fabrica !== "function") {
        // Compatibilidad con builds que publican directamente el objeto cv.
        if (fabrica && fabrica.Mat) return finalizar(null, fabrica);
        if (fabrica && typeof fabrica.then === "function") {
          fabrica.then((modulo) => finalizar(null, modulo || fabrica), finalizar);
          return;
        }
        return finalizar(new Error("No se encontró la función/objeto cv después de cargar /vendor/opencv.js."));
      }

      // Pasar los callbacks ANTES de iniciar WebAssembly evita perder
      // onRuntimeInitialized si el motor termina de arrancar rápidamente.
      let inicializado = false;
      cvModule = fabrica({
        onRuntimeInitialized() {
          inicializado = true;
          finalizar(null, cvModule);
        },
        onAbort(motivo) {
          finalizar(new Error("OpenCV abortó la inicialización: " + (motivo || "motivo desconocido")));
        }
      });

      if (inicializado || (cvModule && cvModule.Mat)) {
        finalizar(null, cvModule);
      } else if (cvModule && typeof cvModule.then === "function") {
        cvModule.then((modulo) => finalizar(null, modulo || cvModule), finalizar);
      }
    } catch (e) {
      finalizar(e);
    }
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
