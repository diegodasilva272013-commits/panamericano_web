import { configured, getSession, signIn, signOut, isAdmin, fetchRemote, withDefaults, saveContent } from "./api.js";
import { h, toast, confirmBox, icon, plainErr } from "./ui.js";
import { SECTIONS, validate, strip, fmtDate, fmtShort, nextDepartures } from "./sections.js";

const app = document.getElementById("app");

// localStorage puede no estar (ventana privada): todo lo que dependa de él es un extra, nunca un requisito
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};
const DRAFT_KEY = "pm-admin-draft";

let user = null, draft = null, remoteData = null, lastPub = null, isDirty = false, current = store.get("pm-admin-section") || "resumen";
let saveBtn, discardBtn, statusEl, topEl, sideEl, navEl, goto, redraw, stashTimer, paintTimer, histTimer, baseJson = {};
let undoBtn, redoBtn, errBar, showErrBar = true, histRestored = false; // la barra de errores se muestra siempre que falte algo

/* historial de cambios del borrador: deshacer y rehacer de todo, no solo de lo que se quita */
let hist = [], hi = -1;
const snapNow = () => JSON.stringify(strip(draft));
const HIST_KEY = "pm-admin-hist";
// qué pantallas cambiaron entre dos pasos del historial (para decir qué deshace cada botón)
const secLabelsBetween = (a, b) => { try { const x = JSON.parse(a), y = JSON.parse(b), s = new Set(); for (const k of Object.keys(KEY2SEC)) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) s.add(sectionLabel(KEY2SEC[k])); return [...s].join(", "); } catch { return ""; } };
const paintUndo = () => {
  if (!undoBtn) return;
  undoBtn.disabled = hi <= 0; redoBtn.disabled = hi >= hist.length - 1;
  const u = hi > 0 ? secLabelsBetween(hist[hi - 1], hist[hi]) : "", r = hi < hist.length - 1 ? secLabelsBetween(hist[hi], hist[hi + 1]) : "";
  undoBtn.title = u ? `Deshacer el último cambio en ${u} (Ctrl+Z)` : "Deshacer (Ctrl+Z)";
  redoBtn.title = r ? `Rehacer el cambio en ${r} (Ctrl+Shift+Z)` : "Rehacer (Ctrl+Shift+Z)";
};
// el historial sobrevive a recargar la página (últimos 20 pasos)
const histSave = () => { const n = Math.max(0, hist.length - 20); store.set(HIST_KEY, JSON.stringify({ u: user?.id, b: lastPub ? +lastPub : 0, hist: hist.slice(n), hi: hi - n })); };
const histReset = () => { hist = [snapNow()]; hi = 0; paintUndo(); histSave(); };
const histPush = () => { const s = snapNow(); if (s !== hist[hi]) { hist = hist.slice(0, hi + 1); hist.push(s); if (hist.length > 100) hist.shift(); hi = hist.length - 1; paintUndo(); histSave(); } };
const histGo = (d) => {
  clearTimeout(histTimer); histPush(); // lo último que escribiste entra al historial antes de volver
  const j = hi + d; if (j < 0 || j >= hist.length) return;
  hi = j; draft = withDefaults(JSON.parse(hist[hi])); isDirty = changedSections().size > 0;
  clearTimeout(stashTimer); if (isDirty) stashDraft(); else store.del(DRAFT_KEY);
  const fields = () => [...document.querySelectorAll(".main input, .main textarea")];
  const at = fields().indexOf(document.activeElement); // en cuál campo estaba el cursor
  redraw(); paintStatus(); paintUndo(); histSave();
  if (at >= 0) { const el = fields()[at]; if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* campo sin selección */ } } }
};

// los errores de red se explican en llano (nunca "TypeError: Failed to fetch")
const plain = plainErr;
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

function retryScreen(msg) {
  app.replaceChildren(entry([
    h("h1", {}, "No pudimos cargar el panel"),
    h("p", { class: "lead" }, "Revisá tu conexión a internet y probá de nuevo. Tus cambios sin publicar no se pierden."),
    h("p", { class: "err", role: "alert" }, plain(msg)),
    h("button", { class: "btn btn--primary", type: "button", onclick: () => boot() }, "Reintentar"),
  ]));
  document.body.dataset.retry = "1"; // al volver internet, se reintenta solo
}

