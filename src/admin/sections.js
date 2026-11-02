import { h, field, check, group, groupAside, listEditor, imageField, confirmBox, toast, icon, undoToast, hooks, plainErr } from "./ui.js";
import { listHistory, withDefaults } from "./api.js";
import { heroVideoTool } from "./hero-video.js";

// los datos viejos pueden no tener todas las claves: se comparan ya completados con los valores por defecto
const normData = (d) => strip(withDefaults(structuredClone(d ?? {})));
export const KEY2SEC = { hero: "hero", texts: "textos", site: "contacto", routes: "horarios", destinations: "destinos", gallery: "galeria", boardImage: "galeria", services: "galeria", boleterias: "contacto", faq: "contacto" };
const changedIds = (a, b) => { const s = new Set(); for (const k of Object.keys(KEY2SEC)) if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) s.add(KEY2SEC[k]); return [...s]; };
const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const set = (o, path, v) => { const ks = path.split("."); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

/* ---------- horarios: "06:15, 09:00, 14:15 (mar · jue)" <-> times + days ---------- */
export function timesToText(r) {
  return (r.times || []).map((t) => (r.days?.[t] ? `${t} (${r.days[t]})` : t)).join(", ");
}
export function parseTimes(text) {
  const times = [], days = {}, bad = [];
  for (const raw of String(text).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = raw.match(/^(\d{1,2})[:.](\d{2})\s*(?:\(([^)]*)\))?$/);
    if (!m || +m[1] > 23 || +m[2] > 59) { bad.push(raw); continue; }
    const t = `${m[1].padStart(2, "0")}:${m[2]}`;
    if (!times.includes(t)) times.push(t);
    if (m[3]?.trim()) days[t] = m[3].trim();
  }
  return { times, days: Object.keys(days).length ? days : undefined, bad };
}
const stopsToText = (r) => (r.stops || []).join(", ");
const parseStops = (s) => String(s).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);

export const fmtShort = (d) => new Date(d).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "");
// 5493884640178 -> +54 9 388 464-0178 (como lo ve el pasajero)
const fmtWa = (n) => { const d = String(n || "").replace(/\D/g, ""); return /^549\d{10}$/.test(d) ? `+54 9 ${d.slice(3, 6)} ${d.slice(6, 9)}-${d.slice(9)}` : d ? "+" + d : "…"; };
function destPreview(items) {
  const el = h("div", { class: "tpv", "aria-label": "Así se ve en la web" });
  const update = () => el.replaceChildren(h("span", { class: "tpv__tag" }, "Así se ve en la web"),
    ...items.map((d) => h("div", { class: "tpv__row tpv__dest" },
      d.image ? h("img", { src: d.image, alt: "", loading: "lazy" }) : h("span", { class: "tpv__ph" }),
      h("span", { class: "tpv__dtxt" }, h("strong", {}, d.name || "…"), d.tag ? h("em", {}, d.tag) : null))));
  update();
  return { el, update };
}

/* ---------- vistas previas en vivo (van en la columna izquierda, pegadas mientras se escribe) ---------- */
function textPreview(draft, fields) {
  const el = h("div", { class: "tpv", "aria-label": "Así se ve en la web" });
  const update = () => {
    const vals = fields.map(([p, l]) => ({ l, v: get(draft, p) || "" }));
    const titles = vals.filter((x) => /^Título/.test(x.l));
    el.replaceChildren(h("span", { class: "tpv__tag" }, "Así se ve en la web"),
      ...titles.map((x, i) => h("p", { class: "tpv__t" + (/gris/i.test(x.l) ? " is-gray" : i ? " is-2" : "") }, x.v || "…")),
      ...vals.filter((x) => !/^Título/.test(x.l)).map((x) => (/botón/i.test(x.l) ? h("span", { class: "tpv__btn" }, x.v || "…") : h("p", { class: "tpv__p" }, x.v || "…"))));
  };
  update();
  return { el, update };
}
function contactPreview(site) {
  const el = h("div", { class: "tpv", "aria-label": "Así se ve en la web" });
  const update = () => el.replaceChildren(h("span", { class: "tpv__tag" }, "Así se ve en la web"),
    h("p", { class: "tpv__t" }, site.phoneLabel || "…"), h("span", { class: "tpv__btn" }, "WhatsApp " + fmtWa(site.whatsapp)),
    h("p", { class: "tpv__p" }, site.address || "…"), h("p", { class: "tpv__p" }, site.footerNote || ""));
  update();
  return { el, update };
}
function departuresBoard(routes) {
  const el = h("div", { class: "board board--aside", "aria-label": "Así se ve en la web" });
  const update = () => {
    const nd = nextDepartures(routes, 4);
    el.replaceChildren(h("span", { class: "tpv__tag tpv__tag--dark" }, nd.tomorrow ? "Así se ve en la web · mañana" : "Así se ve en la web · ahora"),
      ...(nd.list.length ? nd.list.map((x, i) => h("div", { class: "board__line" + (i === 0 ? " is-next" : "") },
        h("span", { class: "board__time" }, x.t, x.r.days?.[x.t] ? "*" : ""),
        h("span", { class: "board__dest" }, h("strong", {}, `${x.r.from || "Origen"} → ${x.r.to || "Destino"}`), x.r.service && h("small", {}, x.r.service))))
        : [h("p", { class: "empty" }, "Todavía no hay horarios.")]));
  };
  update();
  return { el, update };
}

/* ---------- textos: esquema de campos ---------- */
const TEXT_GROUPS = [
  ["Menú superior", "Los nombres de los enlaces de arriba.", [["texts.nav.horarios", "Horarios"], ["texts.nav.destinos", "Destinos"], ["texts.nav.reservar", "Reservar"], ["texts.nav.antes", "Antes de viajar"], ["texts.nav.contacto", "Contacto"]]],
  ["Bloque \"Conectamos caminos\"", "El título grande que aparece después de la portada, con el párrafo y el botón.", [["texts.grid.a", "Título, primera línea (blanca)"], ["texts.grid.b", "Título, segunda línea (amarilla)"], ["texts.grid.text", "Párrafo", true], ["texts.grid.button", "Texto del botón"]]],
  ["Horarios", "Título y rótulos del tablero de salidas.", [["texts.horarios.a", "Título, primera línea"], ["texts.horarios.b", "Título, segunda línea (gris)"], ["texts.horarios.all", "Subtítulo de \"todas las salidas\""], ["texts.horarios.clock", "Texto junto al reloj"]]],
  ["Destinos", "", [["texts.destinos.a", "Título, primera línea"], ["texts.destinos.b", "Título, segunda línea (gris)"]]],
  ["El viaje (la animación del bus)", "La animación del bus por la Ruta 9.", [["texts.viaje.hint", "Invitación a scrollear"], ["texts.viaje.cta", "Botón del final"]]],
  ["Reservar un pasaje", "", [["texts.reservar.a", "Título, primera línea"], ["texts.reservar.b", "Título, segunda línea (gris)"], ["texts.reservar.legal", "Aviso legal (debajo del formulario)", true]]],
  ["A bordo", "", [["texts.abordo.a", "Título, primera línea"], ["texts.abordo.b", "Título, segunda línea (gris)"]]],
  ["Antes de viajar", "", [["texts.antes.a", "Título, primera línea"], ["texts.antes.b", "Título, segunda línea (gris)"]]],
  ["Contacto", "", [["texts.contacto.a", "Título, primera línea"], ["texts.contacto.b", "Título, segunda línea (gris)"], ["texts.contacto.call", "Botón de llamar"], ["texts.contacto.wa", "Botón de WhatsApp"], ["texts.contacto.central", "Rótulo del teléfono central"]]],
];

