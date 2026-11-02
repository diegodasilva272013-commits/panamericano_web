import { configured, getSession, signIn, signOut, isAdmin, fetchRemote, withDefaults, saveContent, listHistory, fetchStamp } from "./api.js";
import { h, toast, confirmBox, icon, plainErr, hooks, undoToast } from "./ui.js";
import { videoBusy, videoHasWork, videoProgress, resetVideo } from "./hero-video.js";
import { SECTIONS, KEY2SEC, validate, strip, fmtDate, fmtShort, nextDepartures, commitPendingEdit, hasPendingEdit, forgetPendingEdit, changedLabels } from "./sections.js";

const app = document.getElementById("app");

// localStorage puede no estar (ventana privada): todo lo que dependa de él es un extra, nunca un requisito
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};
// en Mac el atajo es ⌘ (el panel acepta los dos)
const MOD = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "") ? "⌘" : "Ctrl";
const DRAFT_KEY = "pm-admin-draft";
const clearDraft = () => { store.del(DRAFT_KEY); store.del(DRAFT_KEY + "-next"); }; // borra el borrador y lo que se guardó aparte mientras había un aviso abierto
// la base devuelve "…+00:00" y el panel guarda "…Z": son el mismo instante con distinto texto
const same = (a, b) => !!a && !!b && +new Date(a) === +new Date(b);

let user = null, draft = null, remoteData = null, lastPub = null, lastPubRaw = null, netBar, isDirty = false, current = store.get("pm-admin-section") || "resumen";
let saveBtn, discardBtn, statusEl, topEl, sideEl, navEl, goto, redraw, stashTimer, paintTimer, histTimer, baseJson = {};
let bannerOpen = false; // hay un borrador pendiente esperando que elijas "Recuperar" o "Descartar"
let popBound = false, stashedOk = false, stashFailed = false, otherBar, otherSeen = null;
let undoBtn, redoBtn, errBar, showErrBar = false, histRestored = false; // la barra de errores aparece cuando intentás publicar con algo faltante

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
const secIdsBetween = (a, b) => { try { const x = JSON.parse(a), y = JSON.parse(b), s = new Set(); for (const k of Object.keys(KEY2SEC)) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) s.add(KEY2SEC[k]); return [...s]; } catch { return []; } };
const histGo = (d) => {
  clearTimeout(histTimer); histPush(); // lo último que escribiste entra al historial antes de volver
  const j = hi + d; if (j < 0 || j >= hist.length) return;
  const was = hist[hi];
  const ids = secIdsBetween(was, hist[j]);
  if (ids.length && !ids.includes(current)) { current = ids[0]; store.set("pm-admin-section", current); history.replaceState(null, "", "#/" + current); } // si lo deshecho está en otra pantalla, se va ahí
  document.querySelectorAll(".toast").forEach((t) => t.remove()); // los "Deshacer" de los avisos quedan viejos: no deshacer de más
  hi = j; draft = withDefaults(JSON.parse(hist[hi])); isDirty = changedSections().size > 0;
  clearTimeout(stashTimer); if (isDirty) stashDraft(); else clearDraft();
  const fields = () => [...document.querySelectorAll(".main input, .main textarea")];
  const at = fields().indexOf(document.activeElement); // en cuál campo estaba el cursor
  redraw(); paintStatus(); paintUndo(); histSave();
  const lbl = secLabelsBetween(was, hist[hi]);
  if (lbl) toast(`${d < 0 ? "Deshiciste" : "Rehiciste"} el cambio en ${lbl}.`, "ok", 5000, { label: d < 0 ? "Rehacer" : "Deshacer", icon: d < 0 ? "redo" : "undo", run: () => histGo(-d) });
  if (at >= 0) { const el = fields()[at]; if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* campo sin selección */ } } }
};

// los errores de red se explican en llano (nunca "TypeError: Failed to fetch")
const plain = plainErr;
// "hace 5 min" en vez de una fecha larga (pasado el día, la fecha corta)
const ago = (d) => { const m = Math.round((Date.now() - +d) / 60000); return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : "el " + fmtShort(d); };
hooks.undo = () => histGo(-1);
hooks.repaint = () => paintStatus();
hooks.flush = () => { clearTimeout(histTimer); histPush(); };
hooks.pos = () => hi;
const mark = '<svg viewBox="0 0 24 24" width="26" height="26"><rect width="24" height="24" rx="7" fill="#f4b400"/><path d="M2 18c7 1 14-3 20-11v5C16 19 9 22 2 21z" fill="#171200"/><path d="M2 21c7 1 14-3 20-11" stroke="#d8261f" stroke-width="2.2" fill="none"/></svg>';
const brand = () => h("div", { class: "brand", html: mark + "<span>Panamericano</span>" });
const sectionLabel = (id) => SECTIONS.find((s) => s.id === id)?.label || id;

