import { h, field, check, group, listEditor, imageField, confirmBox, toast } from "./ui.js";
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

/* ---------- textos: esquema de campos ---------- */
const TEXT_GROUPS = [
  ["Menú superior", "Los nombres de los enlaces de arriba.", [["texts.nav.horarios", "Horarios"], ["texts.nav.destinos", "Destinos"], ["texts.nav.reservar", "Reservar"], ["texts.nav.antes", "Antes de viajar"], ["texts.nav.contacto", "Contacto"]]],
  ["Bloque \"Conectamos caminos\"", "El título grande que aparece después del hero, con el párrafo y el botón.", [["texts.grid.a", "Título, primera línea (blanca)"], ["texts.grid.b", "Título, segunda línea (amarilla)"], ["texts.grid.text", "Párrafo", true], ["texts.grid.button", "Texto del botón"]]],
  ["Sección Horarios", "Título y rótulos del tablero de salidas.", [["texts.horarios.a", "Título, primera línea"], ["texts.horarios.b", "Título, segunda línea (gris)"], ["texts.horarios.all", "Subtítulo de \"todas las salidas\""], ["texts.horarios.clock", "Texto junto al reloj"]]],
  ["Sección Destinos", "", [["texts.destinos.a", "Título, primera línea"], ["texts.destinos.b", "Título, segunda línea (gris)"]]],
  ["Sección El viaje", "La animación del bus por la Ruta 9.", [["texts.viaje.hint", "Invitación a scrollear"], ["texts.viaje.cta", "Botón del final"]]],
  ["Sección Reserva", "", [["texts.reservar.a", "Título, primera línea"], ["texts.reservar.b", "Título, segunda línea (gris)"], ["texts.reservar.legal", "Aviso legal (debajo del formulario)", true]]],
  ["Sección A bordo", "", [["texts.abordo.a", "Título, primera línea"], ["texts.abordo.b", "Título, segunda línea (gris)"]]],
  ["Sección Antes de viajar", "", [["texts.antes.a", "Título, primera línea"], ["texts.antes.b", "Título, segunda línea (gris)"]]],
  ["Sección Contacto", "", [["texts.contacto.a", "Título, primera línea"], ["texts.contacto.b", "Título, segunda línea (gris)"], ["texts.contacto.call", "Botón de llamar"], ["texts.contacto.wa", "Botón de WhatsApp"], ["texts.contacto.central", "Rótulo del teléfono central"]]],
];

function textsSection({ draft, dirty }) {
  const wrap = h("div", { class: "stack" });
  for (const [title, desc, fields] of TEXT_GROUPS) {
    wrap.append(group(title, desc, h("div", { class: "grid2" }, fields.map(([path, label, long]) =>
      field({ label, long, rows: 3, value: get(draft, path), onInput: (v) => { set(draft, path, v); dirty(); } })))));
  }
  wrap.append(group("Franja de datos", "Las frases cortas que aparecen debajo del bloque \"Conectamos caminos\" (por ejemplo \"Todos los días\").",
    listEditor({ items: draft.texts.facts, onChange: dirty, addLabel: "Agregar frase", make: () => "", max: 6, title: (_, i) => `Frase ${i + 1}`,
      render: (it, i) => field({ label: "Texto", value: it, onInput: (v) => { draft.texts.facts[i] = v; dirty(); } }) })));
  return wrap;
}

