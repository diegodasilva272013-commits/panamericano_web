import { configured, getSession, signIn, signOut, isAdmin, fetchRemote, withDefaults, saveContent } from "./api.js";
import { h, toast, confirmBox, icon } from "./ui.js";
import { SECTIONS, validate, strip, fmtDate, nextDepartures } from "./sections.js";

const app = document.getElementById("app");

// localStorage puede no estar (ventana privada): todo lo que dependa de él es un extra, nunca un requisito
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};
const DRAFT_KEY = "pm-admin-draft";

let user = null, draft = null, remoteData = null, lastPub = null, isDirty = false, current = store.get("pm-admin-section") || "resumen";
let saveBtn, discardBtn, statusEl, topEl, sideEl, navEl, goto, stashTimer, paintTimer, baseJson = {};

const mark = '<svg viewBox="0 0 24 24" width="26" height="26"><rect width="24" height="24" rx="7" fill="#f4b400"/><path d="M2 18c7 1 14-3 20-11v5C16 19 9 22 2 21z" fill="#171200"/><path d="M2 21c7 1 14-3 20-11" stroke="#d8261f" stroke-width="2.2" fill="none"/></svg>';
const brand = () => h("div", { class: "brand", html: mark + "<span>Panamericano</span>" });
const sectionLabel = (id) => SECTIONS.find((s) => s.id === id)?.label || id;

/* qué parte de la web cambió respecto de lo publicado */
const KEY2SEC = { hero: "hero", texts: "textos", site: "contacto", routes: "horarios", destinations: "destinos", gallery: "galeria", boardImage: "galeria", services: "galeria", boleterias: "contacto", faq: "contacto" };
const computeBase = () => { const b = strip(withDefaults(structuredClone(remoteData))); baseJson = Object.fromEntries(Object.keys(KEY2SEC).map((k) => [k, JSON.stringify(b[k])])); };
const changedSections = () => { const d = strip(draft), s = new Set(); for (const k of Object.keys(KEY2SEC)) if (JSON.stringify(d[k]) !== baseJson[k]) s.add(KEY2SEC[k]); return s; };

/* ---------- pantallas de entrada: misma composición en las tres ---------- */
const entry = (kids, wide, mid) => h("div", { class: "entry" },
  h("aside", { class: "entry__art" }, brand(), mid || h("div", {}),
    h("div", { class: "entry__copy" },
      h("p", { class: "entry__big" }, "Horarios, textos y fotos, al día."),
      h("p", {}, "Todo lo que se ve en la web se edita desde acá."))),
  h("main", { class: "entry__form" + (wide ? " entry__form--wide" : "") }, ...kids));

// las próximas salidas reales de la empresa, ya en la puerta del panel
function loginBoard() {
  const el = h("div", { class: "board board--login", "aria-label": "Próximas salidas" });
  fetchRemote().then((r) => {
    const nd = nextDepartures(withDefaults(r?.data).routes, 3);
    if (!nd.list.length) return el.remove();
    el.append(...nd.list.map((x, i) => h("div", { class: "board__line" + (i === 0 ? " is-next" : "") },
      h("span", { class: "board__time" }, x.t, x.r.days?.[x.t] ? "*" : ""),
      h("span", { class: "board__dest" }, h("strong", {}, `${x.r.from || "Origen"} → ${x.r.to || "Destino"}`), x.r.service && h("small", {}, x.r.service)))));
  }).catch(() => el.remove());
  return el;
}

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
  app.replaceChildren(entry([h("h1", {}, "Panel de administración"), h("p", { class: "lead" }, "Ingresá con tu usuario para editar la web."), form], false, loginBoard()));
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
  clearTimeout(paintTimer); paintTimer = setTimeout(paintStatus, 250);
};
function paintStatus() {
  if (!statusEl) return;
  const ch = isDirty ? [...changedSections()] : [];
  statusEl.textContent = isDirty ? (ch.length ? `Hay cambios sin publicar en ${ch.map(sectionLabel).join(", ")}` : "Hay cambios sin publicar") : lastPub ? `Publicado · ${fmtDate(lastPub)}` : "Todo publicado";
  statusEl.className = "state " + (isDirty ? "is-dirty" : "is-ok");
  saveBtn.disabled = !isDirty;
  saveBtn.title = isDirty ? "Guardar y publicar (Ctrl+S)" : "No hay cambios para publicar";
  discardBtn.hidden = !isDirty;
  navEl?.querySelectorAll("button[data-id]").forEach((b) => b.classList.toggle("has-changes", ch.includes(b.dataset.id)));
}
const saveLabel = () => saveBtn.replaceChildren(h("span", { class: "lbl-dirty" }, "Guardar y publicar"), h("span", { class: "lbl-clean" }, "Todo publicado"));

