import { h, field, check, group, groupAside, listEditor, imageField, confirmBox, toast, icon } from "./ui.js";
import { listHistory } from "./api.js";
import { heroVideoTool } from "./hero-video.js";

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

export const fmtShort = (d) => new Date(d).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
// 5493884640178 -> +54 9 388 464-0178 (como lo ve el pasajero)
const fmtWa = (n) => { const d = String(n || "").replace(/\D/g, ""); return /^549\d{10}$/.test(d) ? `+54 9 ${d.slice(3, 6)} ${d.slice(6, 9)}-${d.slice(9)}` : d ? "+" + d : "…"; };
function destPreview(items) {
  const el = h("div", { class: "tpv", "aria-label": "Así se ve en la web" });
  const update = () => el.replaceChildren(h("span", { class: "tpv__tag" }, "Así se ve en la web"),
    ...items.map((d) => h("p", { class: "tpv__p tpv__row" }, h("strong", {}, d.name || "…"), d.tag ? h("em", {}, d.tag) : null)));
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
      ...titles.map((x, i) => h("p", { class: "tpv__t" + (i ? " is-2" : "") }, x.v || "…")),
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

function textsSection({ draft, dirty }) {
  const wrap = h("div", { class: "stack" });
  TEXT_GROUPS.forEach(([title, desc, fields], i) => {
    const pv = textPreview(draft, fields);
    const grid = h("div", { class: "grid2" }, fields.map(([path, label, long]) =>
      field({ label, long, rows: 3, value: get(draft, path), onInput: (v) => { set(draft, path, v); dirty(); pv.update(); } })));
    // un acordeón: se abre una parte de la web por vez (no hay que recorrer ~30 campos seguidos)
    wrap.append(h("details", { class: "fold", name: "textos", open: i === 0 },
      h("summary", {}, h("span", { class: "fold__t" }, h("h3", {}, title), desc ? h("small", {}, desc) : null), h("span", { class: "fold__n" }, `${fields.length} campos`)),
      h("div", { class: "fold__body" }, title === "Menú superior" ? h("div", {}) : pv.el, grid)));
  });
  wrap.append(group("Franja de datos", "Las frases cortas que aparecen debajo del bloque \"Conectamos caminos\" (por ejemplo \"Todos los días\").",
    listEditor({ id: "facts", items: draft.texts.facts, onChange: dirty, addLabel: "Agregar frase", make: () => "", max: 6, title: (_, i) => `Frase ${i + 1}`,
      render: (it, i) => field({ label: "Texto", value: it, onInput: (v) => { draft.texts.facts[i] = v; dirty(); } }) })));
  return wrap;
}

/* ---------- a dónde lleva un botón: se elige, no se escribe ---------- */
const LINKS = [["#horarios", "Horarios"], ["#destinos", "Destinos"], ["#reservar", "Reservar un pasaje"], ["#antes", "Antes de viajar"], ["#contacto", "Contacto"]];
function linkPicker(c, draft, dirty) {
  const kind = () => { const v = c.href || ""; return LINKS.some(([x]) => x === v) ? v : /^tel:/.test(v) ? "tel" : /wa\.me\//.test(v) ? "wa" : "web"; };
  const sel = h("select", { "aria-label": "A dónde lleva el botón" },
    ...LINKS.map(([v, l]) => h("option", { value: v }, l)),
    h("option", { value: "wa" }, "El WhatsApp de la empresa"), h("option", { value: "tel" }, "Llamar por teléfono"), h("option", { value: "web" }, "Otra página web"));
  sel.value = kind();
  const extra = h("div", { class: "linkx" });
  const drawExtra = () => {
    const k = sel.value; extra.replaceChildren();
    if (k === "web") extra.append(field({ label: "Dirección de la página", value: c.href, mono: true, hint: "Completa, por ejemplo https://www.ejemplo.com", validate: (v) => (/^https?:\/\/\S+\.\S+/.test(v.trim()) ? "" : "Escribila completa, empezando con https://"), onInput: (v) => { c.href = v.trim(); dirty(); } }));
    if (k === "tel") extra.append(field({ label: "Teléfono", value: String(c.href || "").replace(/^tel:/, ""), mono: true, hint: "Con código de país, por ejemplo +543884254331", validate: (v) => (v.replace(/\D/g, "").length >= 8 ? "" : "Escribí el teléfono completo."), onInput: (v) => { c.href = "tel:" + v.replace(/[^\d+]/g, ""); dirty(); } }));
  };
  sel.addEventListener("change", () => {
    const k = sel.value;
    if (LINKS.some(([x]) => x === k)) { c.href = k; c.external = false; }
    else if (k === "wa") { c.href = `https://wa.me/${draft.site.whatsapp}`; c.external = true; }
    else if (k === "tel") { if (!/^tel:/.test(c.href)) c.href = `tel:${draft.site.phoneTel || ""}`; c.external = false; }
    else { if (!/^https?:/.test(c.href)) c.href = "https://"; c.external = true; }
    dirty(); drawExtra();
  });
  drawExtra();
  return h("div", { class: "field" }, h("label", {}, "A dónde lleva el botón"), sel, extra);
}

/* ---------- hero (textos) ---------- */
function heroSection(ctx) {
  const { draft, dirty } = ctx; const hero = draft.hero;
  return h("div", { class: "stack" },
    group("Titular de entrada", "Lo primero que se ve al abrir la web.", h("div", { class: "grid2" },
      field({ label: "Titular", value: hero.headline, validate: (v) => (v.trim() ? "" : "Falta el titular. Es la frase grande de la portada."), onInput: (v) => { hero.headline = v; dirty(); } }),
      field({ label: "Bajada", value: hero.subheadline, onInput: (v) => { hero.subheadline = v; dirty(); } }),
      field({ label: "Invitación a scrollear", value: hero.hint, onInput: (v) => { hero.hint = v; dirty(); } }))),
    group("Botones de la portada", "Los botones que van debajo del titular. Elegí qué dice cada uno y a dónde lleva.",
      listEditor({ id: "ctas", items: hero.ctas, onChange: dirty, addLabel: "Agregar botón", max: 3, min: 1, make: () => ({ label: "Nuevo botón", href: "#horarios" }), title: (c) => c.label || "Botón",
        render: (c) => h("div", {},
          h("div", { class: "grid2" },
            field({ label: "Texto del botón", value: c.label, onInput: (v) => { c.label = v; dirty(); } }),
            linkPicker(c, draft, dirty)),
          h("div", { class: "checks" },
            check({ label: "Botón principal (amarillo)", value: c.primary, onChange: (v) => { c.primary = v; dirty(); } }),
            check({ label: "Abre en otra pestaña", value: c.external, onChange: (v) => { c.external = v; dirty(); } }))) })),
    group("Textos de cada etapa del viaje", hero.frames ? "Cada etapa corresponde a uno de los videos que se subieron. Para agregar o quitar etapas, subí el video de nuevo (abajo)." : "Cada etapa corresponde a uno de los 5 videos originales. Para cambiar la cantidad de etapas, subí un video nuevo (abajo).",
      h("div", { class: "list" }, hero.etapas.map((e, i) => h("div", { class: "item" },
        h("div", { class: "item__bar" }, h("strong", {}, `Etapa ${i + 1}`)),
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
export function nextDepartures(routes, n = 4) {
  const now = nowMin();
  const all = routes.flatMap((r) => (r.times || []).map((t) => ({ t, m: +t.slice(0, 2) * 60 + +t.slice(3), r }))).sort((a, b) => a.m - b.m);
  const next = all.filter((x) => x.m >= now);
  return { list: (next.length ? next : all).slice(0, n), tomorrow: !next.length };
}
// lugares que existen en Horarios (para avisar si un destino no coincide con ninguno)
const placeList = (d) => [...new Set(d.routes.flatMap((r) => [r.from, r.to, ...(r.stops || [])]).map((x) => String(x || "").replace(/\*/g, "").trim()).filter(Boolean))];
const normPlace = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const knownPlace = (d, name) => placeList(d).some((p) => normPlace(p) === normPlace(name));
const setDays = (r, days) => { if (days && Object.keys(days).length) r.days = days; else delete r.days; };
const hhmm = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String((((m % 60) + 60) % 60)).padStart(2, "0")}`;
// "14:30", "14.30" o "1430" -> "14:30" (o null si no es una hora)
const readTime = (s) => { const m = String(s).trim().match(/^(\d{1,2})[:.]?(\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : null; };

// Horas como fichas sobre el tablero oscuro. Tocar una abre una ventanita pegada a ella (sin mover las demás).
function timesBoard(r, onChange, others) {
  const chips = h("div", { class: "tb__chips" });
  const count = h("small", { class: "tb__count" });
  const err = h("small", { class: "err", role: "alert" });
  const ta = h("textarea", { rows: 3, class: "mono", "aria-label": "Horarios escritos a mano" }, timesToText(r));
  let open = -1, refocus = null;

  const changed = () => { r._bad = undefined; r.times = [...new Set(r.times)].sort(); ta.value = timesToText(r); err.textContent = ""; onChange(); draw(); };
  const snap = () => ({ times: [...r.times], days: r.days ? { ...r.days } : undefined });
  const restore = (s) => { r.times = s.times; setDays(r, s.days); changed(); };
  const undoable = (msg, fn) => { const s = snap(); fn(); toast(msg, "ok", 8000, { label: "Deshacer", run: () => restore(s) }); };

  const cell = (t, i) => {
    const btn = h("button", { type: "button", class: "tb__chip" + (open === i ? " is-open" : ""), "aria-expanded": String(open === i), "aria-haspopup": "dialog", title: "Tocá para cambiar la hora o quitarla",
      onclick: () => { if (open === i) refocus = t; open = open === i ? -1 : i; draw(); } }, t, r.days?.[t] && h("em", {}, r.days[t]));
    if (open !== i) return h("span", { class: "tb__cell" }, btn);

    const tIn = h("input", { type: "text", inputmode: "numeric", value: t, maxlength: 5, "aria-label": "Hora de salida" });
    const dIn = h("input", { type: "text", value: r.days?.[t] || "", placeholder: "Todos los días", "aria-label": "Días en que sale (ejemplo: mar · jue · vie)" });
    const pErr = h("small", { class: "err", role: "alert" });
    const done = () => {
      const nt = readTime(tIn.value); if (!nt) { pErr.textContent = `No entiendo "${tIn.value}". Escribí una hora como 14:30.`; tIn.focus(); return; }
      const days = { ...(r.days || {}) }; delete days[t];
      const d = dIn.value.replace(/[()]/g, "").trim(); if (d) days[nt] = d;
      r.times[i] = nt; setDays(r, days); open = -1; refocus = nt; changed();
    };
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
    chips.replaceChildren(...(r.times.length ? r.times.map(cell) : [h("em", { class: "tb__empty" }, "Todavía no hay horarios. Escribí el primero abajo.")]));
    count.textContent = `${r.times.length} ${r.times.length === 1 ? "salida" : "salidas"} por día`;
    if (refocus != null) { const c = [...chips.querySelectorAll(".tb__chip")]; (c.find((x) => x.textContent.startsWith(refocus)) || c[0])?.focus(); refocus = null; }
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

/* ---------- horarios ---------- */
function routesSection({ draft, dirty: baseDirty }) {
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
    render: (r) => h("div", { class: "svc" },
      // lo que más se hace (las horas) va primero; los datos del servicio quedan plegados
      h("div", { class: "field" }, h("label", { class: "sr-only" }, "Horarios de salida"), timesBoard(r, dirty, () => routes.filter((x) => x !== r))),
      h("details", { class: "adv svc__more", open: !(r.from && r.to) }, h("summary", {}, "Datos del servicio (de dónde sale, a dónde llega y paradas)"),
        h("div", { class: "svc__fields" },
          h("div", { class: "grid2" },
            field({ label: "Sale desde (origen)", value: r.from, hint: "Elegí uno existente o escribí uno nuevo.", list: "origins-dl", validate: (v) => (v.trim() ? "" : "Falta el origen. Escribí de dónde sale, por ejemplo San Salvador de Jujuy."), onInput: (v) => { r.from = v; dirty(); } }),
            field({ label: "Nombre del servicio", value: r.service, hint: "Por ejemplo: Ruta 9", onInput: (v) => { r.service = v; dirty(); } }),
            field({ label: "Destino final (se ve en el tablero)", help: "Si no todas las salidas llegan hasta el final, escribí un asterisco al terminar (La Quiaca*) y explicalo en la Nota.", value: r.to, hint: "Podés terminar con * si no todas las salidas llegan hasta ahí.", validate: (v) => (v.trim() ? "" : "Falta el destino final. Escribí a dónde llega, por ejemplo La Quiaca."), onInput: (v) => { r.to = v; dirty(); } }),
            field({ label: "Pueblos del camino (texto del tablero)", help: "Es lo que se lee en el tablero debajo del destino, por ejemplo: Tilcara · Humahuaca. Es solo un texto: las paradas reales se cargan más abajo.", value: r.via, hint: "Opcional. Por ejemplo: Tilcara · Humahuaca.", onInput: (v) => { r.via = v; dirty(); } })),
          field({ label: "Paradas, en orden de viaje", value: stopsToText(r), long: true, rows: 2, hint: "Separadas por coma. Son los lugares a los que se puede viajar con este servicio.", validate: (v) => (parseStops(v).length ? "" : "Agregá al menos una parada."), onInput: (v) => { r.stops = parseStops(v); dirty(); } }),
          field({ label: "Nota (se muestra debajo)", long: true, rows: 2, value: r.note, onInput: (v) => { r.note = v; dirty(); } })))),
  });
  board = departuresBoard(routes);
  return h("div", { class: "stack" }, dl,
    groupAside("Tus servicios", `${routes.length} servicios, ${routes.reduce((n, r) => n + (r.times?.length || 0), 0)} salidas por día. Buscá el servicio y tocá una hora para cambiarla.`, board.el, list));
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
            field({ label: "Nombre", value: d.name, list: "places-dl", validate: (v) => (!v.trim() ? "Falta el nombre. Escribí el del lugar, por ejemplo Tilcara." : knownPlace(draft, v) ? "" : "Este nombre no coincide con ninguna parada de Horarios: el botón «Ver horarios» no va a encontrar salidas."), onInput: (v) => { d.name = v; dirty(); } }),
            field({ label: "Zona (ej. Quebrada)", help: "Es la palabra chica que aparece sobre el nombre en la tarjeta del destino. Por ejemplo: Quebrada, Valle o Puna.", value: d.tag, onInput: (v) => { d.tag = v; dirty(); } })),
          field({ label: "Descripción corta", long: true, rows: 2, value: d.text, onInput: (v) => { d.text = v; dirty(); } }))) })));
}

/* ---------- galeria de la grilla animada + a bordo ---------- */
function galleryStatus(n) {
  if (n < 6) return { ok: false, msg: `Hay ${n} fotos. Necesitás al menos 6.` };
  if (n > 15) return { ok: false, msg: `Hay ${n} fotos. El máximo es 15.` };
  if (n % 3) return { ok: false, msg: `Hay ${n} fotos. Para que la grilla quede completa tiene que ser un múltiplo de 3: agregá ${3 - (n % 3)} más o quitá ${n % 3}.` };
  return { ok: true, msg: `${n} fotos: la grilla queda completa.` };
}
function gallerySection({ draft, dirty }) {
  const status = h("p", { class: "status" });
  const upd = () => { const s = galleryStatus(draft.gallery.length); status.textContent = s.msg; status.className = "status " + (s.ok ? "is-ok" : "is-bad"); };
  upd();
  return h("div", { class: "stack" },
    group("Galería animada de la web", "Son las fotos que entran y se agrandan en el bloque \"Conectamos caminos\". Tienen que ser un múltiplo de 3 (6, 9, 12 o 15).", status,
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
    group("Servicios a bordo", "La lista junto a la foto.",
      listEditor({ id: "services", items: draft.services, onChange: dirty, addLabel: "Agregar servicio", max: 10, title: (s) => s[0] || "Servicio", make: () => ["", ""],
        render: (s) => h("div", { class: "grid2" },
          field({ label: "Nombre", value: s[0], onInput: (v) => { s[0] = v; dirty(); } }),
          field({ label: "Detalle", value: s[1], onInput: (v) => { s[1] = v; dirty(); } })) })));
}

/* ---------- contacto ---------- */
function contactSection({ draft, dirty: baseDirty }) {
  const site = draft.site;
  const cpv = contactPreview(site);
  const dirty = () => { baseDirty(); cpv.update(); };
  return h("div", { class: "stack" },
    groupAside("Datos de contacto", "", cpv.el, h("div", { class: "grid2" },
      field({ label: "WhatsApp (solo números, con código de país)", help: "Es el número al que escriben los pasajeros. Va sin signos ni espacios: 54, después el 9 y el número con código de área, sin el 0 ni el 15.", value: site.whatsapp, mono: true, hint: "Ejemplo: 5493884640178", validate: (v) => (/^\d{10,15}$/.test(v.replace(/\D/g, "")) ? "" : "Tiene que tener entre 10 y 15 números."), onInput: (v) => { site.whatsapp = v.replace(/\D/g, ""); dirty(); } }),
      field({ label: "Teléfono central", value: site.phoneLabel, hint: "Con código de área, por ejemplo 0388 425-4331. El botón \"Llamar\" se arma solo.", validate: (v) => (v.replace(/\D/g, "").length >= 8 ? "" : "Escribí el teléfono con código de área."),
        onInput: (v) => { site.phoneLabel = v; const d = v.replace(/\D/g, "").replace(/^0/, ""); site.phoneTel = d ? "+" + (d.startsWith("54") ? d : "54" + d) : ""; dirty(); } }),
      field({ label: "Título de la pestaña (arriba, en el navegador)", help: "Es el texto que se ve en la pestaña del navegador y cuando alguien busca la empresa en Google.", value: site.title, onInput: (v) => { site.title = v; dirty(); } })),
      field({ label: "Dirección (abajo de la página)", long: true, rows: 2, value: site.address, onInput: (v) => { site.address = v; dirty(); } }),
      field({ label: "Texto chico de abajo de la página", help: "Una línea chica que aparece al final de toda la web.", long: true, rows: 2, value: site.footerNote, onInput: (v) => { site.footerNote = v; dirty(); } })),
    group("Boleterías", "El listado de teléfonos de la sección Contacto.",
      listEditor({ id: "boleterias", items: draft.boleterias, onChange: dirty, addLabel: "Agregar boletería", max: 20, title: (b) => b.name || "Boletería", sub: (b) => b.tel, make: () => ({ name: "", tel: "" }),
        render: (b) => h("div", { class: "grid3" },
          field({ label: "Localidad", value: b.name, onInput: (v) => { b.name = v; dirty(); } }),
          field({ label: "Teléfono", value: b.tel, onInput: (v) => { b.tel = v; dirty(); } }),
          field({ label: "Detalle (opcional)", value: b.sub || "", onInput: (v) => { if (v) b.sub = v; else delete b.sub; dirty(); } })) })),
    group("Asistente de voz (avanzado)", "Identificador del agente de ElevenLabs que atiende las llamadas. No lo cambies si no estás seguro.",
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
function historySection({ draft, replaceDraft }) {
  const box = h("div", { class: "list" }, h("p", { class: "empty" }, "Cargando…"));
  listHistory().then((rows) => {
    box.replaceChildren();
    if (!rows.length) return box.append(h("p", { class: "empty" }, "Todavía no hay versiones anteriores. Aparecen acá cada vez que guardás."));
    rows.forEach((r) => box.append(h("div", { class: "item item--row" },
      h("div", {}, h("strong", {}, new Date(r.saved_at).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" })), h("small", { class: "hint" }, "Versión anterior de la web")),
      h("button", { type: "button", class: "btn btn--ghost", onclick: async () => {
        if (await confirmBox("Se va a cargar esta versión en el editor. No se publica hasta que toques \"Guardar y publicar\". ¿Seguir?", "Cargar versión")) { replaceDraft(r.data); toast("Versión cargada en el editor. Revisala y guardá para publicarla."); }
      } }, "Cargar en el editor"))));
  }).catch((e) => { box.replaceChildren(h("p", { class: "err" }, e.message)); });
  return h("div", { class: "stack" }, group("Versiones anteriores", "Las últimas versiones publicadas. Si algo salió mal, podés volver atrás.", box));
}

/* ---------- resumen: lo que le sirve al dueño al entrar ---------- */
export const fmtDate = (d) => new Date(d).toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" });

function summarySection({ draft, goto, lastPublished }) {
  const errs = validate(draft);
  const nd = nextDepartures(draft.routes, 4);
  const board = h("div", { class: "board" }, nd.list.length
    ? nd.list.map((x, i) => h("div", { class: "board__line" + (i === 0 ? " is-next" : "") },
      h("span", { class: "board__time" }, x.t, x.r.days?.[x.t] ? "*" : ""),
      h("span", { class: "board__dest" }, h("strong", {}, `${x.r.from || "Origen"} → ${x.r.to || "Destino"}`), x.r.service && h("small", {}, x.r.service))))
    : h("p", { class: "empty" }, "Todavía no hay horarios cargados."));
  const more = (label, id, ico) => h("button", { type: "button", class: "morelink", onclick: () => goto(id) }, icon(ico, 18), label, icon("arrow", 16));
  const lp = lastPublished();
  return h("div", { class: "stack" },
    group(nd.tomorrow ? "Primeras salidas de mañana" : "Próximas salidas", "Así las ve el pasajero ahora mismo en la web.", board),
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
        : h("p", { class: "okline" }, icon("check", 18), "No hay nada pendiente de revisar.")));
}

/* varias pantallas en una: junta las secciones de cada una */
const together = (...fns) => (ctx) => h("div", { class: "stack" }, fns.flatMap((f) => [...f(ctx).children]));

export const SECTIONS = [
  { id: "resumen", label: "Resumen", group: "Inicio", desc: "Lo que pasa hoy en tu web.", help: ["Mirá las próximas salidas: son las que el pasajero ve ahora.", "Tocá \"Cambiar un horario\" para editar las salidas.", "Cuando termines, tocá \"Guardar y publicar\" (o Ctrl+S)."], render: summarySection },
  { id: "hero", label: "Portada y video", group: "Portada", desc: "El titular, los botones y el video de la primera pantalla.", help: ["Cambiá el titular y los botones de arriba.", "Para un video nuevo, subí un video por cada etapa del viaje, en orden.", "Generá el video, revisá la vista previa y tocá \"Usar este video\".", "Guardá y publicá."], render: heroSection },
  { id: "textos", label: "Textos de la web", group: "Portada", desc: "Menú, títulos y frases de cada parte de la web.", help: ["Buscá la parte de la web que querés cambiar.", "Escribí el texto nuevo.", "Guardá y publicá."], render: textsSection },
  { id: "horarios", label: "Horarios de salida", group: "Viajes", desc: "Las salidas que ve el pasajero. Tocá una hora para cambiarla.", help: ["Buscá el servicio en la lista.", "Tocá una hora para cambiarla o quitarla. Para sumar, escribí la hora abajo (podés pegar varias).", "En \"Correr o copiar horarios\" podés correr todas las horas, copiarlas de otro servicio o poner los días de todas.", "Guardá y publicá. Si te equivocás, tocá \"Deshacer\"."], render: routesSection },
  { id: "destinos", label: "Destinos", group: "Viajes", desc: "Los lugares a los que viaja la empresa.", help: ["Elegí la foto con \"Cambiar imagen\": se achica sola.", "Corregí el nombre y la descripción.", "El nombre tiene que ser igual a una parada de Horarios.", "Guardá y publicá."], render: destinationsSection },
  { id: "galeria", label: "Fotos", group: "Contenido", desc: "Fotos de la galería animada y de \"A bordo\".", help: ["Cambiá una foto con \"Cambiar imagen\": se achica sola.", "La galería necesita 6, 9, 12 o 15 fotos.", "Guardá y publicá."], render: together(gallerySection, boardSection) },
  { id: "contacto", label: "Contacto y preguntas", group: "Contenido", desc: "Teléfonos, WhatsApp, boleterías y preguntas frecuentes.", help: ["Corregí el dato que cambió.", "Los números se revisan solos al salir del campo.", "Guardá y publicá."], render: together(contactSection, faqSection) },
  { id: "historial", label: "Versiones anteriores", group: "Avanzado", desc: "Versiones anteriores de la web, por si hay que volver atrás.", help: ["Elegí una versión de la lista.", "Tocá \"Cargar en el editor\" y revisala.", "Si está bien, tocá \"Guardar y publicar\"."], render: historySection },
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
  const ci = d.hero.ctas.findIndex((c) => !(c.label?.trim() && c.href?.trim()));
  if (ci >= 0) add("hero", "Portada: hay botones sin texto o sin enlace.", { item: ci, list: "ctas", field: "Texto del botón" });
  return e;
}
export const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith("_") ? undefined : v)));
