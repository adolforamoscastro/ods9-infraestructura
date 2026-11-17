const test = require("node:test");
const assert = require("node:assert/strict");
const { analizar, severidad } = require("../public/vision-worker.js");

function imagenSintetica() {
  const width = 100, height = 80;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const rgb = x >= 20 && x < 45 && y >= 15 && y < 40 ? [255, 30, 10]
        : x >= 60 && x < 85 && y >= 35 && y < 60 ? [20, 80, 255]
        : [80, 30, 90];
      data.set([...rgb, 255], i);
    }
  }
  return { width, height, data };
}

test("clasifica una región cálida y otra fría sin depender de OpenCV", () => {
  const r = analizar(imagenSintetica(), "hierro");
  assert.equal(r.zonasCalor, 1);
  assert.equal(r.zonasFrio, 1);
  assert.equal(r.zonas, 2);
  assert.ok(r.porcentaje > 0);
  assert.ok(r.porcentajeFrio > 0);
  assert.equal(r.salida.width, 100);
});

test("rechaza paletas no admitidas", () => {
  assert.throws(() => analizar(imagenSintetica(), "desconocida"), /paleta/i);
});

test("aplica los tres niveles didácticos de severidad", () => {
  assert.equal(severidad(2), "verde");
  assert.equal(severidad(8), "amarillo");
  assert.equal(severidad(20), "rojo");
});