// la primera vez que se entra: tres cosas para saber (se puede saltar)
function welcome(force) {
  if (!force && store.get("pm-admin-welcome")) return;
  store.set("pm-admin-welcome", "1");
  confirmBox(h("div", { class: "help" }, h("h3", {}, "Bienvenida"), h("p", {}, "Tres cosas para saber:"),
    h("ol", {}, h("li", {}, "Elegí qué querés cambiar en el menú, o escribilo en el buscador (Ctrl K)."),
      h("li", {}, "Hacé el cambio. A la izquierda ves cómo queda en la web."),
      h("li", {}, "Tocá \"Guardar y publicar\". Si te equivocás, \"Deshacer\" está arriba."))), "Empezar", "Saltar");
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
  clearTimeout(histTimer); histTimer = setTimeout(histPush, 500);
};
// barra de errores: queda arriba mientras falte algo, con enlaces a cada dato
function paintErrBar() {
  if (!errBar) return;
  const errs = showErrBar ? validate(draft) : [];
  const sig = errs.map((x) => x.msg).join("|"); if (sig === errBar.dataset.sig) return; errBar.dataset.sig = sig; // no se vuelve a dibujar (ni anunciar) si no cambió
  if (!errs.length) { errBar.hidden = true; errBar.replaceChildren(); return; }
  errBar.hidden = false;
  errBar.replaceChildren(h("strong", {}, `Faltan ${errs.length} ${errs.length === 1 ? "dato" : "datos"} para publicar:`),
    h("span", { class: "errbar__list" }, errs.slice(0, 4).map((x) => h("button", { type: "button", class: "link", onclick: () => goto(x.sec, x) }, x.msg.replace(/\.$/, ""), icon("arrow", 14))),
      errs.length > 4 ? h("small", {}, `y ${errs.length - 4} más`) : null));
}
function paintStatus() {
  if (!statusEl) return;
  const ch = isDirty ? [...changedSections()] : [];
  statusEl.title = ch.map(sectionLabel).join(", ");
  statusEl.textContent = isDirty ? (ch.length > 1 ? `Hay cambios sin publicar en ${ch.length} pantallas` : ch.length ? `Hay cambios sin publicar en ${sectionLabel(ch[0])}` : "Hay cambios sin publicar") : lastPub ? `Publicado · ${fmtShort(lastPub)}` : "Todo publicado";
  statusEl.className = "state " + (isDirty ? "is-dirty" : "is-ok");
  saveBtn.disabled = !isDirty;
  saveBtn.title = isDirty ? "Guardar y publicar (Ctrl+S)" : "No hay cambios para publicar";
  discardBtn.hidden = !isDirty;
  navEl?.querySelectorAll("button[data-id]").forEach((b) => b.classList.toggle("has-changes", ch.includes(b.dataset.id)));
  document.querySelector(".side__toggle")?.classList.toggle("has-changes", ch.length > 0);
  paintErrBar();
}
const saveLabel = () => saveBtn.replaceChildren(h("span", { class: "lbl-dirty" }, "Guardar y publicar", h("kbd", { class: "kbd-inline" }, "Ctrl S")), h("span", { class: "lbl-clean" }, "Todo publicado"));

async function publish() {
  const errors = validate(draft);
  if (errors.length) {
    const list = h("ul", { class: "errs" }, errors.map((x) => h("li", {},
      h("span", {}, x.msg),
      h("button", { type: "button", class: "link", onclick: () => { document.querySelector(".modal .btn--ghost")?.click(); goto(x.sec, x); } }, "Ir ahí", icon("arrow", 14)))));
    const first = errors[0]; showErrBar = true; paintErrBar();
    if (await confirmBox(h("div", {}, h("strong", {}, `Antes de publicar, revisá ${errors.length === 1 ? "esto" : "estas " + errors.length + " cosas"}:`), list), "Ir al primer error", "Seguir editando")) goto(first.sec, first);
    return;
  }
  saveBtn.disabled = true; saveBtn.textContent = "Publicando…"; topEl.classList.add("is-busy");
  try {
    await saveContent(strip(draft), user.id);
    remoteData = strip(draft); lastPub = new Date(); computeBase(); histSave(); store.del(DRAFT_KEY); clearTimeout(stashTimer);
    isDirty = false; paintStatus(); toast("Publicado. La web ya muestra los cambios.");
  } catch (e) { toast(`No se pudo publicar. ${plain(e)}`, "err", 12000, { label: "Reintentar", icon: "redo", run: () => publish() }); saveBtn.disabled = false; }
  finally { saveLabel(); topEl.classList.remove("is-busy"); paintStatus(); }
}