let foldOpen = 0; // el grupo abierto de Textos sobrevive a deshacer y a recargar la pantalla
function textsSection({ draft, dirty }) {
  const wrap = h("div", { class: "stack" });
  TEXT_GROUPS.forEach(([title, desc, fields], i) => {
    const pv = textPreview(draft, fields);
    const grid = h("div", { class: "grid2" }, fields.map(([path, label, long]) =>
      field({ label, long, rows: 3, value: get(draft, path), onInput: (v) => { set(draft, path, v); dirty(); pv.update(); } })));
    // un acordeón: se abre una parte de la web por vez (no hay que recorrer ~30 campos seguidos)
    wrap.append(h("details", { class: "fold", name: "textos", open: i === foldOpen, ontoggle: (e) => { if (e.target.open) foldOpen = i; } },
      h("summary", {}, h("span", { class: "fold__t" }, h("h3", {}, title), desc ? h("small", {}, desc) : null), h("span", { class: "fold__n" }, `${fields.length} campos`)),
      h("div", { class: "fold__body" }, title === "Menú superior" ? h("div", {}) : pv.el, grid)));
  });
  wrap.append(group("Frases cortas bajo el título", "Las frases cortas que aparecen debajo del bloque \"Conectamos caminos\" (por ejemplo \"Todos los días\").",
    listEditor({ id: "facts", items: draft.texts.facts, onChange: dirty, addLabel: "Agregar frase", make: () => "", max: 6, title: (_, i) => `Frase ${i + 1}`,
      render: (it, i) => field({ label: "Texto", value: it, onInput: (v) => { draft.texts.facts[i] = v; dirty(); } }) })));
  return wrap;
}

