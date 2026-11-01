import { configured, getSession, signIn, signOut, isAdmin, fetchRemote, withDefaults, saveContent } from "./api.js";
import { h, toast, confirmBox, icon } from "./ui.js";
import { SECTIONS, validate, strip } from "./sections.js";

const app = document.getElementById("app");

// localStorage puede no estar (ventana privada): todo lo que dependa de él es un extra, nunca un requisito
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};
const DRAFT_KEY = "pm-admin-draft";

let user = null, draft = null, remoteData = null, isDirty = false, current = store.get("pm-admin-section") || "resumen";
let saveBtn, discardBtn, statusEl, goto, stashTimer;

const mark = '<svg viewBox="0 0 24 24" width="26" height="26"><rect width="24" height="24" rx="7" fill="#f4b400"/><path d="M2 18c7 1 14-3 20-11v5C16 19 9 22 2 21z" fill="#171200"/><path d="M2 21c7 1 14-3 20-11" stroke="#d8261f" stroke-width="2.2" fill="none"/></svg>';
const brand = () => h("div", { class: "brand", html: mark + "<span>Panamericano</span>" });

/* ---------- pantallas de entrada: misma composición en las tres ---------- */
const entry = (kids, wide) => h("div", { class: "entry" },
  h("aside", { class: "entry__art" }, brand(),
    h("div", { class: "entry__copy" },
      h("p", { class: "entry__big" }, "Horarios, textos y fotos, al día."),
      h("p", {}, "Todo lo que se ve en la web se edita desde acá."))),
  h("main", { class: "entry__form" + (wide ? " entry__form--wide" : "") }, ...kids));

function setupScreen() {
  const step = (t, d) => h("li", {}, h("strong", {}, t), d && h("p", {}, d));
  app.replaceChildren(entry([
    h("h1", {}, "Falta conectar la base de datos"),
    h("p", { class: "lead" }, "El panel guarda todo en Supabase (gratis). Se hace una sola vez, en unos 10 minutos:"),
    h("ol", { class: "steps" },
      step("Crear el proyecto", "Entrá a supabase.com, creá una cuenta y un proyecto nuevo (región São Paulo). Guardá la contraseña de la base."),
      step("Crear las tablas y permisos", "En el proyecto: SQL Editor → New query → pegá todo el contenido del archivo supabase/schema.sql del repositorio → Run."),
      step("Crear tu usuario", "Authentication → Users → Add user → ingresá tu email y una contraseña. Después, en Authentication → Sign In / Providers → Email, desactivá el alta de usuarios nuevos (\"Allow new users to sign up\")."),
      step("Darte permiso de administrador", "En el SQL Editor ejecutá la última sentencia de schema.sql con tu email (está comentada, con instrucciones)."),
      step("Conectar la web", "Settings → API: copiá \"Project URL\" y la clave \"anon public\". En Vercel: Settings → Environment Variables, agregalas como VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY y volvé a desplegar.")),
    h("p", { class: "hint" }, "Todo está explicado paso a paso en el README.md, sección \"Panel de administración\"."),
  ], true));
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
  app.replaceChildren(entry([h("h1", {}, "Panel de administración"), h("p", { class: "lead" }, "Ingresá con tu usuario para editar la web."), form]));
  email.focus();
}

function deniedScreen(email) {
  app.replaceChildren(entry([
    h("h1", {}, "Sin permiso"),
    h("p", { class: "lead" }, `La cuenta ${email} no es administradora de esta web. Pedile a quien la creó que te dé acceso.`),
    h("button", { class: "btn", type: "button", onclick: async () => { await signOut(); await boot(); } }, "Salir"),
  ]));
}

/* ---------- panel ---------- */
const stashDraft = () => { if (user && draft) store.set(DRAFT_KEY, JSON.stringify({ at: Date.now(), user: user.id, data: strip(draft) })); };
const setDirty = () => {
  if (!isDirty) { isDirty = true; paintStatus(); }
  clearTimeout(stashTimer); stashTimer = setTimeout(stashDraft, 700); // borrador automático en este navegador
};
function paintStatus() {
  if (!statusEl) return;
  statusEl.textContent = isDirty ? "Hay cambios sin publicar" : "Todo publicado";
  statusEl.className = "state " + (isDirty ? "is-dirty" : "is-ok");
  saveBtn.disabled = !isDirty;
  discardBtn.hidden = !isDirty;
}

async function publish() {
  const errors = validate(draft);
  if (errors.length) {
    const list = h("ul", { class: "errs" }, errors.map((x) => h("li", {},
      h("span", {}, x.msg),
      h("button", { type: "button", class: "link", onclick: () => { document.querySelector(".modal .btn:last-child")?.click(); goto(x.sec, x); } }, "Ir ahí", icon("arrow", 14)))));
    await confirmBox(h("div", {}, h("strong", {}, `Antes de publicar, revisá ${errors.length === 1 ? "esto" : "estas " + errors.length + " cosas"}:`), list), "Entendido");
    return;
  }
  saveBtn.disabled = true; saveBtn.textContent = "Publicando…";
  try {
    await saveContent(strip(draft), user.id);
    remoteData = strip(draft); store.del(DRAFT_KEY); clearTimeout(stashTimer);
    isDirty = false; paintStatus(); toast("Publicado. La web ya muestra los cambios.");
  } catch (e) { toast(e.message, "err", 9000); saveBtn.disabled = false; }
  finally { saveBtn.textContent = "Guardar y publicar"; }
}