/* ---------- hero (textos) ---------- */
function heroSection(ctx) {
  const { draft, dirty } = ctx; const hero = draft.hero;
  return h("div", { class: "stack" },
    group("Titular de entrada", "Lo primero que se ve al abrir la web.", h("div", { class: "grid2" },
      field({ label: "Titular", value: hero.headline, onInput: (v) => { hero.headline = v; dirty(); } }),
      field({ label: "Bajada", value: hero.subheadline, onInput: (v) => { hero.subheadline = v; dirty(); } }),
      field({ label: "Invitación a scrollear", value: hero.hint, onInput: (v) => { hero.hint = v; dirty(); } }))),
    group("Botones de la portada", "Los botones debajo del titular. El enlace puede ser una sección (#horarios), una web (https://…) o un teléfono (tel:+54…).",
      listEditor({ items: hero.ctas, onChange: dirty, addLabel: "Agregar botón", max: 3, min: 1, make: () => ({ label: "Nuevo botón", href: "#horarios" }), title: (c) => c.label || "Botón",
        render: (c) => h("div", {},
          h("div", { class: "grid2" },
            field({ label: "Texto del botón", value: c.label, onInput: (v) => { c.label = v; dirty(); } }),
            field({ label: "Enlace", value: c.href, mono: true, onInput: (v) => { c.href = v; dirty(); } })),
          h("div", { class: "checks" },
            check({ label: "Botón principal (amarillo)", value: c.primary, onChange: (v) => { c.primary = v; dirty(); } }),
            check({ label: "Abre en otra pestaña", value: c.external, onChange: (v) => { c.external = v; dirty(); } }))) })),
    group("Textos de cada tramo del viaje", hero.frames ? "Cada tramo corresponde a uno de los videos que se subieron. Para agregar o quitar tramos, subí el video de nuevo (abajo)." : "Cada tramo corresponde a uno de los 5 videos originales. Para cambiar la cantidad de tramos, subí un video nuevo (abajo).",
      h("div", { class: "list" }, hero.etapas.map((e, i) => h("div", { class: "item" },
        h("div", { class: "item__bar" }, h("strong", {}, `Tramo ${i + 1}`)),
        h("div", { class: "grid3" },
          field({ label: "Título grande", value: e.title, onInput: (v) => { e.title = v; dirty(); } }),
          field({ label: "Detalle", value: e.detail, onInput: (v) => { e.detail = v; dirty(); } }),
          field({ label: "Rótulo corto (barra inferior)", value: e.rail, onInput: (v) => { e.rail = v; dirty(); } })))))),
    group("Cierre del hero", "Lo que aparece al terminar el recorrido, junto al buscador de horarios.", h("div", { class: "grid2" },
      field({ label: "Título", value: hero.cierre.title, onInput: (v) => { hero.cierre.title = v; dirty(); } }),
      field({ label: "Texto", long: true, rows: 2, value: hero.cierre.text, onInput: (v) => { hero.cierre.text = v; dirty(); } }))),
    heroVideoTool(ctx));
}

/* ---------- horarios ---------- */
function routesSection({ draft, dirty }) {
  const routes = draft.routes;
  const origins = () => [...new Set(routes.map((r) => r.from).filter(Boolean))];
  const dl = h("datalist", { id: "origins-dl" }, origins().map((o) => h("option", { value: o })));
  const list = listEditor({
    items: routes, onChange: () => { dirty(); dl.replaceChildren(...origins().map((o) => h("option", { value: o }))); },
    addLabel: "Agregar servicio", empty: "No hay servicios cargados.",
    make: () => ({ id: "r" + Math.random().toString(36).slice(2, 7), from: origins()[0] || "", to: "", via: "", service: "", stops: [], times: [], note: "" }),
    title: (r) => `${r.from || "Origen"} → ${r.to || "Destino"}${r.service ? " · " + r.service : ""}`,
    render: (r) => {
      const err = h("small", { class: "err" }); const cnt = h("small", { class: "hint" });
      const showTimes = (bad) => { err.textContent = bad.length ? `No se entiende: ${bad.join(", ")}. Formato: 06:15, 09:00` : ""; cnt.textContent = `${r.times.length} salidas por día`; r._bad = bad.length ? bad : undefined; };
      const ta = h("textarea", { id: "t" + Math.random().toString(36).slice(2, 6), rows: 4, class: "mono" }, timesToText(r));
      ta.addEventListener("input", () => { const p = parseTimes(ta.value); if (!p.bad.length) { r.times = p.times; r.days = p.days; if (!p.days) delete r.days; } showTimes(p.bad); dirty(); });
      showTimes([]);
      return h("div", {},
        h("div", { class: "grid2" },
          field({ label: "Sale desde (origen)", value: r.from, hint: "Elegí uno existente o escribí uno nuevo.", list: "origins-dl", onInput: (v) => { r.from = v; dirty(); } }),
          field({ label: "Nombre del servicio", value: r.service, hint: "Por ejemplo: Ruta 9", onInput: (v) => { r.service = v; dirty(); } }),
          field({ label: "Destino final (se ve en el tablero)", value: r.to, hint: "Podés terminar con * si no todas las salidas llegan hasta ahí.", onInput: (v) => { r.to = v; dirty(); } }),
          field({ label: "Pasando por", value: r.via, onInput: (v) => { r.via = v; dirty(); } })),
        field({ label: "Paradas, en orden de viaje", value: stopsToText(r), long: true, rows: 2, hint: "Separadas por coma. Son los lugares a los que se puede viajar con este servicio.", onInput: (v) => { r.stops = parseStops(v); dirty(); } }),
        h("div", { class: "field" }, h("label", {}, "Horarios de salida"), ta,
          h("small", { class: "hint" }, "Separados por coma. Si una salida solo va ciertos días, agregalo entre paréntesis: 14:15 (mar · jue · vie)."), cnt, err),
        field({ label: "Nota (se muestra debajo)", long: true, rows: 2, value: r.note, onInput: (v) => { r.note = v; dirty(); } }));
    },
  });
  return h("div", { class: "stack" }, dl,
    group("Servicios y horarios", "Cada servicio es un origen, sus paradas y sus horarios de salida. El tablero y el buscador de la web se arman solos con esto.", list));
}