// ayuda propia de cada pantalla
const help = (sec) => confirmBox(h("div", { class: "help" },
  h("h3", {}, `¿Cómo se hace? · ${sec.label}`),
  sec.desc && h("p", {}, sec.desc),
  h("ol", {}, (sec.help || []).map((s) => h("li", {}, s))),
  h("section", {}, h("strong", {}, "Me equivoqué, ¿puedo volver atrás?"),
    h("p", {}, "Sí. Tocá \"Deshacer\" (o Ctrl+Z) las veces que quieras. \"Descartar cambios\" deja todo como está publicado, y también se puede deshacer. Si ya publicaste, en \"Versiones anteriores\" cargás cualquier versión vieja."))),
  "Entendido", false);

const shortcuts = () => confirmBox(h("div", { class: "help" },
  h("h3", {}, "Atajos del teclado"),
  h("dl", { class: "keys" },
    ...[["Ctrl + S", "Guardar y publicar"], ["Ctrl + K", "Buscar una pantalla, un servicio o una ayuda"], ["Ctrl + Z", "Deshacer el último cambio, también mientras escribís"], ["Ctrl + Shift + Z", "Rehacer"],
      ["Enter", "Confirmar una hora"], ["Esc", "Cerrar la ventanita o el aviso"], ["?", "Ver esta lista"]].flatMap(([k, d]) => [h("dt", {}, h("kbd", {}, k)), h("dd", {}, d)]))),
  "Entendido", false);

