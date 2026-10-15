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
      "script-src": ["'self'"],
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

app.use("/api", (_req, res) => fail(res, 404, "Ruta no encontrada."));

// ---------- Sitio estático ----------
app.use(express.static(path.join(__dirname, "public")));

initDb()
  .then(() => app.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT}`)))
  .catch((e) => { console.error("Error al preparar la base de datos:", e.message); process.exit(1); });
