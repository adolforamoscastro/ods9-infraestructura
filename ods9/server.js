"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const multer = require("multer");

// Carga opcional de .env en desarrollo (sin dependencias extra).
try { process.loadEnvFile && fs.existsSync(".env") && process.loadEnvFile(".env"); } catch (_) {}

const isProd = process.env.NODE_ENV === "production";
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error("Falta la variable de entorno DATABASE_URL (cadena de conexión a PostgreSQL).");
  process.exit(1);
}
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (isProd) { console.error("Falta JWT_SECRET en producción."); process.exit(1); }
  JWT_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("JWT_SECRET no definido: se usa una clave temporal (las sesiones se perderán al reiniciar).");
}

// ---------- Base de datos ----------
const useSsl = process.env.DATABASE_SSL !== "false" && (isProd || process.env.DATABASE_SSL === "true");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 10
});

async function initDb() {
  const sql = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(sql);
  // Tabla de inspecciones (requiere que "usuarios" ya exista).
  await pool.query(fs.readFileSync(path.join(__dirname, "db", "inspecciones.sql"), "utf8"));
}

// ---------- App ----------
const app = express();
app.set("trust proxy", 1); // Render está detrás de un proxy
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "script-src": ["'self'", "'wasm-unsafe-eval'"],   // OpenCV.js usa WebAssembly
      "worker-src": ["'self'"],
      "img-src": ["'self'", "data:", "blob:"],
      "connect-src": ["'self'"],
      "upgrade-insecure-requests": isProd ? [] : null
    }
  }
}));
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

const COOKIE = "sesion";
const cookieOpts = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProd,
  maxAge: 1000 * 60 * 60 * 24 * 7
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normEmail = (v) => String(v || "").trim().toLowerCase();
const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

function startSession(res, user) {
  const token = jwt.sign({ sub: String(user.id), email: user.email }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE, token, cookieOpts);
}
function currentUser(req) {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  try { const p = jwt.verify(token, JWT_SECRET); return { id: p.sub, email: p.email }; }
  catch (_) { return null; }
}
async function totalApoyos() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM usuarios");
  return rows[0].total;
}

// Limita intentos de registro/inicio de sesión para frenar abusos.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Demasiados intentos. Inténtalo de nuevo en unos minutos." }
});

// ---------- API ----------
app.get("/api/apoyos", async (_req, res) => {
  try { ok(res, { total: await totalApoyos() }); }
  catch (e) { console.error(e); fail(res, 500, "No se pudo obtener el conteo."); }
});

app.get("/api/yo", (req, res) => {
  const u = currentUser(req);
  ok(res, { usuario: u ? { email: u.email } : null });
});

app.post("/api/registro", authLimiter, async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || "");
  if (!EMAIL_RE.test(email) || email.length > 254) return fail(res, 400, "Escribe un correo válido.");
  if (password.length < 8) return fail(res, 400, "La contraseña debe tener al menos 8 caracteres.");
  if (password.length > 72) return fail(res, 400, "La contraseña no puede superar 72 caracteres.");
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO usuarios (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, hash]
    );
    startSession(res, rows[0]);
    ok(res, { usuario: { email: rows[0].email }, total: await totalApoyos() });
  } catch (e) {
    if (e.code === "23505") return fail(res, 409, "Ese correo ya está registrado. Inicia sesión.");
    console.error(e); fail(res, 500, "No se pudo crear la cuenta.");
  }
});

// Hash de relleno para que el tiempo de respuesta no revele si el correo existe.
const DUMMY_HASH = bcrypt.hashSync("relleno-no-valido", 12);

