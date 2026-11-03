(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_ANCHO = 1280;
  const RECOMENDACIONES = {
    verde: "Área caliente baja (< 5 %). No se observan fugas relevantes; mantén revisiones periódicas.",
    amarillo: "Área caliente moderada (5–15 %). Conviene inspeccionar las zonas marcadas y planear una intervención.",
    rojo: "Área caliente alta (> 15 %). Se recomienda intervenir pronto y pedir asesoría técnica antes de reparar."
  };

  const el = {
    file: $("#insp-file"), camera: $("#insp-camera"), fileName: $("#insp-file-name"),
    analyze: $("#insp-analyze"), progress: $("#insp-progress"), barFill: $("#insp-bar-fill"),
    progressText: $("#insp-progress-text"), engine: $("#insp-engine"), error: $("#insp-error"),
    results: $("#insp-results"), cvOriginal: $("#cv-original"), cvResultado: $("#cv-resultado"),
    rPct: $("#r-porcentaje"), rZonas: $("#r-zonas"), rSev: $("#r-severidad"), rReco: $("#r-reco"),
    form: $("#insp-save"), titulo: $("#s-titulo"), ubicacion: $("#s-ubicacion"), previa: $("#s-previa"),
    sError: $("#s-error"), sOk: $("#s-ok"), sSubmit: $("#s-submit"), loginHint: $("#insp-login-hint"),
    hEstado: $("#h-estado"), hList: $("#h-list"), hCompare: $("#h-compare")
  };

  let worker = null, motorListo = false, analizando = false;
  let imagen = null;          // ImageData ya redimensionada
  let resultado = null;       // último análisis {porcentaje, zonas, severidad, paleta}
  let usuario = window.sesionActual || null;
  let historial = [];

  const paleta = () => ($("input[name=paleta]:checked") || {}).value || "hierro";
  const show = (node, msg) => { node.textContent = msg; node.hidden = false; };
  const hide = (node) => { node.hidden = true; node.textContent = ""; };

  // ---------- Worker ----------
  function iniciarWorker() {
    try { worker = new Worker("/vision-worker.js"); }
    catch (e) { el.engine.textContent = "Tu navegador no soporta Web Workers."; return; }
    worker.onmessage = ({ data }) => {
      if (data.tipo === "listo") {
        motorListo = true; el.engine.textContent = "Motor de visión listo ✓"; actualizarBoton();
      } else if (data.tipo === "progreso") {
        el.barFill.style.width = data.valor + "%"; el.progressText.textContent = data.texto;
      } else if (data.tipo === "resultado") {
        mostrarResultado(data);
      } else if (data.tipo === "error") {
        analizando = false; el.progress.hidden = true; el.engine.textContent = "";
        show(el.error, data.mensaje); actualizarBoton();
      }
    };
    worker.onerror = () => { analizando = false; el.progress.hidden = true; show(el.error, "El motor de visión falló. Recarga la página."); };
  }
  function actualizarBoton() { el.analyze.disabled = !(motorListo && imagen && !analizando); }

  // ---------- Carga de imagen (RF-01) ----------
  async function cargarArchivo(file) {
    hide(el.error); el.results.hidden = true; imagen = null; resultado = null; actualizarBoton();
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) return show(el.error, "Formato no admitido. Usa una imagen JPG o PNG.");
    if (file.size > MAX_BYTES) return show(el.error, `La imagen pesa ${(file.size / 1048576).toFixed(1)} MB. El máximo es 5 MB.`);
    try {
      const bmp = await createImageBitmap(file);
      const escala = Math.min(1, MAX_ANCHO / bmp.width);
      const w = Math.round(bmp.width * escala), h = Math.round(bmp.height * escala);
      el.cvOriginal.width = w; el.cvOriginal.height = h;
      const ctx = el.cvOriginal.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      imagen = ctx.getImageData(0, 0, w, h);
      el.fileName.textContent = `${file.name} · ${w}×${h}px`;
      actualizarBoton();
    } catch (_) { show(el.error, "No se pudo leer la imagen. Prueba con otro archivo."); }
  }
  el.file.addEventListener("change", () => cargarArchivo(el.file.files[0]));
  el.camera.addEventListener("change", () => cargarArchivo(el.camera.files[0]));

  // ---------- Análisis (RF-02 a RF-07) ----------
  el.analyze.addEventListener("click", () => {
    if (!imagen || !motorListo || analizando) return;
    analizando = true; actualizarBoton(); hide(el.error);
    el.results.hidden = true; el.progress.hidden = false; el.barFill.style.width = "3%"; el.progressText.textContent = "Enviando al motor de visión…";
    // Se envía una copia: el original sigue disponible en el canvas para guardarlo.
    const copia = new ImageData(new Uint8ClampedArray(imagen.data), imagen.width, imagen.height);
    resultado = { paleta: paleta() };
    worker.postMessage({ imagen: copia, paleta: resultado.paleta }, [copia.data.buffer]);
  });

  function mostrarResultado(d) {
    analizando = false; actualizarBoton();
    el.barFill.style.width = "100%";
    setTimeout(() => { el.progress.hidden = true; }, 400);
    Object.assign(resultado, { porcentaje: d.porcentaje, zonas: d.zonas, severidad: d.severidad });
    el.cvResultado.width = d.salida.width; el.cvResultado.height = d.salida.height;
    el.cvResultado.getContext("2d").putImageData(d.salida, 0, 0);
    el.rPct.textContent = d.porcentaje.toFixed(2).replace(".", ",") + " %";
    el.rZonas.textContent = String(d.zonas);
    el.rSev.textContent = d.severidad;
    el.rSev.className = "sev sev-" + d.severidad;
    el.rReco.textContent = RECOMENDACIONES[d.severidad];
    el.results.hidden = false;
    hide(el.sError); hide(el.sOk);
    el.results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Sesión e historial (RF-08) ----------
  async function api(url, options) {
    const res = await fetch(url, { credentials: "same-origin", ...options });
    let data = {}; try { data = await res.json(); } catch (_) {}
    if (!res.ok || data.ok === false) { const e = new Error(data.error || "Ocurrió un error."); e.status = res.status; throw e; }
    return data;
  }
  function sevBadge(s) { const b = document.createElement("span"); b.className = "sev sev-" + s; b.textContent = s; return b; }
  const fecha = (iso) => new Date(iso).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
  const pct = (n) => Number(n).toFixed(2).replace(".", ",") + " %";

  function pintarSesion() {
    el.loginHint.hidden = !!usuario;
    el.sSubmit.disabled = !usuario;
    if (!usuario) {
      historial = []; el.hList.replaceChildren(); el.hCompare.hidden = true;
      el.hEstado.textContent = "Inicia sesión (botón UNETENOS) para ver y guardar tu historial.";
      pintarPrevias();
    } else cargarHistorial();
  }
  document.addEventListener("sesion", (e) => { usuario = e.detail; pintarSesion(); });

  async function cargarHistorial() {
    try {
      historial = (await api("/api/inspecciones")).inspecciones;
      el.hEstado.textContent = historial.length ? `${historial.length} inspección(es) guardadas.` : "Aún no has guardado inspecciones.";
      pintarHistorial(); pintarPrevias();
    } catch (e) { el.hEstado.textContent = e.message; }
  }
  function pintarPrevias() {
    const actual = el.previa.value;
    el.previa.replaceChildren(new Option("— Ninguna (inspección inicial) —", ""));
    historial.forEach((h) => el.previa.add(new Option(`#${h.id} · ${h.titulo} (${pct(h.porcentaje)})`, h.id)));
    el.previa.value = historial.some((h) => String(h.id) === actual) ? actual : "";
  }
  function pintarHistorial() {
    el.hList.replaceChildren(...historial.map((h) => {
      const card = document.createElement("article"); card.className = "insp-item";
      const img = document.createElement("img"); img.loading = "lazy"; img.alt = "Imagen procesada de " + h.titulo;
      img.src = `/api/inspecciones/${h.id}/imagen/procesada`;
      const body = document.createElement("div"); body.className = "insp-item-body";
      const t = document.createElement("strong"); t.textContent = h.titulo;
      const u = document.createElement("small"); u.textContent = [h.ubicacion, fecha(h.creada_en)].filter(Boolean).join(" · ");
      const m = document.createElement("div"); m.append(sevBadge(h.severidad), ` ${pct(h.porcentaje)} · ${h.zonas} zona(s)`);
      const acts = document.createElement("div"); acts.className = "insp-item-actions";
      if (h.previa) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = "Ver antes y después";
        b.addEventListener("click", () => verComparacion(h.id)); acts.append(b);
      }
      const del = document.createElement("button"); del.type = "button"; del.textContent = "Eliminar";
      del.addEventListener("click", () => eliminar(h));
      acts.append(del);
      body.append(t, u, m, acts); card.append(img, body); return card;
    }));
  }
  async function eliminar(h) {
    if (!confirm(`¿Eliminar «${h.titulo}»?`)) return;
    try { await api(`/api/inspecciones/${h.id}`, { method: "DELETE" }); el.hCompare.hidden = true; await cargarHistorial(); }
    catch (e) { el.hEstado.textContent = e.message; }
  }
  async function verComparacion(id) {
    try {
      const { inspeccion: despues, anterior: antes } = await api(`/api/inspecciones/${id}`);
      if (!antes) { el.hEstado.textContent = "La inspección previa ya no existe."; return; }
      const fig = (h, rotulo) => {
        const f = document.createElement("figure"); const c = document.createElement("figcaption");
        const b = document.createElement("strong"); b.textContent = rotulo;
        c.append(b, document.createElement("br"), `${h.titulo} · ${pct(h.porcentaje)} · `, sevBadge(h.severidad));
        const i = document.createElement("img"); i.alt = rotulo + ": " + h.titulo; i.src = `/api/inspecciones/${h.id}/imagen/procesada`;
        f.append(c, i); return f;
      };
      const dif = despues.porcentaje - antes.porcentaje;
      const d = document.createElement("p"); d.className = "insp-delta";
      d.textContent = dif < 0 ? `El área caliente bajó ${pct(-dif)} (de ${pct(antes.porcentaje)} a ${pct(despues.porcentaje)}).`
        : dif > 0 ? `El área caliente subió ${pct(dif)} (de ${pct(antes.porcentaje)} a ${pct(despues.porcentaje)}).`
        : "El área caliente no cambió.";
      const grid = document.createElement("div"); grid.className = "insp-compare-grid";
      grid.append(fig(antes, "Antes"), fig(despues, "Después de reparar"));
      const h3 = document.createElement("h3"); h3.textContent = "Antes y después";
      el.hCompare.replaceChildren(h3, grid, d); el.hCompare.hidden = false;
      el.hCompare.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) { el.hEstado.textContent = e.message; }
  }

  // ---------- Guardar (multipart/form-data → POST /api/inspecciones) ----------
  const aBlob = (canvas) => new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("No se pudo codificar la imagen."))), "image/jpeg", 0.9));

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault(); hide(el.sError); hide(el.sOk);
    if (!usuario) return show(el.sError, "Inicia sesión para guardar la inspección.");
    if (!resultado || resultado.porcentaje === undefined) return show(el.sError, "Primero analiza una imagen.");
    const titulo = el.titulo.value.trim();
    if (!titulo) return show(el.sError, "Escribe un título para la inspección.");
    el.sSubmit.disabled = true;
    try {
      const [original, procesada] = await Promise.all([aBlob(el.cvOriginal), aBlob(el.cvResultado)]);
      if (original.size > MAX_BYTES || procesada.size > MAX_BYTES) throw new Error("Las imágenes superan 5 MB.");
      const fd = new FormData();
      fd.append("titulo", titulo); fd.append("ubicacion", el.ubicacion.value.trim());
      fd.append("paleta", resultado.paleta); fd.append("porcentaje", resultado.porcentaje.toFixed(2));
      fd.append("zonas", String(resultado.zonas)); fd.append("severidad", resultado.severidad);
      if (el.previa.value) fd.append("previa", el.previa.value);
      fd.append("original", original, "original.jpg"); fd.append("procesada", procesada, "procesada.jpg");
      const r = await api("/api/inspecciones", { method: "POST", body: fd });  // sin Content-Type manual
      show(el.sOk, `Inspección #${r.id} guardada.`);
      el.titulo.value = ""; el.ubicacion.value = ""; el.previa.value = "";
      await cargarHistorial();
    } catch (err) {
      if (err.status === 401) { usuario = null; pintarSesion(); }
      show(el.sError, err.message);
    } finally { el.sSubmit.disabled = !usuario; }
  });

  iniciarWorker();
  pintarSesion();
})();