/* ---------- a dónde lleva un botón: se elige, no se escribe ---------- */
const LINKS = [["#horarios", "Horarios"], ["#destinos", "Destinos"], ["#reservar", "Reservar un pasaje"], ["#antes", "Antes de viajar"], ["#contacto", "Contacto"]];
function linkPicker(c, draft, dirty, after) {
  const kind = () => { const v = c.href || ""; return LINKS.some(([x]) => x === v) ? v : /^tel:/.test(v) ? "tel" : /wa\.me\//.test(v) ? "wa" : "web"; };
  const sel = h("select", { "aria-label": "A dónde lleva el botón" },
    ...LINKS.map(([v, l]) => h("option", { value: v }, l)),
    h("option", { value: "wa" }, "El WhatsApp de la empresa"), h("option", { value: "tel" }, "Llamar por teléfono"), h("option", { value: "web" }, "Otra página web"));
  sel.value = kind();
  const extra = h("div", { class: "linkx" });
  const drawExtra = () => {
    const k = sel.value; extra.replaceChildren();
    if (k === "web") extra.append(field({ label: "Dirección de la página", help: "La dirección completa de la página a la que lleva el botón, empezando con https://.", value: c.href, mono: true, hint: "Completa, por ejemplo https://www.ejemplo.com", validate: (v) => (/^https?:\/\/\S+\.\S+/.test(v.trim()) ? "" : "Escribila completa, empezando con https://"), onInput: (v) => { c.href = v.trim(); dirty(); } }));
    if (k === "tel") extra.append(field({ label: "Teléfono", help: "El número al que llama el botón cuando alguien lo toca desde el celular.", value: String(c.href || "").replace(/^tel:/, ""), mono: true, hint: "Con código de país, por ejemplo +543884254331", validate: (v) => (v.replace(/\D/g, "").length >= 8 ? "" : "Escribí el teléfono completo."), onInput: (v) => { c.href = "tel:" + v.replace(/[^\d+]/g, ""); dirty(); } }));
  };
  sel.addEventListener("change", () => {
    const k = sel.value;
    if (LINKS.some(([x]) => x === k)) { c.href = k; c.external = false; }
    else if (k === "wa") { c.href = `https://wa.me/${draft.site.whatsapp}`; c.external = true; }
    else if (k === "tel") { if (!/^tel:/.test(c.href)) c.href = `tel:${draft.site.phoneTel || ""}`; c.external = false; }
    else { if (!/^https?:/.test(c.href)) c.href = "https://"; c.external = true; }
    dirty(); drawExtra(); after?.();
  });
  drawExtra();
  return h("div", { class: "field" }, h("label", {}, "A dónde lleva el botón"), sel, extra);
}

/* ---------- más vistas previas: la cosa real, no un formulario ---------- */
function heroPreview(hero) {
  const el = h("div", { class: "tpv tpv--hero", "aria-label": "Así se ve en la web" });
  const update = () => el.replaceChildren(h("span", { class: "tpv__tag" }, "Así se ve en la web"),
    h("p", { class: "tpv__t" }, hero.headline || "…"), h("p", { class: "tpv__p" }, hero.subheadline || ""),
    h("div", { class: "tpv__btns" }, ...(hero.ctas || []).map((c) => h("span", { class: "tpv__btn" + (c.primary ? "" : " is-ghost") }, c.label || "…"))),
    hero.hint ? h("p", { class: "tpv__p tpv__hint" }, hero.hint) : null);
  update();
  return { el, update };
}
function galleryPreview(items) {
  const el = h("div", { class: "tpv", "aria-label": "Así se ve en la web" });
  const update = () => el.replaceChildren(h("span", { class: "tpv__tag" }, `La galería · ${items.length} fotos`),
    h("div", { class: "gp" }, ...items.map((g) => h("div", { class: "gp__c" }, g.src ? h("img", { src: g.src, alt: "", loading: "lazy" }) : h("span", {}, "Sin foto"), g.caption ? h("small", {}, g.caption) : null))));
  update();
  return { el, update };
}

/* ---------- hero (textos) ---------- */
function heroSection(ctx) {
  const { draft, dirty: baseDirty } = ctx; const hero = draft.hero;
  const hpv = heroPreview(hero);
  const dirty = () => { baseDirty(); hpv.update(); };
  return h("div", { class: "stack" },
    groupAside("Titular de entrada", "Lo primero que se ve al abrir la web.", hpv.el, h("div", { class: "grid2" },
      field({ label: "Titular", value: hero.headline, validate: (v) => (v.trim() ? "" : "Falta el titular. Es la frase grande de la portada."), onInput: (v) => { hero.headline = v; dirty(); } }),
      field({ label: "Frase debajo del titular", long: true, rows: 2, value: hero.subheadline, onInput: (v) => { hero.subheadline = v; dirty(); } }),
      field({ label: "Invitación a deslizar", value: hero.hint, onInput: (v) => { hero.hint = v; dirty(); } }))),
    group("Botones de la portada", "Los botones que van debajo del titular. Elegí qué dice cada uno y a dónde lleva.",
      listEditor({ id: "ctas", items: hero.ctas, onChange: dirty, addLabel: "Agregar botón", max: 3, min: 1, make: () => ({ label: "Nuevo botón", href: "#horarios" }), title: (c) => c.label || "Botón",
        render: (c) => {
          const ext = check({ label: "Abre en otra pestaña", value: c.external, onChange: (v) => { c.external = v; dirty(); } });
          return h("div", {},
            h("div", { class: "grid2" },
              field({ label: "Texto del botón", value: c.label, onInput: (v) => { c.label = v; dirty(); } }),
              linkPicker(c, draft, dirty, () => { const i = ext.querySelector("input"); if (i) i.checked = !!c.external; })),
            h("div", { class: "checks" },
              check({ label: "Botón principal (amarillo)", value: c.primary, onChange: (v) => { c.primary = v; dirty(); } }), ext));
        } })),
    group("Textos de cada paso del viaje", hero.frames ? "Cada paso corresponde a uno de los videos que se subieron. Para agregar o quitar pasos, subí el video de nuevo (abajo)." : "Cada paso corresponde a uno de los 5 videos originales. Para cambiar la cantidad de pasos, subí un video nuevo (abajo).",
      h("div", { class: "list", "data-list": "etapas" }, hero.etapas.map((e, i) => h("div", { class: "item" },
        h("div", { class: "item__bar" }, h("strong", {}, `Paso ${i + 1}`)),
        h("div", { class: "grid3" },
          field({ label: "Título grande", value: e.title, onInput: (v) => { e.title = v; dirty(); } }),
          field({ label: "Detalle", value: e.detail, onInput: (v) => { e.detail = v; dirty(); } }),
          field({ label: "Nombre corto (se ve abajo, en la barra del recorrido)", value: e.rail, onInput: (v) => { e.rail = v; dirty(); } })))))),
    group("Cierre de la portada", "Lo que aparece al terminar el recorrido de la portada, junto al buscador de horarios.", h("div", { class: "grid2" },
      field({ label: "Título", value: hero.cierre.title, onInput: (v) => { hero.cierre.title = v; dirty(); } }),
      field({ label: "Texto", long: true, rows: 2, value: hero.cierre.text, onInput: (v) => { hero.cierre.text = v; dirty(); } }))),
    heroVideoTool(ctx));
}

/* ---------- horarios: el tablero de salidas ES el editor ---------- */
const nowMin = () => {
  const p = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Jujuy", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t) => +p.find((x) => x.type === t).value;
  return (g("hour") % 24) * 60 + g("minute");
};
// las próximas salidas de todos los servicios, con la hora de Jujuy
const DIAS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const hoyJ = () => normPlace(new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Jujuy", weekday: "short" }).format(new Date())).replace(".", "").slice(0, 3);
// "mar · jue", "lun a vie": ¿sale hoy? (si el texto no nombra días, sale todos los días)
const runsToday = (txt, desde = 0) => {
  const t = normPlace(txt), set = new Set(DIAS.filter((d) => new RegExp("\\b" + d).test(t)));
  for (const m of t.matchAll(/\b(dom|lun|mar|mie|jue|vie|sab)\w*\s*a\s*(dom|lun|mar|mie|jue|vie|sab)/g)) { let i = DIAS.indexOf(m[1]); const j = DIAS.indexOf(m[2]); for (let k = 0; k < 7; k++) { set.add(DIAS[i]); if (i === j) break; i = (i + 1) % 7; } }
  return !set.size || set.has(DIAS[(DIAS.indexOf(hoyJ()) + desde) % 7]); // desde = 1: el día de mañana
};
// qué palabras de un texto de días no se entienden ("mrt" -> ["mrt"]); vacío = todo bien
export const badDays = (txt) => {
  const ok = /^(dom|lun|mar|mie|jue|vie|sab)/, relleno = new Set(["a", "y", "e", "al", "todos", "los", "dias", "dia", "feriado", "feriados", "excepto", "salvo", "sin", "y", "de", "la", "semana", "fin", "fines", "lunes"]);
  return normPlace(txt).replace(/[·,;/()\-]/g, " ").split(/\s+/).filter((w) => w && !ok.test(w) && !relleno.has(w));
};
export function nextDepartures(routes, n = 4) {
  const now = nowMin();
  const todos = routes.flatMap((r) => (r.times || []).map((t) => ({ t, m: +t.slice(0, 2) * 60 + +t.slice(3), r })));
  const hoy = todos.filter((x) => !x.r.days?.[x.t] || runsToday(x.r.days[x.t])).sort((a, b) => a.m - b.m);
  const next = hoy.filter((x) => x.m >= now);
  const manana = todos.filter((x) => !x.r.days?.[x.t] || runsToday(x.r.days[x.t], 1)).sort((a, b) => a.m - b.m);
  return { list: (next.length ? next : manana).slice(0, n), tomorrow: !next.length };
}
// lugares que existen en Horarios (para avisar si un destino no coincide con ninguno)
const placeList = (d) => [...new Set(d.routes.flatMap((r) => [r.from, r.to, ...(r.stops || [])]).map((x) => String(x || "").replace(/\*/g, "").trim()).filter(Boolean))];
const normPlace = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const canonPlace = (d, name) => placeList(d).find((p) => normPlace(p) === normPlace(name)) || name;
const knownPlace = (d, name) => placeList(d).some((p) => normPlace(p) === normPlace(name));
const setDays = (r, days) => { if (days && Object.keys(days).length) r.days = days; else delete r.days; };
const hhmm = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String((((m % 60) + 60) % 60)).padStart(2, "0")}`;
// "14:30", "14.30" o "1430" -> "14:30" (o null si no es una hora)
const readTime = (s) => { const m = String(s).trim().match(/^(\d{1,2})[:.]?(\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : null; };

// Horas como fichas sobre el tablero oscuro. Tocar una abre una ventanita pegada a ella (sin mover las demás).
// la ventanita de hora que esté abierta (para confirmarla antes de publicar)
let activeCommit = null;
let activePending = null;
export const commitPendingEdit = () => (activeCommit ? activeCommit() : true);
export const hasPendingEdit = () => !!(activePending && activePending());
export const forgetPendingEdit = () => { activeCommit = null; activePending = null; };
export const changedLabels = (a, b) => changedIds(normData(a), normData(b)).map((id) => SECTIONS.find((x) => x.id === id)?.label || id);
function timesBoard(r, onChange, others, onDraw) {
  const chips = h("div", { class: "tb__chips" });
  const count = h("small", { class: "tb__count" });
  const err = h("small", { class: "err", role: "alert" });
  const ta = h("textarea", { rows: 3, class: "mono", "aria-label": "Horarios escritos a mano" }, timesToText(r));
  let open = -1, refocus = null, commitOpen = null;

  const changed = () => { r._bad = undefined; r.times = [...new Set(r.times)].sort(); ta.value = timesToText(r); err.textContent = ""; onChange(); draw(); };
  const snap = () => ({ times: [...r.times], days: r.days ? { ...r.days } : undefined });
  const restore = (s) => { r.times = s.times; setDays(r, s.days); changed(); };
  const undoable = (msg, fn) => undoToast(msg, fn);

  const cell = (t, i) => {
    const btn = h("button", { type: "button", class: "tb__chip" + (open === i ? " is-open" : ""), "aria-expanded": String(open === i), "aria-haspopup": "dialog", onkeydown: (e) => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const all = [...chips.querySelectorAll(".tb__chip")]; const j = all.indexOf(e.currentTarget) + (e.key === "ArrowRight" ? 1 : -1); if (all[j]) { all[j].focus(); e.preventDefault(); } }, title: "Tocá para cambiar la hora o quitarla",
      onclick: () => {
        if (open === i) { refocus = t; open = -1; draw(); return; }
        if (open !== -1 && commitOpen && !commitOpen()) return; // se guarda lo que se estaba escribiendo
        if (activeCommit && activeCommit !== commitOpen) activeCommit(); // y si había otra ventanita abierta en otro servicio, también
        open = r.times.indexOf(t); draw();
      } }, t, r.days?.[t] && h("em", {}, r.days[t]));
    if (open !== i) return h("span", { class: "tb__cell" }, btn);

    const tIn = h("input", { type: "text", inputmode: "numeric", value: t, maxlength: 5, "aria-label": "Hora de salida" });
    const dIn = h("input", { type: "text", value: r.days?.[t] || "", placeholder: "Todos los días", "aria-label": "Días en que sale (ejemplo: mar · jue · vie)" });
    const pErr = h("small", { class: "err", role: "alert" });
    const done = () => {
      const nt = readTime(tIn.value); if (!nt) { pErr.textContent = `No entiendo "${tIn.value}". Escribí una hora como 14:30.`; tIn.focus(); return false; }
      const malos = badDays(dIn.value); if (malos.length) { pErr.textContent = `No entiendo "${malos.join(" ")}" como día. Escribí por ejemplo: lun a vie, o mar · jue.`; dIn.focus(); return false; }
      const days = { ...(r.days || {}) }; delete days[t];
      const d = dIn.value.replace(/[()]/g, "").trim(); if (d) days[nt] = d;
      r.times[i] = nt; setDays(r, days); open = -1; refocus = nt; changed();
      return true;
    };
    commitOpen = done; activeCommit = done;
    activePending = () => tIn.value.trim() !== t || dIn.value.replace(/[()]/g, "").trim() !== (r.days?.[t] || "");
    [tIn, dIn].forEach((x) => x.addEventListener("input", () => hooks.repaint?.()));
    const drop = () => undoable(`Quitaste la salida de las ${t}.`, () => { const days = { ...(r.days || {}) }; delete days[t]; setDays(r, days); r.times.splice(i, 1); open = -1; changed(); });
    const keys = (e) => { if (e.key === "Enter") { e.preventDefault(); done(); } else if (e.key === "Escape") { e.stopPropagation(); open = -1; refocus = t; draw(); } };
    [tIn, dIn].forEach((x) => x.addEventListener("keydown", keys));
    const step = (d) => { const nt = readTime(tIn.value) || t; tIn.value = hhmm(+nt.slice(0, 2) * 60 + +nt.slice(3) + d); pErr.textContent = ""; tIn.focus(); };
    const pop = h("div", { class: "tb__pop", role: "dialog", "aria-label": "Editar salida" },
      h("label", {}, "Hora", tIn),
      h("div", { class: "tb__step" }, h("button", { type: "button", class: "btn btn--ghost", onclick: () => step(-5) }, "−5 min"), h("button", { type: "button", class: "btn btn--ghost", onclick: () => step(5) }, "+5 min")), h("label", {}, "Días (si no sale todos)", dIn), pErr,
      h("div", { class: "tb__popact" },
        h("button", { type: "button", class: "btn btn--primary", onclick: done }, "Listo"),
        h("button", { type: "button", class: "btn btn--ghost", onclick: drop }, icon("x", 16), "Quitar esta hora")));
    requestAnimationFrame(() => { // si no entra a la derecha, se abre hacia la izquierda
      const b = pop.getBoundingClientRect(); if (b.right > innerWidth - 12) { pop.style.left = "auto"; pop.style.right = "0"; }
      tIn.focus(); tIn.select();
    });
    return h("span", { class: "tb__cell" }, btn, pop);
  };

  // agregar: una hora o varias pegadas ("06:15 09:00, 14:30")
  const addIn = h("input", { type: "text", class: "mono", placeholder: "Escribí una hora (14:30) o pegá varias", "aria-label": "Agregar horas de salida" });
  const add = () => {
    const parts = addIn.value.split(/[\s,;]+/).filter(Boolean); if (!parts.length) return;
    const ok = parts.map(readTime), bad = parts.filter((_, k) => !ok[k]);
    if (bad.length) { err.textContent = `No se entiende: ${bad.join(", ")}. Escribilas así: 06:15 o 14:30.`; addIn.focus(); return; }
    const dup = ok.filter((t) => r.times.includes(t));
    r.times.push(...ok); addIn.value = ""; changed();
    if (dup.length) toast(`Ya ${dup.length > 1 ? "estaban" : "estaba"}: ${[...new Set(dup)].join(", ")}.`, "ok", 5000);
  };
  addIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });

  // herramientas para cargar rápido
  const mins = h("input", { type: "number", value: 10, min: 1, max: 600, "aria-label": "Minutos" });
  const shift = (sign) => { const n = Math.max(1, Math.min(600, +mins.value || 10)) * sign;
    undoable(`Corriste todas las salidas ${sign > 0 ? "+" : "−"}${Math.abs(n)} min.`, () => {
      const days = {}; r.times = r.times.map((t) => { const nt = hhmm(+t.slice(0, 2) * 60 + +t.slice(3) + n); if (r.days?.[t]) days[nt] = r.days[t]; return nt; }); setDays(r, days); changed(); }); };
  const daysAll = h("input", { type: "text", placeholder: "ej. lun a vie", "aria-label": "Días en que salen todas las horas" });
  const setAllDays = (txt) => { const d = txt.replace(/[()]/g, "").trim();
    const malos = badDays(d); if (malos.length) { err.textContent = `No entiendo "${malos.join(" ")}" como día. Escribí por ejemplo: lun a vie, o mar · jue.`; daysAll.focus(); return; }
    undoable(d ? `Todas las salidas ahora van: ${d}.` : "Todas las salidas van todos los días.", () => { const days = {}; if (d) r.times.forEach((t) => { days[t] = d; }); setDays(r, days); changed(); }); };
  const pick = h("select", { "aria-label": "Copiar los horarios de otro servicio" }, h("option", { value: "" }, "Copiar horarios de…"),
    ...others().map((o, k) => h("option", { value: String(k) }, `${o.from || "Origen"} → ${o.to || "Destino"}${o.service ? " · " + o.service : ""}`)));
  const copy = () => { const o = others()[+pick.value]; if (pick.value === "" || !o) return;
    undoable("Copiaste los horarios.", () => { r.times = [...o.times]; setDays(r, o.days ? { ...o.days } : undefined); changed(); }); pick.value = ""; };

  ta.addEventListener("input", () => {
    const p = parseTimes(ta.value);
    if (!p.bad.length) { r.times = p.times; setDays(r, p.days); r._bad = undefined; err.textContent = ""; }
    else { r._bad = p.bad; err.textContent = `No se entiende: ${p.bad.join(", ")}. Formato: 06:15, 09:00`; }
    onChange(); draw();
  });

  const draw = () => {
    if (activeCommit && activeCommit === commitOpen) { activeCommit = null; activePending = null; }
    commitOpen = null;
    chips.replaceChildren(...(r.times.length ? r.times.map(cell) : [h("em", { class: "tb__empty" }, "Todavía no hay horarios. Escribí el primero abajo.")]));
    count.textContent = `${r.times.length} ${r.times.length === 1 ? "salida" : "salidas"} por día`;
    if (refocus != null) { const c = [...chips.querySelectorAll(".tb__chip")]; (c.find((x) => x.textContent.startsWith(refocus)) || c[0])?.focus(); refocus = null; }
    onDraw?.();
  };
  draw();
  return h("div", { class: "tb" }, h("p", { class: "tb__hint" }, "Tocá una hora para cambiarla o quitarla."), chips,
    h("div", { class: "tb__add" }, addIn, h("button", { type: "button", class: "btn btn--primary", onclick: add }, icon("plus", 16), "Agregar"), count), err,
    h("details", { class: "adv" }, h("summary", {}, "Correr o copiar horarios"),
      h("div", { class: "tb__tools" },
        h("div", { class: "tb__tool" }, h("span", {}, "Correr todas las salidas"), mins, h("span", {}, "min"),
          h("button", { type: "button", class: "btn btn--ghost", onclick: () => shift(-1) }, "Adelantar"), h("button", { type: "button", class: "btn btn--ghost", onclick: () => shift(1) }, "Atrasar")),
        h("div", { class: "tb__tool" }, h("span", {}, "Días de todas las salidas"), daysAll,
          h("button", { type: "button", class: "btn btn--ghost", onclick: () => setAllDays(daysAll.value) }, "Aplicar"), h("button", { type: "button", class: "btn btn--ghost", onclick: () => setAllDays("") }, "Todos los días")),
        h("div", { class: "tb__tool" }, pick, h("button", { type: "button", class: "btn btn--ghost", onclick: copy }, "Copiar")),
        h("div", { class: "tb__tool tb__tool--col" }, h("span", {}, "Escribirlos a mano"), ta,
          h("small", { class: "hint" }, "Separados por coma. Si una salida va solo ciertos días: 14:15 (mar · jue · vie).")))));
}

// las horas de cada servicio se pliegan: se ve un resumen y se abre una tarjeta por vez
let svcOpen = 0;
function timesFold(r, i, dirty, routes) {
  const sum = h("span", { class: "svc__sum" });
  const upd = () => { const ts = r.times || []; sum.textContent = `${ts.length} ${ts.length === 1 ? "salida" : "salidas"}${ts.length ? "  ·  " + ts.slice(0, 4).join("   ") + (ts.length > 4 ? "   …" : "") : ""}`; };
  const board = timesBoard(r, dirty, () => routes.filter((x) => x !== r), upd); upd();
  return h("div", { class: "field" }, h("label", { class: "sr-only" }, "Horarios de salida"),
    h("details", { class: "adv svc__times", name: "svc-times", open: i === svcOpen || !(r.times || []).length, ontoggle: (e) => { if (e.target.open) svcOpen = i; } },
      h("summary", {}, h("strong", {}, "Horarios de salida"), sum), board));
}

/* ---------- la ruta: las paradas como una línea que se arma tocando ---------- */
function stopsEditor(r, dirty) {
  const list = h("ol", { class: "route", "aria-label": "Paradas en orden de viaje" });
  const input = h("input", { type: "text", list: "stops-dl", placeholder: "Agregar una parada (por ejemplo Humahuaca)", "aria-label": "Agregar una parada" });
  const err = h("small", { class: "err", role: "alert" });
  const draw = () => {
    const stops = r.stops || [];
    list.replaceChildren(...(stops.length ? stops.map((p, i) => h("li", { class: "route__stop" + (i === 0 ? " is-first" : i === stops.length - 1 ? " is-last" : "") },
      h("span", { class: "route__dot", "aria-hidden": "true" }),
      h("span", { class: "route__name" }, p),
      h("span", { class: "route__btns" },
        h("button", { type: "button", class: "ico ico--sm", "aria-label": `Mover ${p} antes`, title: "Antes", disabled: i === 0, onclick: () => move(i, -1) }, h("span", { class: "flip" }, icon("arrow", 14))),
        h("button", { type: "button", class: "ico ico--sm", "aria-label": `Mover ${p} después`, title: "Después", disabled: i === stops.length - 1, onclick: () => move(i, 1) }, icon("arrow", 14)),
        h("button", { type: "button", class: "ico ico--sm ico--del", "aria-label": `Quitar ${p}`, title: "Quitar", onclick: () => undoToast(`Quitaste la parada ${p}.`, () => { r.stops.splice(i, 1); dirty(); draw(); }) }, icon("x", 14)))))
      : [h("li", { class: "route__empty" }, "Todavía no hay paradas. Agregá la primera abajo.")]));
    err.textContent = "";
  };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= r.stops.length) return; [r.stops[i], r.stops[j]] = [r.stops[j], r.stops[i]]; dirty(); draw(); };
  const add = () => {
    const nuevas = parseStops(input.value); if (!nuevas.length) return;
    const ya = nuevas.filter((x) => (r.stops || []).some((y) => normPlace(y) === normPlace(x)));
    r.stops = [...(r.stops || []), ...nuevas.filter((x) => !ya.includes(x))]; input.value = ""; dirty(); draw();
    if (ya.length) err.textContent = `Ya estaba${ya.length > 1 ? "n" : ""}: ${ya.join(", ")}.`;
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } });
  input.addEventListener("change", add);
  draw();
  return h("div", { class: "field" },
    h("div", { class: "field__lab" }, h("label", {}, "Paradas, en orden de viaje")),
    list, h("div", { class: "route__add" }, input, h("button", { type: "button", class: "btn btn--ghost", onclick: add }, icon("plus", 16), "Agregar")), err,
    h("small", { class: "hint" }, "De la salida a la llegada. Con esto funciona el buscador de horarios de la web: escribí una por vez o varias separadas por coma."));
}

/* ---------- horarios ---------- */
function routesSection({ draft, dirty: baseDirty, rerender }) {
  const routes = draft.routes;
  let board;
  const dirty = () => { baseDirty(); board?.update(); };
  const origins = () => [...new Set(routes.map((r) => r.from).filter(Boolean))];
  const dl = h("datalist", { id: "origins-dl" }, origins().map((o) => h("option", { value: o })));
  const list = listEditor({
    id: "routes", items: routes, onChange: () => { dirty(); dl.replaceChildren(...origins().map((o) => h("option", { value: o }))); },
    addLabel: "Agregar servicio", empty: "No hay servicios cargados.",
    make: () => ({ id: "r" + Math.random().toString(36).slice(2, 7), from: origins()[0] || "", to: "", via: "", service: "", stops: [], times: [], note: "" }),
    title: (r) => `${r.from || "Origen"} → ${r.to || "Destino"}`, sub: (r) => r.service,
    render: (r, i) => h("div", { class: "svc" },
      // lo que más se hace (las horas) va primero; los datos del servicio quedan plegados
      timesFold(r, i, dirty, routes),
      h("details", { class: "adv svc__more", open: !(r.from && r.to) }, h("summary", {}, "Datos del servicio (de dónde sale, a dónde llega y paradas)"),
        h("div", { class: "svc__fields" },
          h("div", { class: "grid2" },
            field({ label: "Sale desde (origen)", value: r.from, hint: "Elegí uno existente o escribí uno nuevo.", list: "origins-dl", validate: (v) => (v.trim() ? "" : "Falta el origen. Escribí de dónde sale, por ejemplo San Salvador de Jujuy."), onInput: (v) => { r.from = v; dirty(); } }),
            field({ label: "Nombre del servicio", value: r.service, hint: "Por ejemplo: Ruta 9", onInput: (v) => { r.service = v; dirty(); } }),
            field({ label: "Destino final (se ve en el tablero)", help: "Si no todas las salidas llegan hasta el final, escribí un asterisco al terminar (La Quiaca*) y explicalo en la Nota.", value: r.to, hint: "Podés terminar con * si no todas las salidas llegan hasta ahí.", validate: (v) => (v.trim() ? "" : "Falta el destino final. Escribí a dónde llega, por ejemplo La Quiaca."), onInput: (v) => { r.to = v; dirty(); } }),
            field({ label: "Pueblos del camino (texto del tablero)", help: "Es lo que se lee en el tablero debajo del destino, por ejemplo: Tilcara · Humahuaca. Es solo un texto: las paradas reales se cargan más abajo.", value: r.via, hint: "Opcional. Por ejemplo: Tilcara · Humahuaca.", onInput: (v) => { r.via = v; dirty(); } })),
          stopsEditor(r, dirty),
          field({ label: "Nota (se muestra debajo)", long: true, rows: 2, value: r.note, onInput: (v) => { r.note = v; dirty(); } })))),
  });
  board = departuresBoard(routes);
  // buscar entre los servicios
  const filter = h("input", { type: "search", class: "svc__find", placeholder: "Buscar un servicio (por ejemplo: Tilcara)", "aria-label": "Buscar un servicio" });
  filter.addEventListener("input", () => { const q = normPlace(filter.value); [...list.querySelectorAll(":scope > .item")].forEach((it) => { it.hidden = !!q && !normPlace(it.querySelector(".item__title")?.textContent || "").includes(q); }); });
  // correr todas las salidas de varios servicios a la vez
  const mins = h("input", { type: "number", value: 10, min: 1, max: 600, "aria-label": "Minutos" });
  const from = h("select", { "aria-label": "Qué servicios" }, h("option", { value: "" }, "Todos los servicios"), ...origins().map((o) => h("option", { value: o }, `Los que salen de ${o}`)));
  const shiftAll = (sign) => {
    const n = Math.max(1, Math.min(600, +mins.value || 10)) * sign, pick = routes.filter((r) => !from.value || r.from === from.value);
    undoToast(`Corriste ${pick.length} ${pick.length === 1 ? "servicio" : "servicios"} ${n > 0 ? "+" : "−"}${Math.abs(n)} min.`, () => {
      pick.forEach((r) => { const days = {}; r.times = r.times.map((t) => { const nt = hhmm(+t.slice(0, 2) * 60 + +t.slice(3) + n); if (r.days?.[t]) days[nt] = r.days[t]; return nt; }).sort(); setDays(r, days); });
      dirty(); rerender();
    });
  };
  const bulk = h("details", { class: "adv bulk" }, h("summary", {}, "Correr las salidas de varios servicios a la vez"),
    h("div", { class: "bulk__row" }, from, mins, h("span", {}, "min"),
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => shiftAll(-1) }, "Adelantar"), h("button", { type: "button", class: "btn btn--ghost", onclick: () => shiftAll(1) }, "Atrasar")));
  const stopsDl = h("datalist", { id: "stops-dl" }, placeList(draft).map((p) => h("option", { value: p })));
  return h("div", { class: "stack" }, dl, stopsDl,
    groupAside("Tus servicios", `${routes.length} servicios, ${routes.reduce((n, r) => n + (r.times?.length || 0), 0)} salidas por día. Buscá el servicio y tocá una hora para cambiarla.`, board.el, h("div", { class: "svc__tools" }, filter, bulk), list));
}

/* ---------- destinos ---------- */
function destinationsSection({ draft, dirty: baseDirty }) {
  const dpv = destPreview(draft.destinations);
  const dirty = () => { baseDirty(); dpv.update(); };
  return h("div", { class: "stack" }, h("datalist", { id: "places-dl" }, placeList(draft).map((p) => h("option", { value: p }))), groupAside("Tarjetas de destinos", "Las tarjetas que se deslizan en la sección \"Del valle al altiplano\". El nombre tiene que coincidir con una localidad de los horarios para que el botón \"Ver horarios\" funcione.", dpv.el,
    listEditor({ id: "destinations", items: draft.destinations, onChange: dirty, addLabel: "Agregar destino", min: 1, max: 14, title: (d) => d.name || "Destino", sub: (d) => d.tag,
      make: () => ({ name: "", tag: "", text: "", image: "" }),
      render: (d) => h("div", { class: "split" },
        imageField({ label: "Foto", url: d.image, maxWidth: 1100, hint: "Se optimiza sola. Mejor si es vertical o cuadrada.", onChange: (u) => { d.image = u; dirty(); } }),
        h("div", {},
          h("div", { class: "grid2" },
            field({ label: "Nombre", help: "El nombre del lugar, tal cual figura en Horarios (por ejemplo Tilcara). Tiene que coincidir con una parada para que el botón «Ver horarios» encuentre salidas. Si lo escribís distinto, se corrige solo al salir del campo.", value: d.name, list: "places-dl", normalize: (v) => canonPlace(draft, v), validate: (v) => (v.trim() ? "" : "Falta el nombre. Escribí el del lugar, por ejemplo Tilcara."), soft: (v) => (!v.trim() || knownPlace(draft, v) ? "" : "Ojo: este nombre no coincide con ninguna parada de Horarios, así que el botón «Ver horarios» no va a encontrar salidas."), onInput: (v) => { d.name = v; dirty(); } }),
            field({ label: "Zona (ej. Quebrada)", help: "Es la palabra chica que aparece sobre el nombre en la tarjeta del destino. Por ejemplo: Quebrada, Valle o Puna.", value: d.tag, onInput: (v) => { d.tag = v; dirty(); } })),
          field({ label: "Descripción corta", long: true, rows: 2, value: d.text, onInput: (v) => { d.text = v; dirty(); } }))) })));
}

/* ---------- galeria de la grilla animada + a bordo ---------- */
function galleryStatus(n) {
  if (n < 6) return { ok: false, msg: `Hay ${n} fotos. Necesitás al menos 6.` };
  if (n > 15) return { ok: false, msg: `Hay ${n} fotos. El máximo es 15.` };
  if (n % 3) return { ok: false, msg: `Hay ${n} fotos. Para que la galería quede completa tienen que ser 6, 9, 12 o 15: agregá ${3 - (n % 3)} más o quitá ${n % 3}.` };
  return { ok: true, msg: `${n} fotos: la grilla queda completa.` };
}
function gallerySection({ draft, dirty: baseDirty, rerender }) {
  const gpv = galleryPreview(draft.gallery);
  const dirty = () => { baseDirty(); gpv.update(); };
  const status = h("p", { class: "status" });
  const fix = h("div", { class: "list__add" });
  const fixUpd = () => {
    const n = draft.gallery.length; fix.replaceChildren();
    const target = n < 6 ? 6 : n > 15 ? 15 : n % 3 ? n + (3 - (n % 3)) : n;
    if (target > n && target <= 15) fix.append(h("button", { type: "button", class: "btn btn--ghost", onclick: () => { while (draft.gallery.length < target) draft.gallery.push({ src: "", caption: "" }); dirty(); rerender(); } }, icon("plus", 16), `Agregar ${target - n} para completar (${target})`));
    if (n > 15 || (n % 3 && n > 6)) { const lower = n > 15 ? 15 : n - (n % 3); fix.append(h("button", { type: "button", class: "btn btn--ghost", onclick: () => undoToast(`Quitaste las últimas ${n - lower} fotos.`, () => { draft.gallery.length = lower; dirty(); rerender(); }) }, icon("x", 16), `Quitar las últimas ${n - lower} (${lower})`)); }
  };
  const upd = () => { const s = galleryStatus(draft.gallery.length); status.textContent = s.msg; status.className = "status " + (s.ok ? "is-ok" : "is-bad"); fixUpd(); };
  upd();
  return h("div", { class: "stack" },
    groupAside("Galería animada de la web", "Son las fotos que entran y se agrandan en el bloque \"Conectamos caminos\". Tienen que ser un múltiplo de 3 (6, 9, 12 o 15).", gpv.el, status, fix,
      listEditor({ id: "gallery", items: draft.gallery, onChange: () => { upd(); dirty(); }, addLabel: "Agregar foto", max: 15, min: 6, title: (g, i) => g.caption || `Foto ${i + 1}`, sub: (g, i) => `N.º ${i + 1}`,
        make: () => ({ src: "", caption: "" }),
        render: (g) => h("div", { class: "split" },
          imageField({ label: "Foto", url: g.src, maxWidth: 1000, hint: "Mejor cuadrada. Se recorta al centro.", onChange: (u) => { g.src = u; delete g.zoom; dirty(); } }),
          field({ label: "Nombre que aparece sobre la foto", value: g.caption, onInput: (v) => { g.caption = v; dirty(); } })) })));
}
function boardSection({ draft, dirty }) {
  return h("div", { class: "stack" },
    group("Foto de \"A bordo\"", "", h("div", { class: "split" },
      imageField({ label: "Foto", url: draft.boardImage.src, maxWidth: 1400, hint: "Mejor vertical (4:5) o apaisada.", onChange: (u) => { draft.boardImage.src = u; dirty(); } }),
      field({ label: "Descripción de la foto (para accesibilidad)", value: draft.boardImage.alt, onInput: (v) => { draft.boardImage.alt = v; dirty(); } }))),
    group("Comodidades a bordo", "La lista junto a la foto.",
      listEditor({ id: "services", items: draft.services, onChange: dirty, addLabel: "Agregar comodidad", max: 10, title: (s) => s[0] || "Comodidad", make: () => ["", ""],
        render: (s) => h("div", { class: "grid2" },
          field({ label: "Nombre", value: s[0], onInput: (v) => { s[0] = v; dirty(); } }),
          field({ label: "Detalle", help: "Una frase corta que explica la comodidad.", value: s[1], onInput: (v) => { s[1] = v; dirty(); } })) })));
}

/* ---------- contacto ---------- */
function contactSection({ draft, dirty: baseDirty }) {
  const site = draft.site;
  const cpv = contactPreview(site);
  const dirty = () => { baseDirty(); cpv.update(); };
  return h("div", { class: "stack" },
    groupAside("Datos de contacto", "", cpv.el, h("div", { class: "grid2" },
      field({ label: "WhatsApp (solo números, con código de país)", help: "Es el número al que escriben los pasajeros. Va sin signos ni espacios: 54, después el 9 y el número con código de área, sin el 0 ni el 15.", value: site.whatsapp, mono: true, hint: "Ejemplo: 5493884640178", validate: (v) => (/^\d{10,15}$/.test(v.replace(/\D/g, "")) ? "" : "Tiene que tener entre 10 y 15 números."), onInput: (v) => { const old = site.whatsapp; site.whatsapp = v.replace(/\D/g, ""); draft.hero.ctas.forEach((c) => { if (c.href === `https://wa.me/${old}`) c.href = `https://wa.me/${site.whatsapp}`; }); dirty(); } }),
      field({ label: "Teléfono central", value: site.phoneLabel, hint: "Con código de área, por ejemplo 0388 425-4331. El botón \"Llamar\" se arma solo.", validate: (v) => (v.replace(/\D/g, "").length >= 8 ? "" : "Escribí el teléfono con código de área."),
        onInput: (v) => { site.phoneLabel = v; const oldTel = site.phoneTel; const d = v.replace(/\D/g, "").replace(/^0/, ""); site.phoneTel = d ? "+" + (d.startsWith("54") ? d : "54" + d) : ""; draft.hero.ctas.forEach((c) => { if (c.href === "tel:" + oldTel) c.href = "tel:" + site.phoneTel; }); dirty(); } }),
      field({ label: "Título de la pestaña (arriba, en el navegador)", help: "Es el texto que se ve en la pestaña del navegador y cuando alguien busca la empresa en Google.", value: site.title, onInput: (v) => { site.title = v; dirty(); } })),
      field({ label: "Dirección (abajo de la página)", long: true, rows: 2, value: site.address, onInput: (v) => { site.address = v; dirty(); } }),
      field({ label: "Texto chico de abajo de la página", help: "Una línea chica que aparece al final de toda la web.", long: true, rows: 2, value: site.footerNote, onInput: (v) => { site.footerNote = v; dirty(); } })),
    group("Boleterías", "El listado de teléfonos de la sección Contacto.",
      listEditor({ id: "boleterias", items: draft.boleterias, onChange: dirty, addLabel: "Agregar boletería", max: 20, title: (b) => b.name || "Boletería", sub: (b) => b.tel, make: () => ({ name: "", tel: "" }),
        render: (b) => h("div", { class: "grid3" },
          field({ label: "Localidad", value: b.name, onInput: (v) => { b.name = v; dirty(); } }),
          field({ label: "Teléfono", value: b.tel, onInput: (v) => { b.tel = v; dirty(); } }),
          field({ label: "Detalle (opcional)", value: b.sub || "", onInput: (v) => { if (v) b.sub = v; else delete b.sub; dirty(); } })) })),
    group("Atención por voz (avanzado)", "Es el código del asistente que atiende las llamadas de voz desde la web. No lo cambies si no estás seguro.",
      field({ label: "Código del asistente de voz", help: "Es el código que identifica al asistente que atiende las llamadas desde la web. No lo cambies si no estás seguro.", value: site.agentId, mono: true, onInput: (v) => { site.agentId = v.trim(); dirty(); } })));
}