// buscador de pantallas, servicios y ayudas (Ctrl+K)
function palette() {
  if (document.querySelector(".palette")) return;
  const acts = [
    ...SECTIONS.map((s) => ({ label: s.label, sub: s.desc, run: () => goto(s.id) })),
    { label: "Cambiar un horario", sub: "Ir a los horarios de salida", run: () => goto("horarios") },
    ...draft.routes.map((r, i) => ({ label: `${r.from || "Origen"} → ${r.to || "Destino"}`, sub: `Horarios${r.service ? " · " + r.service : ""}`, run: () => goto("horarios", { item: i }) })),
    ...draft.destinations.map((d, i) => ({ label: d.name || "Destino", sub: "Destinos", run: () => goto("destinos", { item: i }) })),
    { label: "Guardar y publicar", sub: "Ctrl+S", run: () => publish() },
    { label: "Deshacer", sub: "Ctrl+Z", run: () => histGo(-1) },
    { label: "Ver la web", sub: "Se abre en otra pestaña", run: () => window.open("/", "_blank", "noopener") },
    ...SECTIONS.map((s) => ({ label: `Cómo se hace: ${s.label}`, sub: "Ayuda", run: () => help(s) })),
    { label: "Ver atajos del teclado", sub: "?", run: () => shortcuts() },
    { label: "Ver la bienvenida", sub: "Los tres pasos para empezar", run: () => welcome(true) },
  ];
  const KW = { contacto: "teléfono telefono whatsapp boletería boleteria dirección pregunta frecuentes faq", galeria: "foto fotos imagen galería a bordo servicios", hero: "video titular botones portada inicio", textos: "menú titulo título frase texto", horarios: "salida hora horas servicio tablero", destinos: "lugar lugares ciudad pueblo tarjeta", historial: "versión version volver atrás" };
  acts.forEach((a) => { const s = SECTIONS.find((x) => x.label === a.label); if (s) a.kw = KW[s.id] || ""; });
  let sel = 0, shown = acts;
  const input = h("input", { type: "text", placeholder: "Escribí a dónde querés ir…", "aria-label": "Buscar pantalla o acción", role: "combobox", "aria-expanded": "true", "aria-controls": "pal-list", "aria-autocomplete": "list" });
  const ul = h("ul", { class: "palette__list", role: "listbox", id: "pal-list" });
  const close = () => { ov.remove(); document.removeEventListener("keydown", key, true); };
  const run = (a) => { close(); a.run(); };
  const draw = () => { input.setAttribute("aria-activedescendant", shown.length ? `pal-${sel}` : ""); input.setAttribute("aria-expanded", String(shown.length > 0));
    if (!shown.length) { ul.replaceChildren(h("li", { class: "palette__none", role: "status" }, `Nada coincide con "${input.value}". Probá con otra palabra.`)); return; }
    ul.replaceChildren(...shown.map((a, i) => h("li", { id: `pal-${i}`, role: "option", "aria-selected": String(i === sel), class: i === sel ? "is-sel" : "", onclick: () => run(a) }, h("strong", {}, a.label), a.sub && h("small", {}, a.sub)))); };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === "Tab") e.preventDefault(); // el foco queda en el buscador
    else if (e.key === "Enter" && shown[sel]) { e.preventDefault(); run(shown[sel]); }
  };
  const norm = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  input.addEventListener("input", () => { const ws = norm(input.value).split(/\s+/).filter(Boolean); shown = acts.filter((a) => { const t = norm(a.label + " " + (a.sub || "") + " " + (a.kw || "")); return ws.every((w) => t.includes(w)); }); sel = 0; draw(); });
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

  redraw = draw;
  // lleva al cliente al campo exacto con el problema, lo marca y lo resalta un momento
  const focusTarget = ({ item, list, field, msg }) => {
    let scope = main;
    if (item != null) { const box = list ? main.querySelector(`[data-list="${list}"]`) : main.querySelector(".list"); scope = box?.querySelectorAll(":scope > .item")[item] || main; }
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
  discardBtn = h("button", { class: "btn btn--ghost", type: "button", hidden: true, onclick: () => {
    // sin pregunta: se descarta y queda a mano "Deshacer"
    const prev = snapNow();
    draft = withDefaults(structuredClone(remoteData)); isDirty = false; clearTimeout(stashTimer); store.del(DRAFT_KEY); clearTimeout(histTimer); histPush(); paintStatus(); draw();
    toast("Descartaste los cambios sin publicar.", "ok", 9000, { label: "Deshacer", run: () => { draft = withDefaults(JSON.parse(prev)); isDirty = true; stashDraft(); histPush(); paintStatus(); draw(); } });
  } }, "Descartar cambios");

  // borrador de una sesión anterior que no se llegó a publicar
  const recover = pending && h("div", { class: "recover", role: "alert" },
    h("span", {}, `Tenés cambios sin publicar del ${fmtDate(pending.at)}, guardados en este navegador.`),
    h("span", { class: "recover__act" },
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => { store.del(DRAFT_KEY); histReset(); recover.remove(); } }, "Descartarlos"),
      h("button", { type: "button", class: "btn", onclick: () => { draft = withDefaults(pending.data); setDirty(); recover.remove(); draw(); } }, "Recuperarlos")));
  // (el historial arranca en lo publicado; al recuperar, el borrador entra como un cambio más)

  undoBtn = h("button", { type: "button", class: "ico ico--top", title: "Deshacer (Ctrl+Z)", "aria-label": "Deshacer", disabled: true, onclick: () => histGo(-1) }, icon("undo", 18));
  redoBtn = h("button", { type: "button", class: "ico ico--top", title: "Rehacer (Ctrl+Shift+Z)", "aria-label": "Rehacer", disabled: true, onclick: () => histGo(1) }, icon("redo", 18));
  errBar = h("div", { class: "errbar", role: "status", "aria-live": "polite", hidden: true });
  topEl = h("header", { class: "top" }, h("div", { class: "busybar", "aria-hidden": "true" }), statusEl, h("span", { class: "top__undo" }, undoBtn, redoBtn), h("a", { class: "link", href: "/", target: "_blank", rel: "noopener" }, "Ver la web", icon("external", 16)), discardBtn, saveBtn);
  sideEl = h("aside", { class: "side" }, h("div", { class: "livery", "aria-hidden": "true" }),
    h("div", { class: "side__bar" }, brand(),
      h("button", { type: "button", class: "side__toggle", "aria-label": "Abrir el menú", onclick: () => sideEl.classList.toggle("is-open") }, icon("menu", 22))),
    h("div", { class: "side__body" },
      h("button", { type: "button", class: "side__search", onclick: palette }, icon("search", 17), h("span", {}, "Ir a…"), h("kbd", {}, "Ctrl K")),
      navEl,
      h("div", { class: "side__foot" }, h("small", {}, user.email),
        h("a", { class: "link only-m", href: "/", target: "_blank", rel: "noopener" }, icon("external", 16), "Ver la web"),
        h("button", { type: "button", class: "link", onclick: async () => {
          if (isDirty && !(await confirmBox("Hay cambios sin publicar. Quedan guardados en este navegador para cuando vuelvas a entrar. ¿Salir igual?", "Salir"))) return;
          if (isDirty) stashDraft();
          isDirty = false; await signOut(); await boot();
        } }, icon("logout", 17), "Cerrar sesión"))));
  app.replaceChildren(h("div", { class: "layout" }, sideEl, h("div", { class: "content" }, topEl, errBar, recover || null, main)));
  if (!histRestored) histReset();
  histRestored = false; draw(); paintStatus(); paintUndo(); welcome();
}

