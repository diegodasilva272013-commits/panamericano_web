import { configured, getSession, signIn, signOut, isAdmin, fetchRemote, withDefaults, saveContent } from "./api.js";
import { h, toast, confirmBox } from "./ui.js";
import { SECTIONS, validate, strip } from "./sections.js";

const app = document.getElementById("app");
let user = null, draft = null, isDirty = false, current = localStorage.getItem("pm-admin-section") || "hero";
let saveBtn, statusEl;

const mark = '<svg viewBox="0 0 24 24" width="26" height="26"><rect width="24" height="24" rx="7" fill="#f4b400"/><path d="M2 18c7 1 14-3 20-11v5C16 19 9 22 2 21z" fill="#171200"/><path d="M2 21c7 1 14-3 20-11" stroke="#d8261f" stroke-width="2.2" fill="none"/></svg>';
const brand = () => h("div", { class: "brand", html: mark + "<span>Panamericano</span>" });

/* ---------- pantallas simples ---------- */
function setupScreen() {
  const step = (t, d) => h("li", {}, h("strong", {}, t), d && h("p", {}, d));
  app.replaceChildren(h("main", { class: "gate gate--wide" }, brand(),
    h("h1", {}, "Falta conectar la base de datos"),
    h("p", { class: "lead" }, "El panel guarda todo en Supabase (gratis). Se hace una sola vez, en unos 10 minutos:"),
    h("ol", { class: "steps" },
      step("Crear el proyecto", "Entrá a supabase.com, creá una cuenta y un proyecto nuevo (región São Paulo). Guardá la contraseña de la base."),
      step("Crear las tablas y permisos", "En el proyecto: SQL Editor → New query → pegá todo el contenido del archivo supabase/schema.sql del repositorio → Run."),
      step("Crear tu usuario", "Authentication → Users → Add user → ingresá tu email y una contraseña. Después, en Authentication → Sign In / Providers → Email, desactivá el alta de usuarios nuevos (\"Allow new users to sign up\")."),
      step("Darte permiso de administrador", "En el SQL Editor ejecutá la última sentencia de schema.sql con tu email (está comentada, con instrucciones)."),
      step("Conectar la web", "Settings → API: copiá \"Project URL\" y la clave \"anon public\". En Vercel: Settings → Environment Variables, agregalas como VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY y volvé a desplegar.")),
    h("p", { class: "hint" }, "Todo está explicado paso a paso en el README.md, sección \"Panel de administración\".")));
}

function loginScreen(error) {
  const email = h("input", { type: "email", id: "em", autocomplete: "username", required: true });
  const pass = h("input", { type: "password", id: "pw", autocomplete: "current-password", required: true });
  const err = h("p", { class: "err", role: "alert" }, error || "");
  const btn = h("button", { class: "btn", type: "submit" }, "Entrar");
  const form = h("form", { class: "login", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ""; btn.disabled = true; btn.textContent = "Entrando…";
    try { await signIn(email.value.trim(), pass.value); await boot(); }
    catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = "Entrar"; }
  } },
    h("div", { class: "field" }, h("label", { for: "em" }, "Email"), email),
    h("div", { class: "field" }, h("label", { for: "pw" }, "Contraseña"), pass), err, btn);
  app.replaceChildren(h("main", { class: "gate" }, brand(), h("h1", {}, "Panel de administración"), h("p", { class: "lead" }, "Ingresá con tu usuario para editar la web."), form));
  email.focus();
}

function deniedScreen(email) {
  app.replaceChildren(h("main", { class: "gate" }, brand(), h("h1", {}, "Sin permiso"),
    h("p", { class: "lead" }, `La cuenta ${email} no es administradora de esta web. Pedile a quien la creó que te dé acceso.`),
    h("button", { class: "btn", type: "button", onclick: async () => { await signOut(); await boot(); } }, "Salir")));
}

/* ---------- panel ---------- */
const setDirty = () => { if (!isDirty) { isDirty = true; paintStatus(); } };
function paintStatus() {
  if (!statusEl) return;
  statusEl.textContent = isDirty ? "Hay cambios sin publicar" : "Todo publicado";
  statusEl.className = "state " + (isDirty ? "is-dirty" : "is-ok");
  saveBtn.disabled = !isDirty;
}

async function publish() {
  const errors = validate(draft);
  if (errors.length) {
    await confirmBox(h("div", {}, h("strong", {}, "Antes de publicar, revisá esto:"), h("ul", { class: "errs" }, errors.map((x) => h("li", {}, x)))), "Entendido");
    return;
  }
  saveBtn.disabled = true; saveBtn.textContent = "Publicando…";
  try {
    await saveContent(strip(draft), user.id);
    isDirty = false; paintStatus(); toast("Publicado. La web ya muestra los cambios.");
  } catch (e) { toast(e.message, "err", 9000); saveBtn.disabled = false; }
  finally { saveBtn.textContent = "Guardar y publicar"; }
}

function shell() {
  const main = h("div", { class: "main" });
  const nav = h("nav", { class: "side__nav", "aria-label": "Secciones" });
  const ctx = {
    dirty: setDirty,
    rerender: () => draw(),
    replaceDraft: (data) => { draft = withDefaults(data); setDirty(); draw(); },
  };
  const draw = () => {
    const sec = SECTIONS.find((s) => s.id === current) || SECTIONS[0];
    nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === sec.id)));
    const y = scrollY;
    main.replaceChildren(h("h2", { class: "title" }, sec.label), sec.render({ ...ctx, draft }));
    scrollTo(0, y);
  };
  SECTIONS.forEach((s) => nav.append(h("button", { type: "button", "data-id": s.id, onclick: () => { current = s.id; localStorage.setItem("pm-admin-section", s.id); draw(); scrollTo(0, 0); } }, s.label)));

  statusEl = h("span", { class: "state" });
  saveBtn = h("button", { class: "btn", type: "button", onclick: publish }, "Guardar y publicar");
  app.replaceChildren(h("div", { class: "layout" },
    h("aside", { class: "side" }, brand(), nav,
      h("div", { class: "side__foot" }, h("small", {}, user.email), h("button", { type: "button", class: "link", onclick: async () => {
        if (isDirty && !(await confirmBox("Hay cambios sin publicar. Si salís se pierden. ¿Salir igual?", "Salir"))) return;
        isDirty = false; await signOut(); await boot();
      } }, "Cerrar sesión"))),
    h("div", { class: "content" },
      h("header", { class: "top" }, statusEl, h("a", { class: "link", href: "/", target: "_blank", rel: "noopener" }, "Ver la web ↗"), saveBtn),
      main)));
  draw(); paintStatus();
}

async function boot() {
  if (!configured) return setupScreen();
  try {
    const session = await getSession();
    if (!session) return loginScreen();
    user = session.user;
    if (!(await isAdmin(user.id))) return deniedScreen(user.email);
    const remote = await fetchRemote();
    draft = withDefaults(remote?.data); isDirty = false;
    shell();
  } catch (e) {
    loginScreen(e.message);
  }
}

addEventListener("beforeunload", (e) => { if (isDirty) { e.preventDefault(); e.returnValue = ""; } });
boot();