/* ---------- preguntas ---------- */
function faqSection({ draft, dirty }) {
  return h("div", { class: "stack" }, group("Preguntas frecuentes", "Se despliegan en la sección \"Lo que conviene saber\".",
    listEditor({ id: "faq", items: draft.faq, onChange: dirty, addLabel: "Agregar pregunta", max: 30, title: (f) => f[0] || "Pregunta", make: () => ["", ""],
      render: (f) => h("div", {},
        field({ label: "Pregunta", value: f[0], onInput: (v) => { f[0] = v; dirty(); } }),
        field({ label: "Respuesta", long: true, rows: 4, value: f[1], onInput: (v) => { f[1] = v; dirty(); } })) })));
}

/* ---------- historial ---------- */
function historySection({ draft, replaceDraft, published }) {
  const box = h("div", { class: "list" }, h("p", { class: "empty" }, "Cargando…"));
  listHistory().then((rows) => {
    box.replaceChildren(); let shownRows = 0;
    if (!rows.length) return box.append(h("p", { class: "empty" }, "Todavía no hay versiones anteriores. Aparecen acá cada vez que guardás."));
    rows.forEach((r, i) => {
      // cada fila guarda cómo estaba la web antes de esa publicación: se compara con la versión que la reemplazó
      const newer = i === 0 ? published?.() : rows[i - 1].data;
      const labs = newer ? changedIds(normData(r.data), normData(newer)).map((id) => SECTIONS.find((x) => x.id === id)?.label || id) : [];
      if (!labs.length) return; // las publicaciones sin cambios de contenido no aportan nada
      shownRows++;
      box.append(h("div", { class: "item item--row" },
      h("div", {}, h("strong", {}, `Antes de la publicación del ${fmtDate(r.saved_at)}`), h("small", { class: "hint" }, `Esa publicación cambió: ${labs.join(", ")}`)),
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => {
        undoToast("Volviste a como estaba antes de esa publicación. Todavía no está publicado: revisalo y tocá Guardar y publicar.", () => replaceDraft(r.data));
      } }, "Volver a como estaba antes")));
    });
    if (!shownRows) box.append(h("p", { class: "empty" }, "Todavía no hay publicaciones con cambios para volver atrás."));
  }).catch((e) => { box.replaceChildren(h("p", { class: "err" }, plainErr(e))); });
  return h("div", { class: "stack" }, group("Versiones anteriores", "Las últimas 20 publicaciones. Cada una dice qué cambió: cargala en el editor para volver a como estaba.", box));
}

