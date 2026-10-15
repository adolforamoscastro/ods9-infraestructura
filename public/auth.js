(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const modal = $("#auth-modal");
  const form = $("#auth-form");
  const emailEl = $("#auth-email");
  const passEl = $("#auth-password");
  const errorEl = $("#auth-error");
  const submitEl = $("#auth-submit");
  const joinBtn = $("#join-btn");
  const logoutBtn = $("#logout-btn");
  let mode = "registro";
  let lastFocus = null;

  // ---------- API ----------
  async function api(url, options) {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || data.ok === false) throw new Error(data.error || "Ocurrió un error. Inténtalo otra vez.");
    return data;
  }

  // ---------- Contador ----------
  function setCount(n) {
    const label = n === 1 ? "persona apoya este proyecto" : "personas apoyan este proyecto";
    $$("[data-support-count]").forEach(el => { el.textContent = Number(n).toLocaleString("es"); });
    $$("[data-support-label]").forEach(el => {
      el.textContent = el.closest(".modal-sub") ? (n === 1 ? "persona" : "personas") : label;
    });
  }
  async function loadCount() {
    try { setCount((await api("/api/apoyos")).total); }
    catch (_) { $$("[data-support-count]").forEach(el => { el.textContent = "–"; }); }
  }

  // ---------- Estado de sesión ----------
  function setUser(user) {
    if (user) {
      joinBtn.textContent = "✓ YA ERES PARTE";
      joinBtn.classList.add("joined");
      joinBtn.title = user.email;
      logoutBtn.hidden = false;
    } else {
      joinBtn.textContent = "UNETENOS";
      joinBtn.classList.remove("joined");
      joinBtn.removeAttribute("title");
      logoutBtn.hidden = true;
    }
  }
  async function loadSession() {
    try { setUser((await api("/api/yo")).usuario); } catch (_) { setUser(null); }
  }

  // ---------- Modal ----------
  function setMode(m) {
    mode = m;
    $$(".tab").forEach(t => {
      const on = t.dataset.mode === m;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    });
    passEl.autocomplete = m === "registro" ? "new-password" : "current-password";
    submitEl.textContent = m === "registro" ? "Unirme al proyecto" : "Entrar";
    hideError();
  }
  function showError(msg) { errorEl.textContent = msg; errorEl.hidden = false; }
  function hideError() { errorEl.hidden = true; errorEl.textContent = ""; }

  function openModal() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    emailEl.focus();
  }
  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    form.reset();
    hideError();
    if (lastFocus) lastFocus.focus();
  }

  joinBtn.addEventListener("click", () => {
    if (joinBtn.classList.contains("joined")) return; // ya está dentro
    setMode("registro");
    openModal();
  });
  $$("[data-close]", modal).forEach(el => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });
  $$(".tab").forEach(t => t.addEventListener("click", () => setMode(t.dataset.mode)));

  form.addEventListener("submit", async e => {
    e.preventDefault();
    hideError();
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showError("Escribe un correo válido.");
    if (mode === "registro" && password.length < 8) return showError("La contraseña debe tener al menos 8 caracteres.");
    if (!password) return showError("Escribe tu contraseña.");

    submitEl.disabled = true;
    try {
      const data = await api(mode === "registro" ? "/api/registro" : "/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      setUser(data.usuario);
      if (typeof data.total === "number") setCount(data.total);
      closeModal();
    } catch (err) {
      showError(err.message);
    } finally {
      submitEl.disabled = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST", body: "{}" }); } catch (_) {}
    setUser(null);
  });

  // ---------- Menú móvil (el botón ☰ no tenía comportamiento) ----------
  const toggle = $(".menu-toggle");
  const nav = $(".nav");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  $$(".nav a").forEach(a => a.addEventListener("click", () => {
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }));

  loadCount();
  loadSession();
  setInterval(loadCount, 60000); // refresca el conteo cada minuto
})();