/* qué parte de la web cambió respecto de lo publicado */
// (KEY2SEC, el mapa de qué parte de los datos es qué pantalla, viene de sections.js)
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
    catch (x) { err.textContent = plain(x); btn.disabled = false; btn.textContent = "Entrar"; }
  } },
    h("div", { class: "field" }, h("label", { for: "em" }, "Email"), email),
    h("div", { class: "field" }, h("label", { for: "pw" }, "Contraseña"), pass), err, btn);
  app.replaceChildren(entry([h("h1", {}, "Panel de administración"), h("p", { class: "lead" }, "Ingresá con tu usuario para editar la web."), form, h("p", { class: "hint" }, "¿No podés entrar o te olvidaste la contraseña? Pedile a quien administra la web que te la restablezca.")], false, loginBoard()));
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
  confirmBox(h("div", { class: "help" }, h("h3", {}, "Te damos la bienvenida"), h("p", {}, "Tres cosas para saber:"),
    h("ol", {}, h("li", {}, "Elegí qué querés cambiar en el menú o en el buscador (en la computadora: Ctrl K)."),
      h("li", {}, "Hacé el cambio. Donde hay un cartel negro \"Así se ve en la web\", lo ves al instante."),
      h("li", {}, "Tocá \"Guardar y publicar\". Si te equivocás, tocá la flecha de deshacer de la barra de acciones (o Ctrl+Z)."))), "Empezar", "Saltar");
}

function deniedScreen(email) {
  app.replaceChildren(entry([
    h("h1", {}, "Sin permiso"),
    h("p", { class: "lead" }, `La cuenta ${email} no es administradora de esta web. Pedile a quien la creó que te dé acceso.`),
    h("button", { class: "btn", type: "button", onclick: async () => { await signOut(); await boot(); } }, "Salir"),
  ]));
}

/* ---------- panel ---------- */
const normal = (d) => strip(withDefaults(structuredClone(d ?? {})));
const myChanges = () => { const d = strip(draft); return Object.fromEntries(Object.keys(KEY2SEC).filter((k) => JSON.stringify(d[k]) !== baseJson[k]).map((k) => [k, d[k]])); };
// mientras el aviso "Recuperar" está abierto, lo nuevo se guarda aparte para no pisar el borrador viejo
const stashDraft = () => (user && draft ? store.set(bannerOpen ? DRAFT_KEY + "-next" : DRAFT_KEY, JSON.stringify({ at: Date.now(), user: user.id, base: lastPubRaw, changes: myChanges(), data: strip(draft) })) : false);
const setDirty = () => {
  if (!isDirty) { isDirty = true; paintStatus(); }
  stashedOk = false; clearTimeout(stashTimer); stashTimer = setTimeout(() => { stashedOk = stashDraft(); stashFailed = !stashedOk; paintStatus(); }, 700); // borrador automático en este navegador
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
  const x = errs[0];
  errBar.replaceChildren(h("strong", {}, `Faltan ${errs.length} ${errs.length === 1 ? "dato" : "datos"} para publicar:`),
    h("span", { class: "errbar__list" }, h("button", { type: "button", class: "link", onclick: () => goto(x.sec, x) }, x.msg.replace(/\.$/, ""), icon("arrow", 14)),
      errs.length > 1 ? h("button", { type: "button", class: "link", onclick: () => publish() }, `Ver los ${errs.length}`) : null));
}
function paintStatus() {
  if (!statusEl) return;
  isDirty = changedSections().size > 0; // siempre contra lo publicado: escribir y volver a como estaba no es un cambio
  if (!isDirty && !bannerOpen) { clearTimeout(stashTimer); clearDraft(); }
  const ch = isDirty ? [...changedSections()] : [];
  statusEl.title = ch.map(sectionLabel).join(", ");
  const head = isDirty ? (ch.length > 1 ? `Hay cambios sin publicar en ${ch.length} pantallas` : ch.length ? `Hay cambios sin publicar en ${sectionLabel(ch[0])}` : "Hay cambios sin publicar") : lastPub ? `Publicado ${ago(lastPub)}` : "Todo publicado";
  const sub = videoBusy() ? `Generando el video de la portada… ${Math.floor(videoProgress() * 10) * 10}%` : isDirty ? (stashedOk ? "Cambios guardados en este navegador" : stashFailed ? "No se pudieron guardar en este navegador: publicá cuanto antes" : "Guardando en este navegador…") : hasPendingEdit() ? "Hora sin confirmar" : "Sin cambios pendientes";
  const sig = head + "|" + sub + "|" + isDirty;
  if (statusEl.dataset.sig !== sig) { // solo se toca el DOM si cambió: un lector de pantalla no repite lo mismo
    statusEl.dataset.sig = sig;
    statusEl.replaceChildren(h("span", { class: "state__t" }, head), h("small", { class: "state__saved" + (isDirty && stashFailed && !stashedOk ? " state__saved--bad" : "") + (videoBusy() ? " state__saved--video" : "") }, sub));
  }
  statusEl.className = "state " + (isDirty ? "is-dirty" : "is-ok");
  saveBtn.disabled = !(isDirty || hasPendingEdit());
  saveBtn.title = isDirty ? "Guardar y publicar (Ctrl+S)" : "No hay cambios para publicar";
  discardBtn.hidden = !isDirty;
  navEl?.querySelectorAll("button[data-id]").forEach((b) => b.classList.toggle("has-changes", ch.includes(b.dataset.id)));
  navEl?.querySelector('[data-id="hero"]')?.classList.toggle("is-working", videoBusy());
  document.querySelector(".side__toggle")?.classList.toggle("has-changes", ch.length > 0);
  paintErrBar();
}
const saveLabel = () => saveBtn.replaceChildren(h("span", { class: "lbl-dirty" }, "Guardar y publicar", h("kbd", { class: "kbd-inline" }, MOD + " S")), h("span", { class: "lbl-clean" }, "Sin cambios"));