app.post("/api/login", authLimiter, async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || "");
  if (!email || !password || password.length > 72) return fail(res, 400, "Escribe tu correo y contraseña.");
  try {
    const { rows } = await pool.query(
      "SELECT id, email, password_hash FROM usuarios WHERE LOWER(email) = $1", [email]
    );
    const user = rows[0];
    const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) return fail(res, 401, "Correo o contraseña incorrectos.");
    startSession(res, user);
    ok(res, { usuario: { email: user.email }, total: await totalApoyos() });
  } catch (e) { console.error(e); fail(res, 500, "No se pudo iniciar sesión."); }
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
  ok(res, {});
});

// ---------- Inspecciones térmicas ----------
function requiereSesion(req, res, next) {
  const u = currentUser(req);
  if (!u) return fail(res, 401, "Inicia sesión para guardar y ver tus inspecciones.");
  req.usuario = u;
  next();
}

const MAX_IMG = 5 * 1024 * 1024;
const subir = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMG, files: 2, fields: 10, fieldSize: 1024 },
  fileFilter: (_req, f, cb) =>
    ["image/jpeg", "image/png"].includes(f.mimetype)
      ? cb(null, true)
      : cb(Object.assign(new Error("Solo se permiten imágenes JPG o PNG."), { status: 400 }))
});
const subirCampos = subir.fields([{ name: "original", maxCount: 1 }, { name: "procesada", maxCount: 1 }]);
function recibirImagenes(req, res, next) {
  subirCampos(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return fail(res, 413, "Cada imagen debe pesar máximo 5 MB.");
    if (err instanceof multer.MulterError) return fail(res, 400, "Archivo no válido.");
    return fail(res, err.status || 400, err.message || "Archivo no válido.");
  });
}
const inspLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: "Demasiadas inspecciones guardadas. Inténtalo en unos minutos." }
});

// Misma escala didáctica que el Worker: verde < 5 %, amarillo 5–15 %, rojo > 15 %.
const severidadDe = (p) => (p > 15 ? "rojo" : p >= 5 ? "amarillo" : "verde");
// Firma real del archivo (no basta con confiar en el mimetype del cliente).
function tipoImagen(buf) {
  if (buf && buf.length > 8) {
    if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  }
  return null;
}
const COLS = `id, titulo, ubicacion, paleta, porcentaje_afectado::float AS porcentaje,
              zonas, severidad, inspeccion_previa_id AS previa, creada_en`;
const idValido = (v) => /^\d{1,15}$/.test(String(v));

// Devuelve la fila (con usuario_id) o responde 404/403.
async function obtenerPropia(req, res, cols) {
  if (!idValido(req.params.id)) { fail(res, 404, "Inspección no encontrada."); return null; }
  const { rows } = await pool.query(`SELECT usuario_id, ${cols} FROM inspecciones WHERE id = $1`, [req.params.id]);
  if (!rows[0]) { fail(res, 404, "Inspección no encontrada."); return null; }
  if (String(rows[0].usuario_id) !== String(req.usuario.id)) { fail(res, 403, "No tienes permiso para ver esta inspección."); return null; }
  return rows[0];
}