/* ---------- resumen: lo que le sirve al dueño al entrar ---------- */
// una sola forma de escribir fecha y hora en todo el panel
export const fmtDate = (d) => fmtShort(d);

const nextIn = (nd) => { const x = nd.list[0]; if (!x || nd.tomorrow) return ""; const m = x.m - nowMin(); return m <= 0 ? " La próxima sale ahora." : m < 60 ? ` La próxima sale en ${m} min.` : ` La próxima sale en ${Math.floor(m / 60)} h ${m % 60} min.`; };
function summarySection({ draft, goto, lastPublished, published }) {
  const errs = validate(draft);
  const lost = draft.destinations.filter((d) => d.name?.trim() && !knownPlace(draft, d.name));
  const nd = nextDepartures((published ? normData(published()) : draft).routes, 4); // lo que ve el pasajero hoy: lo publicado
  const board = h("div", { class: "board" }, nd.list.length
    ? nd.list.map((x, i) => h("div", { class: "board__line" + (i === 0 ? " is-next" : "") },
      h("span", { class: "board__time" }, x.t, x.r.days?.[x.t] ? "*" : ""),
      h("span", { class: "board__dest" }, h("strong", {}, `${x.r.from || "Origen"} → ${x.r.to || "Destino"}`), x.r.service && h("small", {}, x.r.service))))
    : h("p", { class: "empty" }, "Todavía no hay horarios cargados."));
  const more = (label, id, ico) => h("button", { type: "button", class: "morelink", onclick: () => goto(id) }, icon(ico, 18), label, icon("arrow", 16));
  const lp = lastPublished();
  return h("div", { class: "stack" },
    group(nd.tomorrow ? "Primeras salidas de mañana" : "Próximas salidas", `Así las ve el pasajero ahora mismo en la web.${nextIn(nd)}`, board),
    group("¿Qué querés hacer?", "", h("div", { class: "actions" },
      h("button", { type: "button", class: "btn btn--primary btn--xl", onclick: () => goto("horarios") }, icon("horarios", 20), "Cambiar un horario"),
      h("div", { class: "actions__more" },
        more("Subir o cambiar una foto", "galeria", "galeria"),
        more("Cambiar un texto de la web", "textos", "textos"),
        more("Cambiar el video de la portada", "hero", "hero")))),
    group("Estado", lp ? `Última publicación: ${fmtDate(lp)}.` : "Todavía no se publicó nada desde el panel.",
      errs.length
        ? h("div", {}, h("p", { class: "status is-bad" }, `Hay ${errs.length} ${errs.length === 1 ? "cosa" : "cosas"} por revisar antes de publicar:`),
          h("ul", { class: "errs" }, errs.map((x) => h("li", {}, h("span", {}, x.msg), h("button", { type: "button", class: "link", onclick: () => goto(x.sec, x) }, "Ir ahí", icon("arrow", 14))))))
        : h("p", { class: "okline" }, icon("check", 18), "No hay nada pendiente de revisar."),
      lost.length ? h("div", { class: "softlist" }, h("p", { class: "warn" }, `Revisar (no impide publicar): ${lost.length === 1 ? "el destino" : "los destinos"} ${lost.map((d) => d.name).join(", ")} no ${lost.length === 1 ? "coincide" : "coinciden"} con ninguna parada de Horarios.`),
        h("button", { type: "button", class: "link", onclick: () => goto("destinos") }, "Ir a Destinos", icon("arrow", 14))) : null));
}