async function publish() {
  if (!commitPendingEdit()) { toast("Hay una hora a medio escribir que no es válida. Corregila (por ejemplo 14:30) o apretá Esc para cerrarla.", "err", 7000); return; } // una hora a medio escribir se confirma antes de publicar
  const errors = validate(draft);
  if (errors.length) {
    const list = h("ul", { class: "errs" }, errors.map((x) => h("li", {},
      h("span", {}, x.msg),
      h("button", { type: "button", class: "link", onclick: () => { document.querySelector(".modal .btn--ghost")?.click(); goto(x.sec, x); } }, "Ir ahí", icon("arrow", 14)))));
    const first = errors[0]; showErrBar = true; paintErrBar();
    if (await confirmBox(h("div", {}, h("strong", {}, `Antes de publicar, revisá ${errors.length === 1 ? "esto" : "estas " + errors.length + " cosas"}:`), list), "Ir al primer error", "Seguir editando")) goto(first.sec, first);
    return;
  }
  if (changedSections().size >= 2 && !(await confirmBox(`Vas a publicar cambios en ${[...changedSections()].map(sectionLabel).join(", ")}. ¿Seguir?`, "Publicar", "Cancelar"))) return; // cambios en varias pantallas: se revisa antes
  saveBtn.disabled = true; saveBtn.textContent = "Publicando…"; topEl.classList.add("is-busy");
  try {
    let at; let sent = strip(draft); // lo que se manda: si seguís escribiendo mientras tanto, eso queda como cambio sin publicar
    try { at = await saveContent(sent, user.id, lastPubRaw); } // la base solo escribe si nadie publicó desde que cargaste
    catch (e) {
      if (e.code !== "CONFLICT") throw e;
      // lo de la otra persona se conserva y se le suma lo tuyo (si tocaron la misma pantalla, queda lo tuyo)
      const cur = await limit(fetchRemote());
      const theirs = changedLabels(remoteData, cur?.data), mine = [...changedSections()].map(sectionLabel), clash = theirs.filter((l) => mine.includes(l));
      const joinMsg = `Otra persona publicó cambios mientras editabas (${fmtShort(cur.updated_at)}${theirs.length ? ": " + theirs.join(", ") : ""}). Se pueden juntar los dos: queda lo de esa persona y se suma lo tuyo (${mine.join(", ") || "nada"}).${clash.length ? ` En ${clash.join(", ")} cambiaron los dos: queda lo tuyo.` : ""}`;
      if (!(await confirmBox(joinMsg, "Juntar y publicar", "Cancelar", { focusCancel: true }))) { toast("No se publicó nada. Tu borrador sigue acá.", "ok", 8000, { label: "Actualizar y ver lo nuevo", icon: "redo", run: () => { if (isDirty) stashDraft(); isDirty = false; location.reload(); } }); return; }
      const merged = normal(cur.data); const mineNow = strip(draft);
      for (const k of Object.keys(KEY2SEC)) if (JSON.stringify(mineNow[k]) !== baseJson[k]) merged[k] = mineNow[k];
      at = await saveContent(merged, user.id, cur.updated_at); // otra vez condicional: si hubo una tercera persona, avisa
      sent = merged;
      // lo que escribiste mientras se guardaba no se pierde: queda como cambio sin publicar
      const late = strip(draft); const next = { ...merged };
      for (const k of Object.keys(KEY2SEC)) if (JSON.stringify(late[k]) !== JSON.stringify(mineNow[k])) next[k] = late[k];
      draft = withDefaults(structuredClone(next)); histReset(); redraw();
    }
    remoteData = sent; lastPub = new Date(at); lastPubRaw = at; if (otherBar) { otherBar.hidden = true; otherSeen = null; } computeBase(); histSave(); clearDraft(); clearTimeout(stashTimer);
    isDirty = false; paintStatus();
    toast("Publicado. La web ya muestra los cambios.", "ok", 9000, { label: "Volver a la anterior", run: async () => {
      try { const rows = await listHistory(); if (!rows[0]) return toast("No hay una versión anterior guardada."); draft = withDefaults(rows[0].data); setDirty(); histPush(); redraw(); paintStatus(); toast("Cargaste la versión anterior. Tocá Guardar y publicar para que vuelva a verse en la web."); }
      catch (e) { toast(plain(e), "err", 7000); }
    } });
  } catch (e) { const m = plain(e); toast(/^No se pudo/i.test(m) ? m : `No se pudo publicar. ${m}`, "err", 12000, { label: "Reintentar", icon: "redo", run: () => publish() }); saveBtn.disabled = false; }
  finally { saveLabel(); topEl.classList.remove("is-busy"); paintStatus(); }
}