function shell(pending) {
  const main = h("div", { class: "main" });
  const nav = h("nav", { class: "side__nav", "aria-label": "Secciones" });
  const ctx = {
    dirty: setDirty,
    rerender: () => draw(),
    goto: (...a) => goto(...a),
    replaceDraft: (data) => { draft = withDefaults(data); setDirty(); draw(); },
  };
  const draw = () => {
    const sec = SECTIONS.find((s) => s.id === current) || SECTIONS[0];
    nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === sec.id)));
    const y = scrollY;
    main.replaceChildren(h("h2", { class: "title" }, sec.label), sec.render({ ...ctx, draft }));
    scrollTo(0, y);
  };

  // lleva al cliente al campo exacto con el problema y lo resalta un momento
  const focusTarget = ({ item, field }) => {
    let scope = main;
    if (item != null) scope = main.querySelectorAll(".list > .item")[item] || main;
    let target = scope;
    if (field) {
      const lab = [...scope.querySelectorAll("label")].find((l) => l.textContent.trim().toLowerCase().startsWith(field.toLowerCase()));
      const box = lab?.closest(".field");
      if (box) { target = box; box.querySelector("input,textarea")?.focus({ preventScroll: true }); }
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("is-flash"); setTimeout(() => target.classList.remove("is-flash"), 2400);
  };
  goto = (id, t) => {
    current = id; store.set("pm-admin-section", id); draw();
    if (t && (t.item != null || t.field)) requestAnimationFrame(() => focusTarget(t)); else scrollTo(0, 0);
  };

  let last = "";
  SECTIONS.forEach((s) => {
    if (s.group !== last) { last = s.group; if (s.group !== "Inicio") nav.append(h("p", { class: "side__group" }, s.group)); }
    nav.append(h("button", { type: "button", "data-id": s.id, onclick: () => goto(s.id) }, icon(s.id), h("span", {}, s.label)));
  });

  statusEl = h("span", { class: "state", role: "status" });
  saveBtn = h("button", { class: "btn btn--primary", type: "button", title: "Guardar y publicar (Ctrl+S)", onclick: publish }, "Guardar y publicar");
  discardBtn = h("button", { class: "btn btn--ghost", type: "button", hidden: true, onclick: async () => {
    if (!(await confirmBox("Se pierden todos los cambios que no publicaste y vuelve lo que está hoy en la web. ¿Descartarlos?", "Descartar"))) return;
    draft = withDefaults(structuredClone(remoteData)); isDirty = false; clearTimeout(stashTimer); store.del(DRAFT_KEY); paintStatus(); draw(); toast("Cambios descartados.");
  } }, "Descartar cambios");

  // borrador de una sesión anterior que no se llegó a publicar
  const recover = pending && h("div", { class: "recover", role: "alert" },
    h("span", {}, `Tenés cambios sin publicar del ${new Date(pending.at).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" })}, guardados en este navegador.`),
    h("span", { class: "recover__act" },
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => { store.del(DRAFT_KEY); recover.remove(); } }, "Descartarlos"),
      h("button", { type: "button", class: "btn", onclick: () => { draft = withDefaults(pending.data); setDirty(); recover.remove(); draw(); } }, "Recuperarlos")));

  app.replaceChildren(h("div", { class: "layout" },
    h("aside", { class: "side" }, h("div", { class: "livery", "aria-hidden": "true" }), brand(), nav,
      h("div", { class: "side__foot" }, h("small", {}, user.email), h("button", { type: "button", class: "link", onclick: async () => {
        if (isDirty && !(await confirmBox("Hay cambios sin publicar. Si salís se pierden. ¿Salir igual?", "Salir"))) return;
        isDirty = false; store.del(DRAFT_KEY); await signOut(); await boot();
      } }, icon("logout", 17), "Cerrar sesión"))),
    h("div", { class: "content" },
      h("header", { class: "top" }, statusEl, h("a", { class: "link", href: "/", target: "_blank", rel: "noopener" }, "Ver la web", icon("external", 16)), discardBtn, saveBtn),
      recover || null,
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
    remoteData = remote?.data ?? null;
    draft = withDefaults(structuredClone(remoteData)); isDirty = false; // copia: editar el borrador no debe tocar lo publicado
    let pending = null;
    try { pending = JSON.parse(store.get(DRAFT_KEY) || "null"); } catch { pending = null; }
    if (!pending || pending.user !== user.id || JSON.stringify(pending.data) === JSON.stringify(strip(draft))) { if (pending) store.del(DRAFT_KEY); pending = null; }
    shell(pending);
  } catch (e) {
    loginScreen(e.message);
  }
}

// Ctrl+S / Cmd+S publica
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (saveBtn?.isConnected && !saveBtn.disabled && !document.querySelector(".modal")) publish();
  }
});
addEventListener("beforeunload", (e) => { if (isDirty) { stashDraft(); e.preventDefault(); e.returnValue = ""; } });
boot();