/* varias pantallas en una: junta las secciones de cada una */
const together = (...fns) => (ctx) => h("div", { class: "stack" }, fns.flatMap((f) => [...f(ctx).children]));

export const SECTIONS = [
  { id: "resumen", label: "Resumen", group: "Inicio", desc: "Lo que pasa hoy en tu web.", help: ["Mirá las próximas salidas: son las que el pasajero ve ahora.", "Tocá \"Cambiar un horario\" para editar las salidas.", "Cuando termines, tocá \"Guardar y publicar\" (o Ctrl+S)."], render: summarySection },
  { id: "hero", label: "Portada y video", group: "La web", desc: "El titular, los botones y el video de la primera pantalla.", help: ["Cambiá el titular y los botones de arriba.", "Para un video nuevo, subí un video por cada etapa del viaje, en orden.", "Generá el video, revisá la vista previa y tocá \"Usar este video\".", "Guardá y publicá."], render: heroSection },
  { id: "textos", label: "Textos de la web", group: "La web", desc: "Menú, títulos y frases de cada parte de la web.", help: ["Buscá la parte de la web que querés cambiar.", "Escribí el texto nuevo.", "Guardá y publicá."], render: textsSection },
  { id: "horarios", label: "Horarios de salida", group: "Viajes", desc: "Las salidas que ve el pasajero. Tocá una hora para cambiarla.", help: ["Buscá el servicio en la lista.", "Tocá una hora para cambiarla o quitarla. Para sumar, escribí la hora abajo (podés pegar varias).", "En \"Correr o copiar horarios\" podés correr todas las horas, copiarlas de otro servicio o poner los días de todas.", "Guardá y publicá. Si te equivocás, tocá \"Deshacer\"."], render: routesSection },
  { id: "destinos", label: "Destinos", group: "Viajes", desc: "Los lugares a los que viaja la empresa.", help: ["Elegí la foto con \"Cambiar imagen\": se achica sola.", "Corregí el nombre y la descripción.", "El nombre tiene que ser igual a una parada de Horarios.", "Guardá y publicá."], render: destinationsSection },
  { id: "galeria", label: "Fotos", group: "Contenido", desc: "Fotos de la galería animada y de \"A bordo\".", help: ["Cambiá una foto con \"Cambiar imagen\": se achica sola.", "La galería necesita 6, 9, 12 o 15 fotos.", "Guardá y publicá."], render: together(gallerySection, boardSection) },
  { id: "contacto", label: "Contacto y preguntas", group: "Contenido", desc: "Teléfonos, WhatsApp, boleterías y preguntas frecuentes.", help: ["Corregí el dato que cambió.", "Los números se revisan solos al salir del campo.", "Guardá y publicá."], render: together(contactSection, faqSection) },
  { id: "historial", label: "Versiones anteriores", group: "Avanzado", desc: "Versiones anteriores de la web, por si hay que volver atrás.", help: ["Elegí una versión de la lista.", "Tocá \"Volver a como estaba antes\" y revisalo.", "Si está bien, tocá \"Guardar y publicar\"."], render: historySection },
];