// ayuda propia de cada pantalla
const help = (sec) => confirmBox(h("div", { class: "help" },
  h("h3", {}, `¿Cómo se hace? · ${sec.label}`),
  sec.desc && h("p", {}, sec.desc),
  h("ol", {}, (sec.help || []).map((s) => h("li", {}, s))),
  h("section", {}, h("strong", {}, "Me equivoqué, ¿puedo volver atrás?"),
    h("p", {}, "Sí. Tocá \"Deshacer\" (o Ctrl+Z) las veces que quieras. \"Descartar cambios\" deja todo como está publicado, y también se puede deshacer. Si ya publicaste, en \"Versiones anteriores\" cargás una de las últimas 20 publicaciones."))),
  "Entendido", false);

const shortcuts = () => confirmBox(h("div", { class: "help" },
  h("h3", {}, "Atajos del teclado"),
  h("dl", { class: "keys" },
    ...[[MOD + " + S", "Guardar y publicar"], [MOD + " + K", "Buscar una pantalla, un servicio o una ayuda"], [MOD + " + Z", "Deshacer el último cambio, también mientras escribís"], [MOD + " + Shift + Z", "Rehacer"],
      ["Enter", "Confirmar una hora"], ["Esc", "Cerrar la ventanita o el aviso"], ["?", "Ver esta lista"]].flatMap(([k, d]) => [h("dt", {}, h("kbd", {}, k)), h("dd", {}, d)]))),
  "Entendido", false);