/* ---------- destinos ---------- */
function destinationsSection({ draft, dirty }) {
  return h("div", { class: "stack" }, group("Tarjetas de destinos", "Las tarjetas que se deslizan en la sección \"Del valle al altiplano\". El nombre tiene que coincidir con una localidad de los horarios para que el botón \"Ver horarios\" funcione.",
    listEditor({ items: draft.destinations, onChange: dirty, addLabel: "Agregar destino", min: 1, max: 14, title: (d) => d.name || "Destino",
      make: () => ({ name: "", tag: "", text: "", image: "" }),
      render: (d) => h("div", { class: "split" },
        imageField({ label: "Foto", url: d.image, maxWidth: 1100, hint: "Se optimiza sola. Mejor si es vertical o cuadrada.", onChange: (u) => { d.image = u; dirty(); } }),
        h("div", {},
          h("div", { class: "grid2" },
            field({ label: "Nombre", value: d.name, onInput: (v) => { d.name = v; dirty(); } }),
            field({ label: "Etiqueta (ej. Quebrada)", value: d.tag, onInput: (v) => { d.tag = v; dirty(); } })),
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
    group("Fotos de la grilla animada", "Son las fotos que entran y se agrandan en el bloque \"Conectamos caminos\". Tienen que ser un múltiplo de 3 (6, 9, 12 o 15).", status,
      listEditor({ items: draft.gallery, onChange: () => { upd(); dirty(); }, addLabel: "Agregar foto", max: 15, min: 6, title: (g, i) => g.caption || `Foto ${i + 1}`,
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
      listEditor({ items: draft.services, onChange: dirty, addLabel: "Agregar servicio", max: 10, title: (s) => s[0] || "Servicio", make: () => ["", ""],
        render: (s) => h("div", { class: "grid2" },
          field({ label: "Nombre", value: s[0], onInput: (v) => { s[0] = v; dirty(); } }),
          field({ label: "Detalle", value: s[1], onInput: (v) => { s[1] = v; dirty(); } })) })));
}

/* ---------- contacto ---------- */
function contactSection({ draft, dirty }) {
  const site = draft.site;
  return h("div", { class: "stack" },
    group("Datos de contacto", "", h("div", { class: "grid2" },
      field({ label: "WhatsApp (solo números, con código de país)", value: site.whatsapp, mono: true, hint: "Ejemplo: 5493884640178", onInput: (v) => { site.whatsapp = v.replace(/\D/g, ""); dirty(); } }),
      field({ label: "Teléfono central (como se muestra)", value: site.phoneLabel, onInput: (v) => { site.phoneLabel = v; dirty(); } }),
      field({ label: "Teléfono central (para llamar)", value: site.phoneTel, mono: true, hint: "Ejemplo: +543884254331", onInput: (v) => { site.phoneTel = v.replace(/[^\d+]/g, ""); dirty(); } }),
      field({ label: "Título de la pestaña del navegador", value: site.title, onInput: (v) => { site.title = v; dirty(); } })),
      field({ label: "Dirección (pie de página)", long: true, rows: 2, value: site.address, onInput: (v) => { site.address = v; dirty(); } }),
      field({ label: "Texto legal del pie", long: true, rows: 2, value: site.footerNote, onInput: (v) => { site.footerNote = v; dirty(); } })),
    group("Boleterías", "El listado de teléfonos de la sección Contacto.",
      listEditor({ items: draft.boleterias, onChange: dirty, addLabel: "Agregar boletería", max: 20, title: (b) => b.name || "Boletería", make: () => ({ name: "", tel: "" }),
        render: (b) => h("div", { class: "grid3" },
          field({ label: "Localidad", value: b.name, onInput: (v) => { b.name = v; dirty(); } }),
          field({ label: "Teléfono", value: b.tel, onInput: (v) => { b.tel = v; dirty(); } }),
          field({ label: "Detalle (opcional)", value: b.sub || "", onInput: (v) => { if (v) b.sub = v; else delete b.sub; dirty(); } })) })),
    group("Asistente de voz (avanzado)", "Identificador del agente de ElevenLabs que atiende las llamadas. No lo cambies si no estás seguro.",
      field({ label: "ID del agente", value: site.agentId, mono: true, onInput: (v) => { site.agentId = v.trim(); dirty(); } })));
}

/* ---------- preguntas ---------- */
function faqSection({ draft, dirty }) {
  return h("div", { class: "stack" }, group("Preguntas frecuentes", "Se despliegan en la sección \"Lo que conviene saber\".",
    listEditor({ items: draft.faq, onChange: dirty, addLabel: "Agregar pregunta", max: 30, title: (f) => f[0] || "Pregunta", make: () => ["", ""],
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

export const SECTIONS = [
  { id: "hero", label: "Inicio y hero", render: heroSection },
  { id: "textos", label: "Textos de la web", render: textsSection },
  { id: "horarios", label: "Horarios y servicios", render: routesSection },
  { id: "destinos", label: "Destinos", render: destinationsSection },
  { id: "galeria", label: "Fotos de la grilla", render: gallerySection },
  { id: "abordo", label: "A bordo", render: boardSection },
  { id: "contacto", label: "Contacto y boleterías", render: contactSection },
  { id: "preguntas", label: "Preguntas frecuentes", render: faqSection },
  { id: "historial", label: "Historial", render: historySection },
];

/* ---------- validacion antes de publicar ---------- */
export function validate(d) {
  const e = [];
  const phoneOk = (s) => /\d{6,}/.test(String(s).replace(/\D/g, ""));
  d.routes.forEach((r, i) => {
    const n = `Horarios · servicio ${i + 1}`;
    if (!r.from?.trim()) e.push(`${n}: falta el origen.`);
    if (!r.to?.trim()) e.push(`${n}: falta el destino final.`);
    if (!r.stops?.length) e.push(`${n}: agregá al menos una parada.`);
    if (r._bad) e.push(`${n}: hay horarios mal escritos (${r._bad.join(", ")}).`);
    else if (!r.times?.length) e.push(`${n}: agregá al menos un horario.`);
  });
  const g = galleryStatus(d.gallery.length); if (!g.ok) e.push("Fotos de la grilla: " + g.msg);
  d.gallery.forEach((x, i) => { if (!x.src) e.push(`Fotos de la grilla: a la foto ${i + 1} le falta la imagen.`); });
  d.destinations.forEach((x, i) => { if (!x.name?.trim()) e.push(`Destinos: al destino ${i + 1} le falta el nombre.`); if (!x.image) e.push(`Destinos: a "${x.name || i + 1}" le falta la foto.`); });
  d.boleterias.forEach((b, i) => { if (!b.name?.trim() || !phoneOk(b.tel)) e.push(`Contacto: revisá la boletería ${i + 1} (localidad y teléfono).`); });
  if (!/^\d{10,15}$/.test(d.site.whatsapp)) e.push("Contacto: el WhatsApp tiene que tener entre 10 y 15 números (con código de país).");
  if (!d.faq.every((f) => f[0]?.trim() && f[1]?.trim())) e.push("Preguntas: hay preguntas o respuestas vacías.");
  if (!d.hero.headline?.trim()) e.push("Hero: falta el titular.");
  if (!d.hero.ctas.every((c) => c.label?.trim() && c.href?.trim())) e.push("Hero: hay botones sin texto o sin enlace.");
  return e;
}
export const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith("_") ? undefined : v)));