/* ---------- validacion antes de publicar ---------- */
export function validate(d) {
  // cada error dice en qué sección está (sec), qué elemento de la lista (item) y qué campo (field), para llevar ahí al cliente
  const e = [];
  const add = (sec, msg, extra = {}) => e.push({ sec, msg, ...extra });
  const phoneOk = (s) => /\d{6,}/.test(String(s).replace(/\D/g, ""));
  d.routes.forEach((r, i) => {
    const n = `Horarios · ${[r.from?.trim(), r.to?.trim()].filter(Boolean).join(" → ") || "servicio " + (i + 1)}`, at = { item: i, list: "routes" };
    if (!r.from?.trim()) add("horarios", `${n}: falta el origen.`, { ...at, field: "Sale desde" });
    if (!r.to?.trim()) add("horarios", `${n}: falta el destino final.`, { ...at, field: "Destino final" });
    if (!r.stops?.length) add("horarios", `${n}: agregá al menos una parada.`, { ...at, field: "Paradas" });
    Object.entries(r.days || {}).forEach(([t, d]) => { const m = badDays(d); if (m.length) add("horarios", `${n}: los días de la salida de las ${t} no se entienden ("${m.join(" ")}"). Escribí por ejemplo: lun a vie.`, { ...at, field: "Horarios de salida" }); });
    if (r._bad) add("horarios", `${n}: hay horarios mal escritos (${r._bad.join(", ")}).`, { ...at, field: "Horarios de salida" });
    else if (!r.times?.length) add("horarios", `${n}: agregá al menos un horario.`, { ...at, field: "Horarios de salida" });
  });
  const g = galleryStatus(d.gallery.length); if (!g.ok) add("galeria", "Galería: " + g.msg);
  d.gallery.forEach((x, i) => { if (!x.src) add("galeria", `Galería: a la foto ${i + 1} le falta la imagen.`, { item: i, list: "gallery" }); });
  d.destinations.forEach((x, i) => {
    if (!x.name?.trim()) add("destinos", `Destinos: al destino ${i + 1} le falta el nombre.`, { item: i, list: "destinations", field: "Nombre" });
    if (!x.image) add("destinos", `Destinos: a "${x.name || i + 1}" le falta la foto.`, { item: i, list: "destinations" });
  });
  d.boleterias.forEach((b, i) => {
    if (!b.name?.trim()) add("contacto", `Contacto: a la boletería ${i + 1} le falta la localidad.`, { item: i, list: "boleterias", field: "Localidad" });
    if (!phoneOk(b.tel)) add("contacto", `Contacto: revisá el teléfono de la boletería ${i + 1} (con código de área).`, { item: i, list: "boleterias", field: "Teléfono" });
  });
  if (!/^\d{10,15}$/.test(d.site.whatsapp)) add("contacto", "Contacto: el WhatsApp tiene que tener entre 10 y 15 números (con código de país).", { field: "WhatsApp" });
  const fi = d.faq.findIndex((f) => !(f[0]?.trim() && f[1]?.trim()));
  if (fi >= 0) add("contacto", "Preguntas: hay preguntas o respuestas vacías.", { item: fi, list: "faq", field: d.faq[fi][0]?.trim() ? "Respuesta" : "Pregunta" });
  if (!d.hero.headline?.trim()) add("hero", "Portada: falta el titular.", { field: "Titular" });
  for (const [gt, , fields] of TEXT_GROUPS) for (const [path, label, long] of fields) {
    if (!long && !String(get(d, path) ?? "").trim()) add("textos", `Textos: falta "${label}" en "${gt}".`, { field: label });
  }
  if (!String(d.site.title ?? "").trim()) add("contacto", "Contacto: falta el título de la pestaña del navegador.", { field: "Título de la pestaña" });
  if (String(d.site.phoneLabel || "").replace(/\D/g, "").length < 8) add("contacto", "Contacto: falta el teléfono central.", { field: "Teléfono central" });
  const hrefOk = (v) => /^#\w+/.test(v) || /^tel:\+?\d{8,}/.test(v) || /^https?:\/\/[^\s/]+\.[^\s/]+/.test(v);
  const ti = d.hero.etapas.findIndex((e) => !e.title?.trim());
  if (ti >= 0) add("hero", `Portada: el paso ${ti + 1} del viaje no tiene título.`, { item: ti, list: "etapas", field: "Título grande" });
  const si = d.services.findIndex((x) => !x[0]?.trim());
  if (si >= 0) add("galeria", "Fotos: hay una comodidad a bordo sin nombre.", { item: si, list: "services", field: "Nombre" });
  const fi2 = d.texts.facts.findIndex((x) => !String(x).trim());
  if (fi2 >= 0) add("textos", "Textos: hay una frase corta vacía.", { item: fi2, list: "facts", field: "Texto" });
  const ci = d.hero.ctas.findIndex((c) => !(c.label?.trim() && hrefOk(String(c.href || "").trim())));
  if (ci >= 0) add("hero", "Portada: hay botones sin texto o con un enlace incompleto.", { item: ci, list: "ctas", field: d.hero.ctas[ci].label?.trim() ? "A dónde lleva" : "Texto del botón" });
  return e;
}
export const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith("_") ? undefined : v)));