async function publish() {
  const errors = validate(draft);
  if (errors.length) {
    const list = h("ul", { class: "errs" }, errors.map((x) => h("li", {},
      h("span", {}, x.msg),
      h("button", { type: "button", class: "link", onclick: () => { document.querySelector(".modal .btn--ghost")?.click(); goto(x.sec, x); } }, "Ir ahí", icon("arrow", 14)))));
    const first = errors[0];
    if (await confirmBox(h("div", {}, h("strong", {}, `Antes de publicar, revisá ${errors.length === 1 ? "esto" : "estas " + errors.length + " cosas"}:`), list), "Ir al primer error", "Seguir editando")) goto(first.sec, first);
    return;
  }
  saveBtn.disabled = true; saveBtn.textContent = "Publicando…"; topEl.classList.add("is-busy");
  try {
    await saveContent(strip(draft), user.id);
    remoteData = strip(draft); lastPub = new Date(); computeBase(); store.del(DRAFT_KEY); clearTimeout(stashTimer);
    isDirty = false; paintStatus(); toast("Publicado. La web ya muestra los cambios.");
  } catch (e) { toast(e.message, "err", 9000); saveBtn.disabled = false; }
  finally { saveLabel(); topEl.classList.remove("is-busy"); paintStatus(); }
}

// ayuda propia de cada pantalla
const help = (sec) => confirmBox(h("div", { class: "help" },
  h("h3", {}, `¿Cómo se hace? · ${sec.label}`),
  sec.desc && h("p", {}, sec.desc),
  h("ol", {}, (sec.help || []).map((s) => h("li", {}, s))),
  h("section", {}, h("strong", {}, "Me equivoqué, ¿puedo volver atrás?"),
    h("p", {}, "Sí. Si quitaste algo, tocá \"Deshacer\". Antes de publicar, \"Descartar cambios\" deja todo como estaba. Si ya publicaste, en \"Versiones anteriores\" cargás cualquier versión vieja."))),
  "Entendido", false);

// buscador de pantallas y acciones (Ctrl+K)
function palette() {
  if (document.querySelector(".palette")) return;
  const acts = [
    ...SECTIONS.map((s) => ({ label: s.label, sub: s.desc, run: () => goto(s.id) })),
    { label: "Cambiar un horario", sub: "Ir a los horarios de salida", run: () => goto("horarios") },
    { label: "Guardar y publicar", sub: "Ctrl+S", run: () => publish() },
    { label: "Ver la web", sub: "Se abre en otra pestaña", run: () => window.open("/", "_blank", "noopener") },
  ];
  let sel = 0, shown = acts;
  const input = h("input", { type: "text", placeholder: "Escribí a dónde querés ir…", "aria-label": "Buscar pantalla o acción", role: "combobox", "aria-expanded": "true" });
  const ul = h("ul", { class: "palette__list", role: "listbox" });
  const close = () => { ov.remove(); document.removeEventListener("keydown", key, true); };
  const run = (a) => { close(); a.run(); };
  const draw = () => { ul.replaceChildren(...shown.map((a, i) => h("li", { role: "option", "aria-selected": String(i === sel), class: i === sel ? "is-sel" : "", onclick: () => run(a) }, h("strong", {}, a.label), a.sub && h("small", {}, a.sub)))); };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === "Enter" && shown[sel]) { e.preventDefault(); run(shown[sel]); }
  };
  input.addEventListener("input", () => { const q = input.value.trim().toLowerCase(); shown = acts.filter((a) => (a.label + " " + (a.sub || "")).toLowerCase().includes(q)); sel = 0; draw(); });
  const ov = h("div", { class: "modal palette", onclick: (e) => { if (e.target === ov) close(); } }, h("div", { class: "modal__box palette__box", role: "dialog", "aria-modal": "true", "aria-label": "Buscar" }, input, ul));
  document.addEventListener("keydown", key, true); document.body.append(ov); draw(); input.focus();
}