// si la base no responde, no quedarse en "Cargando…": mostrar "Reintentar"
const limit = (p, ms = 8000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("La base de datos tardó demasiado en responder.")), ms))]);

async function boot() {
  delete document.body.dataset.retry;
  if (!configured) return setupScreen();
  try {
    const session = await limit(getSession());
    if (!session) return loginScreen();
    user = session.user;
    if (!(await limit(isAdmin(user.id)))) return deniedScreen(user.email);
    const remote = await limit(fetchRemote());
    remoteData = remote?.data ?? null; lastPub = remote?.updated_at ? new Date(remote.updated_at) : null;
    draft = withDefaults(structuredClone(remoteData)); isDirty = false; // copia: editar el borrador no debe tocar lo publicado
    computeBase();
    let pending = null;
    try { pending = JSON.parse(store.get(DRAFT_KEY) || "null"); } catch { pending = null; }
    if (!pending || pending.user !== user.id || JSON.stringify(pending.data) === JSON.stringify(strip(draft))) { if (pending) store.del(DRAFT_KEY); pending = null; }
    // si había un historial guardado de esta misma versión, se recupera (deshacer sigue funcionando tras recargar)
    histRestored = false;
    try {
      const st = JSON.parse(store.get(HIST_KEY) || "null"), cur = pending ? JSON.stringify(pending.data) : snapNow();
      if (st && st.u === user.id && st.b === (lastPub ? +lastPub : 0) && st.hist?.length > 1 && st.hist[st.hi] === cur) { hist = st.hist; hi = st.hi; histRestored = true; }
    } catch { /* sin historial guardado */ }
    shell(pending);
  } catch (e) {
    retryScreen(e.message);
  }
}

// atajos: Ctrl+S publica, Ctrl+K busca
const typing = () => { const a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable); };
addEventListener("keydown", (e) => {
  if (e.key === "?" && !typing() && saveBtn?.isConnected && !document.querySelector(".modal")) { e.preventDefault(); shortcuts(); return; }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "z" && saveBtn?.isConnected && !document.querySelector(".modal") && !e.isComposing) { e.preventDefault(); histGo(e.shiftKey ? 1 : -1); return; } // un solo deshacer para todo, también dentro de los campos
  if (k === "s") {
    e.preventDefault();
    if (saveBtn?.isConnected && !saveBtn.disabled && !document.querySelector(".modal")) publish();
  } else if (k === "k" && saveBtn?.isConnected && !document.querySelector(".modal")) { e.preventDefault(); palette(); }
});
addEventListener("online", () => { if (document.body.dataset.retry) boot(); });
addEventListener("beforeunload", (e) => { if (isDirty) { stashDraft(); e.preventDefault(); e.returnValue = ""; } });
boot();