// buscador de pantallas, servicios y ayudas (Ctrl+K)
function palette() {
  if (document.querySelector(".palette")) return;
  const back = document.activeElement; // para devolver el foco al cerrar
  const acts = [
    ...SECTIONS.map((s) => ({ label: s.label, sub: s.desc, run: () => goto(s.id) })),
    { label: "Cambiar un horario", sub: "Ir a los horarios de salida", run: () => goto("horarios") },
    ...draft.routes.map((r, i) => ({ label: `${r.from || "Origen"} → ${r.to || "Destino"}`, sub: `Horarios${r.service ? " · " + r.service : ""}`, run: () => goto("horarios", { item: i }) })),
    ...draft.destinations.map((d, i) => ({ label: d.name || "Destino", sub: "Destinos", run: () => goto("destinos", { item: i }) })),
    { label: "Guardar y publicar", sub: "Ctrl+S", run: () => (isDirty ? publish() : toast("No hay cambios para publicar.")) },
    { label: "Deshacer", sub: "Ctrl+Z", run: () => histGo(-1) },
    { label: "Ver la web", sub: "Se abre en otra pestaña", run: () => window.open("/", "_blank", "noopener") },
    ...SECTIONS.map((s) => ({ label: `Cómo se hace: ${s.label}`, sub: "Ayuda", run: () => help(s) })),
    { label: "Ver atajos del teclado", sub: "?", run: () => shortcuts() },
    { label: "Ver la bienvenida", sub: "Los tres pasos para empezar", run: () => welcome(true) },
  ];
  const KW = { contacto: "teléfono telefono whatsapp boletería boleteria dirección pregunta frecuentes faq", galeria: "foto fotos imagen galería a bordo servicios", hero: "video titular botones portada inicio", textos: "menú titulo título frase texto", horarios: "salida hora horas servicio tablero", destinos: "lugar lugares ciudad pueblo tarjeta", historial: "versión version volver atrás" };
  acts.forEach((a) => { const s = SECTIONS.find((x) => x.label === a.label); if (s) a.kw = KW[s.id] || ""; });
  acts.forEach((a) => { a.g = a.sub === "Ayuda" ? "Ayuda" : a.sub === "Destinos" ? "Destinos" : a.label.includes("→") ? "Servicios" : SECTIONS.some((s) => s.label === a.label) ? "Pantallas" : "Acciones"; });
  let sel = 0, shown = acts.filter((a) => a.g === "Pantallas" || a.g === "Acciones"); // al abrir, solo lo principal; al escribir, todo
  const input = h("input", { type: "text", placeholder: "Escribí a dónde querés ir…", "aria-label": "Buscar pantalla o acción", role: "combobox", "aria-expanded": "true", "aria-controls": "pal-list", "aria-autocomplete": "list" });
  const ul = h("ul", { class: "palette__list", role: "listbox", id: "pal-list" });
  const close = () => { ov.remove(); document.removeEventListener("keydown", key, true); back?.focus?.(); };
  const run = (a) => { close(); a.run(); };
  const drawRaw = () => { input.setAttribute("aria-activedescendant", shown.length ? `pal-${sel}` : ""); input.setAttribute("aria-expanded", String(shown.length > 0));
    if (!shown.length) { ul.replaceChildren(h("li", { class: "palette__none", role: "status" }, `Nada coincide con "${input.value}". Probá con otra palabra.`)); return; }
    ul.replaceChildren(...shown.map((a, i) => h("li", { id: `pal-${i}`, role: "option", "aria-selected": String(i === sel), class: i === sel ? "is-sel" : "", onclick: () => run(a) }, h("strong", {}, a.label), a.sub && h("small", {}, a.sub)))); };
  const draw = () => {
    drawRaw(); let prev = null;
    [...ul.querySelectorAll('li[role="option"]')].forEach((li, i) => { const g = shown[i]?.g; if (g && g !== prev) { ul.insertBefore(h("li", { class: "palette__h", role: "presentation" }, g), li); prev = g; } });
  };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Tab") e.preventDefault(); // el foco queda en el buscador
    else if (e.key === "Enter" && shown[sel]) { e.preventDefault(); run(shown[sel]); }
  };
  const norm = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  input.addEventListener("input", () => { const ws = norm(input.value).split(/\s+/).filter(Boolean); shown = acts.filter((a) => { const t = norm(a.label + " " + (a.sub || "") + " " + (a.kw || "")); return ws.every((w) => t.includes(w)); }); sel = 0; draw(); });
  const ov = h("div", { class: "modal palette", onclick: (e) => { if (e.target === ov) close(); } }, h("div", { class: "modal__box palette__box", role: "dialog", "aria-modal": "true", "aria-label": "Buscar" }, input, ul));
  document.addEventListener("keydown", key, true); document.body.append(ov); draw(); input.focus();
}