function shell(pending) {
  const main = h("div", { class: "main" });
  navEl = h("nav", { class: "side__nav", "aria-label": "Secciones" });
  const ctx = {
    dirty: setDirty,
    rerender: () => draw(),
    goto: (...a) => goto(...a),
    lastPublished: () => lastPub,
    replaceDraft: (data) => { draft = withDefaults(data); setDirty(); draw(); },
  };
  const draw = () => {
    const sec = SECTIONS.find((s) => s.id === current) || SECTIONS[0];
    navEl.querySelectorAll("button[data-id]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === sec.id)));
    const y = scrollY;
    main.replaceChildren(
      h("div", { class: "head" },
        h("div", {}, h("h2", { class: "title" }, sec.label), sec.desc && h("p", { class: "title__desc" }, sec.desc)),
        h("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: () => help(sec) }, icon("preguntas", 17), "¿Cómo se hace?")),
      sec.render({ ...ctx, draft }));
    scrollTo(0, y);
  };

  // lleva al cliente al campo exacto con el problema, lo marca y lo resalta un momento
  const focusTarget = ({ item, field, msg }) => {
    let scope = main;
    if (item != null) scope = main.querySelectorAll(".list > .item")[item] || main;
    let target = scope;
    if (field) {
      const lab = [...scope.querySelectorAll("label")].find((l) => l.textContent.trim().toLowerCase().startsWith(field.toLowerCase()));
      const box = lab?.closest(".field");
      if (box) {
        target = box; box.closest("details")?.setAttribute("open", "");
        box.classList.add("is-bad");
        let e = box.querySelector(".err"); if (!e) { e = h("small", { class: "err", role: "alert" }); box.append(e); }
        const m = (msg || "").split(": ").slice(1).join(": ") || msg || "Revisá este dato."; e.textContent = m.charAt(0).toUpperCase() + m.slice(1);
        box.querySelector("input,textarea")?.focus({ preventScroll: true });
        box.addEventListener("input", () => { box.classList.remove("is-bad"); e.textContent = ""; }, { once: true });
      }
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("is-flash"); setTimeout(() => target.classList.remove("is-flash"), 2400);
  };
  goto = (id, t) => {
    current = id; store.set("pm-admin-section", id); draw(); sideEl?.classList.remove("is-open");
    if (t && (t.item != null || t.field)) requestAnimationFrame(() => focusTarget(t)); else scrollTo(0, 0);
  };

  let last = "";
  SECTIONS.forEach((s) => {
    if (s.group !== last) { last = s.group; if (s.group !== "Inicio") navEl.append(h("p", { class: "side__group" }, s.group)); }
    navEl.append(h("button", { type: "button", "data-id": s.id, onclick: () => goto(s.id) }, icon(s.id), h("span", {}, s.label)));
  });

  statusEl = h("span", { class: "state", role: "status" });
  saveBtn = h("button", { class: "btn btn--primary", type: "button", onclick: publish }); saveLabel();
  discardBtn = h("button", { class: "btn btn--ghost", type: "button", hidden: true, onclick: async () => {
    if (!(await confirmBox("Se pierden todos los cambios que no publicaste y vuelve lo que está hoy en la web. ¿Descartarlos?", "Descartar"))) return;
    draft = withDefaults(structuredClone(remoteData)); isDirty = false; clearTimeout(stashTimer); store.del(DRAFT_KEY); paintStatus(); draw(); toast("Cambios descartados.");
  } }, "Descartar cambios");

  // borrador de una sesión anterior que no se llegó a publicar
  const recover = pending && h("div", { class: "recover", role: "alert" },
    h("span", {}, `Tenés cambios sin publicar del ${fmtDate(pending.at)}, guardados en este navegador.`),
    h("span", { class: "recover__act" },
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => { store.del(DRAFT_KEY); recover.remove(); } }, "Descartarlos"),
      h("button", { type: "button", class: "btn", onclick: () => { draft = withDefaults(pending.data); setDirty(); recover.remove(); draw(); } }, "Recuperarlos")));

  topEl = h("header", { class: "top" }, h("div", { class: "busybar", "aria-hidden": "true" }), statusEl, h("a", { class: "link", href: "/", target: "_blank", rel: "noopener" }, "Ver la web", icon("external", 16)), discardBtn, saveBtn);
  sideEl = h("aside", { class: "side" }, h("div", { class: "livery", "aria-hidden": "true" }),
    h("div", { class: "side__bar" }, brand(),
      h("button", { type: "button", class: "side__toggle", "aria-label": "Abrir el menú", onclick: () => sideEl.classList.toggle("is-open") }, icon("menu", 22))),
    h("div", { class: "side__body" },
      h("button", { type: "button", class: "side__search", onclick: palette }, icon("search", 17), h("span", {}, "Ir a…"), h("kbd", {}, "Ctrl K")),
      navEl,
      h("div", { class: "side__foot" }, h("small", {}, user.email),
        h("button", { type: "button", class: "link", onclick: () => help(SECTIONS.find((s) => s.id === current) || SECTIONS[0]) }, icon("preguntas", 17), "Ayuda"),
        h("a", { class: "link only-m", href: "/", target: "_blank", rel: "noopener" }, icon("external", 16), "Ver la web"),
        h("button", { type: "button", class: "link", onclick: async () => {
          if (isDirty && !(await confirmBox("Hay cambios sin publicar. Si salís se pierden. ¿Salir igual?", "Salir"))) return;
          isDirty = false; store.del(DRAFT_KEY); await signOut(); await boot();
        } }, icon("logout", 17), "Cerrar sesión"))));
  app.replaceChildren(h("div", { class: "layout" }, sideEl, h("div", { class: "content" }, topEl, recover || null, main)));
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
    remoteData = remote?.data ?? null; lastPub = remote?.updated_at ? new Date(remote.updated_at) : null;
    draft = withDefaults(structuredClone(remoteData)); isDirty = false; // copia: editar el borrador no debe tocar lo publicado
    computeBase();
    let pending = null;
    try { pending = JSON.parse(store.get(DRAFT_KEY) || "null"); } catch { pending = null; }
    if (!pending || pending.user !== user.id || JSON.stringify(pending.data) === JSON.stringify(strip(draft))) { if (pending) store.del(DRAFT_KEY); pending = null; }
    shell(pending);
  } catch (e) {
    loginScreen(e.message);
  }
}

// atajos: Ctrl+S publica, Ctrl+K busca
addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "s") {
    e.preventDefault();
    if (saveBtn?.isConnected && !saveBtn.disabled && !document.querySelector(".modal")) publish();
  } else if (k === "k" && saveBtn?.isConnected && !document.querySelector(".modal")) { e.preventDefault(); palette(); }
});
addEventListener("beforeunload", (e) => { if (isDirty) { stashDraft(); e.preventDefault(); e.returnValue = ""; } });
boot();