app.post("/api/inspecciones", inspLimiter, requiereSesion, recibirImagenes, async (req, res) => {
  try {
    const b = req.body || {};
    const titulo = String(b.titulo || "").trim();
    const ubicacion = String(b.ubicacion || "").trim();
    const paleta = String(b.paleta || "");
    const porcentaje = Number(b.porcentaje);
    const zonas = Number(b.zonas);
    const previa = b.previa ? String(b.previa) : null;
    const original = req.files && req.files.original && req.files.original[0];
    const procesada = req.files && req.files.procesada && req.files.procesada[0];

    if (!original || !procesada) return fail(res, 400, "Faltan las imágenes (original y procesada).");
    if (!tipoImagen(original.buffer) || !tipoImagen(procesada.buffer)) return fail(res, 400, "Solo se permiten imágenes JPG o PNG.");
    if (!titulo || titulo.length > 80) return fail(res, 400, "El título es obligatorio (máximo 80 caracteres).");
    if (ubicacion.length > 120) return fail(res, 400, "La ubicación no puede superar 120 caracteres.");
    if (!["hierro", "arcoiris"].includes(paleta)) return fail(res, 400, "Paleta no válida.");
    if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) return fail(res, 400, "Porcentaje no válido.");
    if (!Number.isInteger(zonas) || zonas < 0 || zonas > 10000) return fail(res, 400, "Número de zonas no válido.");

    if (previa) {
      if (!idValido(previa)) return fail(res, 400, "La inspección previa no es válida.");
      const r = await pool.query("SELECT usuario_id FROM inspecciones WHERE id = $1", [previa]);
      if (!r.rows[0] || String(r.rows[0].usuario_id) !== String(req.usuario.id))
        return fail(res, 403, "Solo puedes comparar con tus propias inspecciones.");
    }
    const pct = Math.round(porcentaje * 100) / 100;
    const { rows } = await pool.query(
      `INSERT INTO inspecciones (usuario_id, titulo, ubicacion, paleta, porcentaje_afectado, zonas,
         severidad, imagen_original, imagen_procesada, inspeccion_previa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [req.usuario.id, titulo, ubicacion || null, paleta, pct, zonas, severidadDe(pct), // severidad recalculada en el servidor
       original.buffer, procesada.buffer, previa]
    );
    res.status(201).json({ ok: true, id: rows[0].id, severidad: severidadDe(pct) });
  } catch (e) {
    if (e.code === "23503") return fail(res, 401, "Tu sesión ya no es válida. Inicia sesión de nuevo.");
    console.error(e); fail(res, 500, "No se pudo guardar la inspección.");
  }
});

app.get("/api/inspecciones", requiereSesion, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM inspecciones WHERE usuario_id = $1 ORDER BY creada_en DESC LIMIT 200`, [req.usuario.id]);
    ok(res, { inspecciones: rows });
  } catch (e) { console.error(e); fail(res, 500, "No se pudo cargar el historial."); }
});

// Detalle + inspección previa (para la vista «Antes y después»).
app.get("/api/inspecciones/:id", requiereSesion, async (req, res) => {
  try {
    const fila = await obtenerPropia(req, res, COLS);
    if (!fila) return;
    delete fila.usuario_id;
    let anterior = null;
    if (fila.previa) {
      const r = await pool.query(`SELECT ${COLS} FROM inspecciones WHERE id = $1 AND usuario_id = $2`, [fila.previa, req.usuario.id]);
      anterior = r.rows[0] || null;
    }
    ok(res, { inspeccion: fila, anterior });
  } catch (e) { console.error(e); fail(res, 500, "No se pudo cargar la inspección."); }
});

app.get("/api/inspecciones/:id/imagen/:tipo", requiereSesion, async (req, res) => {
  const col = { original: "imagen_original", procesada: "imagen_procesada" }[req.params.tipo];
  if (!col) return fail(res, 404, "Tipo de imagen no válido.");
  try {
    const fila = await obtenerPropia(req, res, col);
    if (!fila) return;
    res.set({ "Content-Type": tipoImagen(fila[col]) || "application/octet-stream", "Cache-Control": "private, max-age=3600" });
    res.send(fila[col]);
  } catch (e) { console.error(e); fail(res, 500, "No se pudo cargar la imagen."); }
});

app.delete("/api/inspecciones/:id", requiereSesion, async (req, res) => {
  try {
    const fila = await obtenerPropia(req, res, "id");
    if (!fila) return;
    await pool.query("DELETE FROM inspecciones WHERE id = $1", [req.params.id]);
    ok(res, {});
  } catch (e) { console.error(e); fail(res, 500, "No se pudo eliminar."); }
});

app.use("/api", (_req, res) => fail(res, 404, "Ruta no encontrada."));

// ---------- Sitio estático ----------
app.use(express.static(path.join(__dirname, "public")));

initDb()
  .then(() => app.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT}`)))
  .catch((e) => { console.error("Error al preparar la base de datos:", e.message); process.exit(1); });