function shell(pending) {
  const main = h("main", { class: "main", id: "main", tabindex: "-1" });
  navEl = h("nav", { class: "side__nav", "aria-label": "Secciones" });
  const ctx = {
    dirty: setDirty,
    rerender: () => draw(),
    goto: (...a) => goto(...a),
    lastPublished: () => lastPub,
    published: () => remoteData,
    replaceDraft: (data) => { draft = withDefaults(data); setDirty(); draw(); },
  };
  const draw = () => {
    forgetPendingEdit(); // la ventanita de la pantalla anterior ya no existe
    const sec = SECTIONS.find((s) => s.id === current) || SECTIONS[0];
    navEl.querySelectorAll("button[data-id]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === sec.id)));
    document.title = `${sec.label} · Panel de Panamericano`;
    const y = scrollY;
    main.replaceChildren(
      h("div", { class: "head" },
        h("div", {}, h("h1", { class: "title", tabindex: "-1" }, sec.label), sec.desc && h("p", { class: "title__desc" }, sec.desc)),
        h("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: () => help(sec) }, icon("preguntas", 17), "¿Cómo se hace?")),
      sec.render({ ...ctx, draft }));
    scrollTo(0, y);
  };

  redraw = draw;
  { const hid = location.hash.replace(/^#\//, ""); if (SECTIONS.some((s) => s.id === hid)) current = hid; } // un enlace #/horarios abre esa pantalla
  history.replaceState(null, "", "#/" + current); // la pantalla de entrada también queda en el historial: el primer "Atrás" funciona
  if (!popBound) { popBound = true; addEventListener("popstate", () => { const hid = location.hash.replace(/^#\//, "") || "resumen"; if (SECTIONS.some((s) => s.id === hid) && hid !== current) { current = hid; store.set("pm-admin-section", hid); redraw?.(); } }); }
  // lleva al cliente al campo exacto con el problema, lo marca y lo resalta un momento
  const focusTarget = ({ item, list, field, msg }) => {
    let scope = main;
    if (item != null) { const box = list ? main.querySelector(`[data-list="${list}"]`) : main.querySelector(".list"); scope = box?.querySelectorAll(":scope > .item")[item] || main; }
    let target = scope;
    if (field) {
      const lab = [...scope.querySelectorAll("label")].find((l) => l.textContent.trim().toLowerCase().startsWith(field.toLowerCase()));
      const box = lab?.closest(".field");
      if (box) {
        target = box; for (let d = box.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true; box.querySelectorAll("details").forEach((d) => { d.open = true; });
        box.classList.add("is-bad");
        let e = box.querySelector(".err"); if (!e) { e = h("small", { class: "err", role: "alert" }); box.append(e); }
        const m = (msg || "").split(": ").slice(1).join(": ") || msg || "Revisá este dato."; e.textContent = m.charAt(0).toUpperCase() + m.slice(1);
        const inp = box.querySelector("input,textarea,select"); inp?.focus({ preventScroll: true }); inp?.setAttribute("aria-invalid", "true");
        box.addEventListener("input", () => { box.classList.remove("is-bad"); e.textContent = ""; }, { once: true });
      }
    }
    target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target.classList.add("is-flash"); setTimeout(() => target.classList.remove("is-flash"), 2400);
  };
  goto = (id, t) => {
    current = id; store.set("pm-admin-section", id); if (location.hash !== `#/${id}`) history.pushState(null, "", `#/${id}`); draw(); sideEl?.classList.remove("is-open"); sideEl?.querySelector(".side__toggle")?.setAttribute("aria-expanded", "false");
    if (t && (t.item != null || t.field)) requestAnimationFrame(() => focusTarget(t)); else { scrollTo(0, 0); main.querySelector(".title")?.focus({ preventScroll: true }); } // quien usa lector de pantalla oye la pantalla nueva
  };

  let last = "";
  SECTIONS.forEach((s) => {
    if (s.group !== last) { last = s.group; if (s.group !== "Inicio") navEl.append(h("p", { class: "side__group" }, s.group)); }
    navEl.append(h("button", { type: "button", "data-id": s.id, onclick: () => goto(s.id) }, icon(s.id), h("span", {}, s.label)));
  });

  statusEl = h("span", { class: "state", role: "status" });
  saveBtn = h("button", { class: "btn btn--primary", type: "button", onclick: publish }); saveLabel();
  discardBtn = h("button", { class: "btn btn--ghost btn--discard", type: "button", hidden: true, title: "Descartar los cambios sin publicar", "aria-label": "Descartar cambios", onclick: () => {
    // sin pregunta: se descarta y queda a mano "Deshacer"
    undoToast("Descartaste los cambios sin publicar.", () => {
      draft = withDefaults(structuredClone(remoteData)); isDirty = false; clearTimeout(stashTimer); clearDraft(); clearTimeout(histTimer); histPush(); paintStatus(); draw();
    });
  } }, icon("trash", 17), h("span", { class: "lbl-txt" }, "Descartar cambios"));

  // borrador de una sesión anterior que no se llegó a publicar
  bannerOpen = !!pending;
  const recover = pending && h("div", { class: "recover", role: "alert" },
    h("span", {}, pending.stale ? `Tenés un borrador del ${fmtDate(pending.at)}, pero otra persona publicó después. Si lo recuperás, se suma a lo nuevo: en lo que cambiaste vos queda lo tuyo.` : `Tenés cambios sin publicar del ${fmtDate(pending.at)}, guardados en este navegador.`),
    h("span", { class: "recover__act" },
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => { bannerOpen = false; store.del(DRAFT_KEY); const nx = store.get(DRAFT_KEY + "-next"); if (nx) { store.set(DRAFT_KEY, nx); store.del(DRAFT_KEY + "-next"); } histReset(); recover.remove(); } }, "Descartarlos"),
      h("button", { type: "button", class: "btn", onclick: () => { bannerOpen = false; store.del(DRAFT_KEY + "-next"); hooks.flush?.(); { const over = pending.changes && Object.keys(pending.changes).length ? pending.changes : null; draft = withDefaults(over ? { ...strip(draft), ...over } : pending.data); } setDirty(); recover.remove(); draw(); } }, pending.stale ? "Recuperar igual" : "Recuperarlos")));
  // (el historial arranca en lo publicado; al recuperar, el borrador entra como un cambio más)

  undoBtn = h("button", { type: "button", class: "ico ico--top", title: "Deshacer (Ctrl+Z)", "aria-label": "Deshacer", disabled: true, onclick: () => histGo(-1) }, icon("undo", 18));
  redoBtn = h("button", { type: "button", class: "ico ico--top", title: "Rehacer (Ctrl+Shift+Z)", "aria-label": "Rehacer", disabled: true, onclick: () => histGo(1) }, icon("redo", 18));
  errBar = h("div", { class: "errbar", role: "status", "aria-live": "polite", hidden: true });
  otherBar = h("div", { class: "netbar netbar--other", role: "status", hidden: true });
  netBar = h("div", { class: "netbar", role: "status", hidden: navigator.onLine !== false }, "Sin conexión. Tus cambios se guardan en este navegador y se publican cuando vuelva internet y toques Guardar.");
  topEl = h("header", { class: "top" }, h("div", { class: "busybar", "aria-hidden": "true" }), statusEl, h("span", { class: "top__undo" }, undoBtn, redoBtn), discardBtn, saveBtn);
  sideEl = h("aside", { class: "side" }, h("div", { class: "livery", "aria-hidden": "true" }),
    h("div", { class: "side__bar" }, brand(),
      h("button", { type: "button", class: "side__toggle", "aria-label": "Abrir el menú", "aria-expanded": "false", onclick: (e) => { const o = sideEl.classList.toggle("is-open"); e.currentTarget.setAttribute("aria-expanded", String(o)); } }, icon("menu", 22), h("span", { class: "side__toggle__t" }, "Menú"))),
    h("div", { class: "side__body" },
      h("button", { type: "button", class: "side__search", title: `Buscar una pantalla, un servicio o una ayuda (${MOD}+K)`, onclick: palette }, icon("search", 17), h("span", {}, "Ir a…"), h("kbd", {}, MOD + " K")),
      navEl,
      h("div", { class: "side__foot" }, h("small", {}, user.email),
        h("a", { class: "link", href: "/", target: "_blank", rel: "noopener" }, icon("external", 16), "Ver la web"),
        h("button", { type: "button", class: "link", onclick: async () => {
          if ((isDirty || videoHasWork()) && !(await confirmBox(videoBusy() ? "Se está generando el video de la portada. Si salís ahora, se corta y hay que empezar de nuevo. ¿Salir igual?" : isDirty ? "Hay cambios sin publicar. Quedan guardados en este navegador para cuando vuelvas a entrar. ¿Salir igual?" : "Tenés videos cargados en el generador de la portada. Si salís, hay que cargarlos de nuevo. ¿Salir igual?", "Salir", "Cancelar", { focusCancel: true }))) return;
          resetVideo();
          if (isDirty) stashDraft();
          isDirty = false; await signOut(); await boot();
        } }, icon("logout", 17), "Cerrar sesión"))));
  app.replaceChildren(h("div", { class: "layout" }, h("a", { class: "skip", href: "#main" }, "Saltar al contenido"), sideEl, h("div", { class: "content" }, topEl, netBar, otherBar, errBar, recover || null, main)));
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
    remoteData = remote?.data ?? null; lastPubRaw = remote?.updated_at || null; lastPub = lastPubRaw ? new Date(lastPubRaw) : null;
    draft = withDefaults(structuredClone(remoteData)); isDirty = false; // copia: editar el borrador no debe tocar lo publicado
    computeBase();
    let pending = null;
    // si el aviso "Recuperar" quedó sin resolver y después se editó, lo nuevo estaba guardado aparte: se rescata
    if (!store.get(DRAFT_KEY) && store.get(DRAFT_KEY + "-next")) { store.set(DRAFT_KEY, store.get(DRAFT_KEY + "-next")); store.del(DRAFT_KEY + "-next"); }
    try { pending = JSON.parse(store.get(DRAFT_KEY) || "null"); } catch { pending = null; }
    if (!pending || pending.user !== user.id || JSON.stringify(pending.data) === JSON.stringify(strip(draft))) { if (pending) clearDraft(); pending = null; }
    if (pending) pending.stale = !!(pending.base && lastPubRaw && !same(pending.base, lastPubRaw)); // otra persona publicó después de ese borrador
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
  if (e.key === "Escape" && !document.querySelector(".modal, .tb__pop")) document.querySelectorAll(".toast").forEach((t) => t.remove());
  if (e.key === "?" && !typing() && saveBtn?.isConnected && !document.querySelector(".modal")) { e.preventDefault(); shortcuts(); return; }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "z" && saveBtn?.isConnected && !document.querySelector(".modal") && !e.isComposing && !document.activeElement?.closest(".svc__find,.tb__pop,.tb__add,.tb__tool,.bulk__row,.route__add,.login,select")) { e.preventDefault(); histGo(e.shiftKey ? 1 : -1); return; } // un solo deshacer para todo, también dentro de los campos
  if (k === "y" && saveBtn?.isConnected && !document.querySelector(".modal") && !document.activeElement?.closest(".svc__find,.tb__pop,.tb__add,.tb__tool,.bulk__row,.route__add,.login,select")) { e.preventDefault(); histGo(1); return; }
  if (k === "s") {
    e.preventDefault();
    if (saveBtn?.isConnected && !saveBtn.disabled && !document.querySelector(".modal")) publish();
  } else if (k === "k" && saveBtn?.isConnected && !document.querySelector(".modal")) { e.preventDefault(); palette(); }
});
setInterval(() => { if (statusEl?.isConnected && !isDirty) paintStatus(); }, 30000);
// si otra persona publica mientras tenés el panel abierto, se avisa (se consulta cada minuto)
const checkOther = async () => {
  if (!statusEl?.isConnected || !lastPubRaw || navigator.onLine === false || document.hidden) return;
  try {
    const stamp = await limit(fetchStamp());
    if (stamp && !same(stamp, lastPubRaw) && !same(stamp, otherSeen)) {
      const cur = await limit(fetchRemote()); if (!cur) return;
      otherSeen = cur.updated_at; const labs = changedLabels(remoteData, cur.data);
      otherBar.hidden = false;
      otherBar.replaceChildren(h("span", {}, `Otra persona publicó cambios (${fmtShort(cur.updated_at)}${labs.length ? ": " + labs.join(", ") : ""}). ${isDirty ? "Tus cambios siguen acá y se guardan." : ""}`),
        h("button", { type: "button", class: "link", onclick: () => { if (isDirty) stashDraft(); isDirty = false; location.reload(); } }, "Actualizar y ver lo nuevo"));
    }
  } catch { /* sin conexión: se vuelve a intentar */ }
};
setInterval(checkOther, 60000);
addEventListener("visibilitychange", () => { if (!document.hidden) checkOther(); });
addEventListener("online", () => { if (netBar) netBar.hidden = true; if (document.body.dataset.retry) boot(); });
addEventListener("offline", () => { if (netBar) netBar.hidden = false; });
addEventListener("beforeunload", (e) => { if (isDirty || videoHasWork()) { if (isDirty) stashDraft(); e.preventDefault(); e.returnValue = ""; } });
boot();
