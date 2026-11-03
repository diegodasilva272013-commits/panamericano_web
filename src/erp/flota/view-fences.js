// Geocercas y recorridos: se dibujan sobre el mapa. Una geocerca es una parada, una terminal, una zona con límite de velocidad o una zona prohibida.
// Un recorrido enlaza un servicio del panel con su trazado y sus paradas en orden (las que se miden: frena o no, y a qué hora llega).
import { h, icon, chip, input, put } from "../kit.js";
import { toast, confirmBox, plainErr } from "../../admin/ui.js";
import { pageHead } from "../views-ops.js";
import { fleet } from "./store.js";
import { save } from "./data.js";
import { showError } from "./view-live.js";
import { createFleetMap, mapTools } from "./map.js";
import { FENCE_KINDS, FENCE_COLOR } from "./status.js";
import { simplifyLine, matchFence } from "./track.js";
import { distance } from "../../../gps-server/geo.js";

const norm = (x) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const TAB = { v: "fences" };

export function geocercas(ctx, pre = {}) {
  if (pre.tab) TAB.v = pre.tab;
  const page = h("div", { class: "page page--fleet" }, h("p", { class: "boot" }, "Cargando el mapa…"));
  fleet.ensure().then((F) => mount(page, ctx, F, pre)).catch((e) => showError(page, e, () => ctx.redraw()));
  return page;
}

function mount(page, ctx, F0, pre) {
  let F = F0, api = null, tab = TAB.v, destroyed = false;
  let editing = null;      // geocerca que se está editando o creando
  let draft = null;        // capas temporales del editor
  let mode = null;         // 'circle' | 'polygon' | 'line' mientras se dibuja
  let tmpPts = [];         // vértices que se van marcando
  let tmpLayer = null;
  const mapEl = h("div", { class: "fl__map fl__map--edit" });
  const side = h("section", { class: "fl__side fe__side", "aria-label": "Panel de edición" });
  const banner = h("div", { class: "fe__banner", hidden: true, role: "status" });
  const stage = h("section", { class: "fl__stage", "aria-label": "Mapa" }, mapEl, banner);
  const tabBtns = [["fences", "Geocercas", "geocerca"], ["routes", "Recorridos de los servicios", "ruta"]].map(([k, l, ic]) => h("button", { type: "button", role: "tab", "aria-selected": String(tab === k), class: "fe__tab" + (tab === k ? " is-on" : ""), onclick: () => switchTab(k) }, icon(ic, 18), l));
  const tabBar = h("div", { class: "fe__tabs", role: "tablist" }, ...tabBtns);

  put(page, pageHead("Geocercas y recorridos", "Dibujá las paradas, las zonas y el trazado de cada servicio. Con eso el sistema sabe si el coche frena, si va en sentido correcto y si llega a horario."), tabBar,
    h("div", { class: "fl fl--edit" }, side, stage));

  const setBanner = (t) => { banner.hidden = !t; banner.replaceChildren(...(t ? [typeof t === "string" ? document.createTextNode(t) : t] : [])); };
  const baseColor = (kind) => FENCE_COLOR[kind] || "#f4b400";

  // ------------------------------------------------------------------ mapa
  createFleetMap(mapEl, { base: "calles", zoom: 9 }).then((m) => {
    if (destroyed || !mapEl.isConnected) { m.destroy(); return; }
    api = m;
    mapEl.parentElement.append(mapTools(api, { onFit: fitAll }));
    api.map.on("click", onMapClick);
    api.map.on("dblclick", () => { if (mode === "polygon") finishPolygon(); });
    api.map.doubleClickZoom.disable();
    redrawAll(); fitAll();
  }).catch((e) => { mapEl.replaceChildren(h("p", { class: "fl__maperr" }, "No se pudo cargar el mapa. Revisá tu conexión.")); console.warn("[flota] mapa", e); });
  ctx.cleanup(() => { destroyed = true; api?.destroy(); api = null; });

  function fitAll() {
    if (!api) return;
    const pts = F.geofences.filter((g) => g.active !== false).flatMap((g) => (g.shape === "polygon" ? g.polygon : [[g.lat, g.lng]]));
    if (pts.length) api.map.fitBounds(api.L.latLngBounds(pts), { padding: [60, 60], maxZoom: 13 });
  }

  function redrawAll() {
    if (!api) return;
    api.showFences(F.geofences.filter((g) => !editing || g.id !== editing.id), true, tab === "fences" && !mode ? (g) => { if (!editing) editFence(g); } : null);
  }

  // ------------------------------------------------------------------ pestañas
  function switchTab(k) {
    if (mode || editing) cancelAll();
    tab = TAB.v = k;
    tabBtns.forEach((b, i) => { const on = ["fences", "routes"][i] === k; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", String(on)); });
    k === "fences" ? drawFenceList() : drawRoutePanel();
    redrawAll(); afterTab();
  }

  function cancelAll() {
    mode = null; tmpPts = []; tmpLayer?.remove(); tmpLayer = null; draft?.forEach((l) => l.remove()); draft = null; editing = null; setBanner(null);
    if (api) api.map.getContainer().style.cursor = "";
    redrawAll();
  }

  // ================================================================== GEOCERCAS
  let q = "", kindFilter = "";
  function drawFenceList() {
    const list = h("div", { class: "fl__list fe__list", role: "list" });
    const rows = F.geofences.filter((g) => (!kindFilter || g.kind === kindFilter) && (!q || norm(g.name).includes(norm(q))));
    put(list, rows.length ? rows.map((g) => h("button", { type: "button", role: "listitem", class: "fe__item" + (g.active === false ? " is-off" : ""), onclick: () => { focusFence(g); editFence(g); } },
      h("i", { class: "fe__sw", style: `background:${baseColor(g.kind)}` }), h("span", { class: "fe__name" }, h("b", {}, g.name), h("small", {}, `${FENCE_KINDS[g.kind]} · ${g.shape === "polygon" ? "polígono" : `radio ${g.radius_m} m`}${g.kind === "zona" && g.speed_limit ? ` · ${g.speed_limit} km/h` : ""}`)))) : [h("p", { class: "empty" }, F.geofences.length ? "Ninguna geocerca coincide." : "Todavía no hay geocercas. Dibujá la primera con los botones de arriba.")]);
    put(side,
      h("div", { class: "fe__tools" },
        h("button", { type: "button", class: "btn", onclick: startCircle }, icon("plus", 18), "Círculo"),
        h("button", { type: "button", class: "btn btn--ghost", onclick: startPolygon }, icon("plus", 18), "Polígono")),
      h("p", { class: "hint" }, "Círculo: para paradas y terminales. Polígono: para zonas con forma propia, como un tramo urbano o una zona prohibida."),
      h("input", { type: "search", class: "fl__search", placeholder: "Buscar geocerca", "aria-label": "Buscar geocerca", maxlength: 40, value: q, oninput: (e) => { q = e.target.value; drawFenceList(); } }),
      h("select", { class: "fe__kind", "aria-label": "Tipo", onchange: (e) => { kindFilter = e.target.value; drawFenceList(); } }, h("option", { value: "" }, "Todos los tipos"), Object.entries(FENCE_KINDS).map(([k, l]) => h("option", { value: k, selected: kindFilter === k ? true : null }, l))),
      list);
  }

  function focusFence(g) { if (!api) return; if (g.shape === "polygon") api.map.fitBounds(api.L.latLngBounds(g.polygon), { padding: [60, 60], maxZoom: 16 }); else api.map.flyTo([g.lat, g.lng], Math.max(api.map.getZoom(), 14), { duration: 0.6 }); }

  function startCircle() {
    cancelAll(); mode = "circle"; redrawAll();
    setBanner("Tocá el mapa donde va el centro de la parada o terminal.");
    api.map.getContainer().style.cursor = "crosshair";
    drawFenceList(); side.append(cancelBar());
  }
  function startPolygon() {
    cancelAll(); mode = "polygon"; tmpPts = []; redrawAll();
    setBanner(h("span", {}, "Tocá los vértices de la zona (mínimo 3). ", h("button", { type: "button", class: "btn btn--sm", id: "poly-done", onclick: finishPolygon, disabled: true }, "Terminar"), " ", h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: () => { tmpPts.pop(); paintTmp(); } }, "Quitar el último punto")));
    api.map.getContainer().style.cursor = "crosshair";
    drawFenceList(); side.append(cancelBar());
  }
  const cancelBar = () => h("div", { class: "fe__cancel" }, h("button", { type: "button", class: "btn btn--ghost", onclick: () => { cancelAll(); tab === "fences" ? drawFenceList() : drawRoutePanel(); } }, "Cancelar el dibujo"));

  function paintTmp() {
    const L = api.L; tmpLayer?.remove();
    if (!tmpPts.length) { tmpLayer = null; const b = document.getElementById("poly-done"); if (b) b.disabled = true; return; }
    tmpLayer = L.layerGroup([L.polyline(tmpPts, { color: "#111", weight: 3, dashArray: "6 6" }), ...tmpPts.map((p) => L.circleMarker(p, { radius: 5, color: "#111", weight: 2, fillColor: "#f4b400", fillOpacity: 1 }))]).addTo(api.map);
    const b = document.getElementById("poly-done"); if (b) b.disabled = tmpPts.length < 3;
  }

  function onMapClick(e) {
    if (mode === "circle") { const g = { shape: "circle", kind: "parada", name: "", lat: round5(e.latlng.lat), lng: round5(e.latlng.lng), radius_m: F.settings.stopRadiusM || 120, active: true }; mode = null; api.map.getContainer().style.cursor = ""; setBanner(null); editFence(g, true); }
    else if (mode === "polygon") { tmpPts.push([round5(e.latlng.lat), round5(e.latlng.lng)]); paintTmp(); }
    else if (mode === "line") { tmpPts.push([round5(e.latlng.lat), round5(e.latlng.lng)]); routeDraft.line = tmpPts.slice(); paintRouteLine(); drawRoutePanel(true); }
  }
  const round5 = (n) => Math.round(n * 1e5) / 1e5;

  function finishPolygon() {
    if (tmpPts.length < 3) return;
    const g = { shape: "polygon", kind: "zona", name: "", polygon: tmpPts.slice(), active: true, speed_limit: 60 };
    mode = null; tmpLayer?.remove(); tmpLayer = null; tmpPts = []; api.map.getContainer().style.cursor = ""; setBanner(null); editFence(g, true);
  }

  /** Editor de una geocerca (nueva o existente), con vista previa en el mapa mientras se cambian los valores. */
  function editFence(g0, isNew = false) {
    if (editing && editing !== g0) cancelAll();
    const g = JSON.parse(JSON.stringify(g0)); editing = g0; redrawAll();
    const L = api.L; draft?.forEach((l) => l.remove()); draft = [];
    const color = () => baseColor(g.kind);
    let shape, handles = [];
    const paint = () => {
      shape?.remove(); handles.forEach((m) => m.remove()); handles = [];
      const opts = { color: color(), weight: 3, fillColor: color(), fillOpacity: 0.2 };
      if (g.shape === "polygon") {
        shape = L.polygon(g.polygon, opts).addTo(api.map);
        handles = g.polygon.map((p, i) => { const m = L.marker(p, { draggable: true, icon: L.divIcon({ className: "fe-handle-wrap", html: '<span class="fe-handle"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(api.map); m.on("drag", (ev) => { g.polygon[i] = [round5(ev.latlng.lat), round5(ev.latlng.lng)]; shape.setLatLngs(g.polygon); }); return m; });
      } else {
        shape = L.circle([g.lat, g.lng], { ...opts, radius: g.radius_m }).addTo(api.map);
        const m = L.marker([g.lat, g.lng], { draggable: true, icon: L.divIcon({ className: "fe-handle-wrap", html: '<span class="fe-handle fe-handle--c"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(api.map);
        m.on("drag", (ev) => { g.lat = round5(ev.latlng.lat); g.lng = round5(ev.latlng.lng); shape.setLatLng([g.lat, g.lng]); });
        handles = [m];
      }
      draft = [shape, ...handles];
    };
    paint();
    if (isNew) focusFence(g);

    const name = input({ label: "Nombre", value: g.name, required: true, max: 60, placeholder: g.shape === "polygon" ? "Tramo urbano Jujuy" : "Terminal Purmamarca" });
    const kind = input({ label: "Tipo", options: Object.entries(FENCE_KINDS).filter(([k]) => g.shape === "polygon" ? k !== "terminal" : k !== "zona" || true), value: g.kind });
    const radius = input({ label: "Radio (metros)", type: "number", value: g.radius_m ?? "", min: 20, maxv: 20000, step: 10, inputmode: "numeric", hint: "Una parada de ruta: 100 a 150 m. Una terminal grande: 200 a 300 m." });
    const range = h("input", { type: "range", min: "30", max: "600", step: "10", value: String(Math.min(600, g.radius_m || 120)), class: "fe__range", "aria-label": "Radio", oninput: (e) => { radius.set(e.target.value); setRadius(+e.target.value); } });
    const limit = input({ label: "Límite de velocidad dentro (km/h)", type: "number", value: g.speed_limit ?? "", min: 5, maxv: 160, step: 5, inputmode: "numeric", hint: "Si el coche pasa de esto dentro de la zona, se avisa. Vacío = usa el general." });
    const active = h("input", { type: "checkbox", id: "fe-act", checked: g.active === false ? null : true });
    const setRadius = (v) => { if (g.shape === "circle" && v >= 20) { g.radius_m = Math.round(v); shape.setRadius(g.radius_m); } };
    radius.input.addEventListener("input", () => { const v = +radius.get(); if (v >= 20) { range.value = String(Math.min(600, v)); setRadius(v); } });
    const showKind = () => { limit.el.hidden = g.kind !== "zona"; const c = color(); shape.setStyle({ color: c, fillColor: c }); };
    kind.input.addEventListener("change", () => { g.kind = kind.get(); showKind(); });
    showKind();
    let busy = false;
    const submit = async (ev) => {
      ev.preventDefault(); if (busy) return;
      name.error(""); radius.error(""); limit.error("");
      if (!name.get().trim()) return name.error("Escribí un nombre.");
      if (g.shape === "circle" && !(+radius.get() >= 20 && +radius.get() <= 20000)) return radius.error("El radio tiene que estar entre 20 y 20.000 metros.");
      busy = true; sv.disabled = true;
      try {
        const row = await save.fence({ ...g, id: g0.id, name: name.get(), kind: g.kind, radius_m: g.shape === "circle" ? Math.round(+radius.get()) : null, speed_limit: g.kind === "zona" && limit.get() ? +limit.get() : null, color: baseColor(g.kind), active: active.checked });
        await fleet.reload(); F = fleet.get(); cancelAll(); drawFenceList(); redrawAll(); toast(isNew ? `Geocerca «${row.name}» creada.` : "Cambios guardados.", "ok", 3500);
      } catch (x) { toast(plainErr(x), "err", 9000); busy = false; sv.disabled = false; }
    };
    const sv = h("button", { type: "submit", class: "btn" }, isNew ? "Crear la geocerca" : "Guardar los cambios");
    const del = !isNew && h("button", { type: "button", class: "btn btn--ghost", onclick: async () => {
      if (!(await confirmBox(`¿Borrar la geocerca «${g0.name}»? Si es parada de un recorrido, primero hay que sacarla de ahí.`, "Borrar", "No", { focusCancel: true }))) return;
      try { await save.removeFence(g0.id); await fleet.reload(); F = fleet.get(); cancelAll(); drawFenceList(); redrawAll(); toast("Geocerca borrada.", "ok", 3000); } catch (x) { toast(plainErr(x), "err", 9000); }
    } }, icon("trash", 18), "Borrar");
    put(side, h("form", { class: "payform payform--flat fe__form", onsubmit: submit, novalidate: true },
      h("h2", {}, isNew ? "Nueva geocerca" : "Editar la geocerca"),
      h("p", { class: "hint" }, g.shape === "circle" ? "Arrastrá el punto del centro para moverla." : "Arrastrá los puntos de los vértices para cambiar la forma."),
      name.el, kind.el, g.shape === "circle" ? [radius.el, range] : null, limit.el,
      h("label", { class: "check", for: "fe-act" }, active, h("span", {}, "En uso")),
      h("div", { class: "payform__act" }, h("button", { type: "button", class: "btn btn--ghost", onclick: () => { cancelAll(); drawFenceList(); } }, "Cancelar"), del, sv)));
    name.input.focus();
  }

  // ================================================================== RECORRIDOS
  let routeDraft = null; // { routeId, line: [[lat,lng]], corridor, stops: [{ name, geofence_id, offset_min, mandatory }] }
  let routeLayer = null;

  const panelRoutes = () => ctx.data().content.routes || [];
  const stopNames = (r) => [r.from, ...(r.stops || [])].filter(Boolean);

  function loadRouteDraft(routeId) {
    const r = panelRoutes().find((x) => x.id === routeId); if (!r) return null;
    const saved = F.routes.find((x) => x.route_id === routeId), savedStops = F.routeStops.filter((s) => s.route_id === routeId).sort((a, b) => a.idx - b.idx);
    const names = stopNames(r);
    return { routeId, line: saved ? JSON.parse(JSON.stringify(saved.polyline || [])) : [], corridor: saved?.corridor_m || 400,
      stops: names.map((n, i) => { const s = savedStops.find((x) => x.idx === i); return { name: n, geofence_id: s?.geofence_id || matchFence(n, F.geofences)?.id || "", offset_min: s?.offset_min ?? (i === 0 ? 0 : null), mandatory: s ? s.mandatory : true, auto: !s }; }) };
  }

  function paintRouteLine() {
    if (!api) return; routeLayer?.remove(); routeLayer = null;
    const L = api.L, line = routeDraft?.line || [];
    if (line.length > 1) routeLayer = L.layerGroup([L.polyline(line, { color: "#111", weight: 7, opacity: 0.3 }), L.polyline(line, { color: "#f4b400", weight: 4 })]).addTo(api.map);
    else if (line.length === 1) routeLayer = L.layerGroup([L.circleMarker(line[0], { radius: 5, color: "#111", fillColor: "#f4b400", fillOpacity: 1 })]).addTo(api.map);
    if (mode === "line" && line.length) routeLayer.addLayer(L.layerGroup(line.map((p) => L.circleMarker(p, { radius: 3.5, color: "#111", weight: 1.5, fillColor: "#fff", fillOpacity: 1 }))));
    // las paradas enlazadas, numeradas en el orden del servicio
    routeDraft?.stops.forEach((s, i) => {
      const g = F.fenceById.get(s.geofence_id); if (!g) return;
      const c = g.shape === "polygon" ? g.polygon[0] : [g.lat, g.lng];
      (routeLayer ||= L.layerGroup().addTo(api.map)).addLayer(L.marker(c, { icon: L.divIcon({ className: "rp-pin-wrap", html: `<span class="rp-pin is-stop">${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }), title: s.name, keyboard: false }));
    });
  }

  function drawRoutePanel(keep) {
    const rs = panelRoutes();
    if (!routeDraft && rs.length && !keep) routeDraft = loadRouteDraft(TAB.route || rs[0].id);
    const sel = h("select", { class: "fe__kind", "aria-label": "Servicio", onchange: (e) => { if (mode) cancelAll(); TAB.route = e.target.value; routeDraft = loadRouteDraft(e.target.value); drawRoutePanel(true); paintRouteLine(); fitRoute(); } },
      rs.map((r) => { const done = F.routes.some((x) => x.route_id === r.id); return h("option", { value: r.id, selected: routeDraft?.routeId === r.id ? true : null }, `${done ? "✓ " : ""}${r.from} → ${r.to}${r.via ? " " + r.via : ""}`); }));
    if (!rs.length) return put(side, h("p", { class: "empty" }, "Todavía no hay servicios cargados en el panel de la web."));
    const D = routeDraft, mapped = D.stops.filter((s) => s.geofence_id).length;
    const geoOpts = [["", "— elegir geocerca —"], ...F.geofences.filter((g) => g.kind === "parada" || g.kind === "terminal").map((g) => [g.id, g.name])];
    const rows = D.stops.map((s, i) => {
      const gsel = h("select", { "aria-label": `Geocerca de ${s.name}`, onchange: (e) => { s.geofence_id = e.target.value; s.auto = false; drawRoutePanel(true); highlight(); } }, geoOpts.map(([v, l]) => h("option", { value: v, selected: v === s.geofence_id ? true : null }, l)));
      const off = h("input", { type: "number", min: "0", step: "5", inputmode: "numeric", placeholder: i === 0 ? "0" : "min", value: s.offset_min ?? "", disabled: i === 0 ? true : null, "aria-label": `Minutos desde la salida hasta ${s.name}`, oninput: (e) => { s.offset_min = e.target.value === "" ? null : Math.max(0, Math.round(+e.target.value)); } });
      const man = h("input", { type: "checkbox", checked: s.mandatory ? true : null, "aria-label": `Tiene que frenar en ${s.name}`, onchange: (e) => { s.mandatory = e.target.checked; } });
      return h("div", { class: "fe__stop" + (s.geofence_id ? "" : " is-missing") }, h("span", { class: "fe__idx" }, String(i + 1)), h("div", { class: "fe__stopbody" }, h("b", {}, s.name, s.auto && s.geofence_id ? h("small", { class: "fe__auto" }, " sugerida") : null), gsel,
        h("div", { class: "fe__stopmeta" }, h("label", {}, h("span", {}, "Llega a los"), off, h("span", {}, "min")), h("label", { class: "fe__man" }, man, h("span", {}, "Debe frenar")))));
    });
    const missing = D.stops.length - mapped;
    put(side,
      h("div", { class: "fe__route" }, h("label", { class: "fe__lbl" }, "Servicio del panel"), sel),
      h("p", { class: "hint" }, "Cada parada del servicio se enlaza con una geocerca. «Llega a los…» es el tiempo normal desde la salida: con eso se avisa si hay atraso. Vacío = no se mide en esa parada."),
      h("div", { class: "fe__stops" }, rows),
      h("div", { class: "fe__line" }, h("h3", {}, "Trazado del recorrido"),
        h("p", { class: "hint" }, D.line.length > 1 ? `${D.line.length} puntos · ${(lineKm(D.line)).toFixed(1)} km. Sirve para saber si el coche va por la ruta y en qué sentido.` : "Todavía sin trazado. Sin él, el sentido se controla solo por el orden de las paradas."),
        h("div", { class: "fe__tools" },
          h("button", { type: "button", class: "btn btn--ghost btn--sm", disabled: mapped < 2, title: mapped < 2 ? "Enlazá al menos dos paradas con geocercas" : "", onclick: autoTrace }, "Trazar por las calles"),
          h("button", { type: "button", class: "btn btn--ghost btn--sm" + (mode === "line" ? " is-on" : ""), onclick: toggleLineDraw }, mode === "line" ? "Terminar de dibujar" : "Dibujar a mano"),
          mode === "line" ? h("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: () => { tmpPts.pop(); D.line = tmpPts.slice(); paintRouteLine(); drawRoutePanel(true); } }, "Quitar el último") : null,
          D.line.length ? h("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: () => { D.line = []; tmpPts = []; paintRouteLine(); drawRoutePanel(true); } }, "Borrar el trazado") : null),
        h("label", { class: "fe__corr" }, h("span", {}, "Ancho permitido a cada lado (m)"), h("input", { type: "number", min: "50", max: "5000", step: "50", value: String(D.corridor), inputmode: "numeric", oninput: (e) => { D.corridor = Math.max(50, Math.min(5000, Math.round(+e.target.value) || 400)); } }))),
      missing ? h("p", { class: "warn" }, `${missing} ${missing === 1 ? "parada sin geocerca" : "paradas sin geocerca"}. Dibujalas en la pestaña «Geocercas» y volvé.`) : null,
      h("div", { class: "payform__act" },
        F.routes.some((x) => x.route_id === D.routeId) ? h("button", { type: "button", class: "btn btn--ghost", onclick: removeRoute }, icon("trash", 18), "Quitar el recorrido") : null,
        h("button", { type: "button", class: "btn", id: "route-save", onclick: saveRoute }, "Guardar el recorrido")));
  }

  const lineKm = (line) => line.reduce((a, p, i) => (i ? a + distance(line[i - 1], p) : 0), 0) / 1000;
  function highlight() { /* las geocercas del recorrido ya se ven en el mapa */ }
  function fitRoute() {
    if (!api || !routeDraft) return;
    const pts = routeDraft.line.length ? routeDraft.line : routeDraft.stops.map((s) => F.fenceById.get(s.geofence_id)).filter(Boolean).map((g) => (g.shape === "polygon" ? g.polygon[0] : [g.lat, g.lng]));
    if (pts.length) api.map.fitBounds(api.L.latLngBounds(pts), { padding: [60, 60], maxZoom: 13 });
  }

  function toggleLineDraw() {
    if (mode === "line") { mode = null; setBanner(null); api.map.getContainer().style.cursor = ""; paintRouteLine(); drawRoutePanel(true); return; }
    mode = "line"; tmpPts = routeDraft.line.slice(); setBanner("Tocá el mapa siguiendo el camino, desde la salida hasta el destino."); api.map.getContainer().style.cursor = "crosshair"; paintRouteLine(); drawRoutePanel(true);
  }

  async function autoTrace() {
    const D = routeDraft, pts = D.stops.map((s) => F.fenceById.get(s.geofence_id)).filter(Boolean).map((g) => (g.shape === "polygon" ? centroid(g.polygon) : [g.lat, g.lng]));
    if (pts.length < 2) return;
    const btn = side.querySelector(".fe__line .btn"); if (btn) { btn.disabled = true; btn.textContent = "Trazando…"; }
    try {
      const coords = pts.map((p) => `${p[1]},${p[0]}`).join(";");
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("osrm " + r.status);
      const j = await r.json();
      const g = j.routes?.[0]?.geometry?.coordinates; if (!g || g.length < 2) throw new Error("sin ruta");
      D.line = simplifyLine(g.map(([lng, lat]) => [round5(lat), round5(lng)]), 15);
      paintRouteLine(); fitRoute(); toast(`Trazado listo: ${D.line.length} puntos, ${lineKm(D.line).toFixed(1)} km. Revisalo en el mapa.`, "ok", 5000);
    } catch (e) { console.warn("[flota] trazado", e); toast("No se pudo trazar por las calles en este momento. Podés dibujarlo a mano.", "err", 7000); }
    drawRoutePanel(true);
  }
  const centroid = (poly) => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];

  async function saveRoute() {
    const D = routeDraft, btn = document.getElementById("route-save");
    const linked = D.stops.filter((s) => s.geofence_id);
    if (linked.length < 2) return toast("Enlazá al menos la salida y el destino con sus geocercas.", "err", 6000);
    if (new Set(linked.map((s) => s.geofence_id)).size !== linked.length) return toast("Hay dos paradas con la misma geocerca. Cada parada necesita la suya.", "err", 6000);
    if (mode === "line") { mode = null; setBanner(null); api.map.getContainer().style.cursor = ""; }
    btn.disabled = true;
    try {
      await save.route(D.routeId, D.line, D.corridor, linked.map((s) => ({ geofence_id: s.geofence_id, name: s.name, offset_min: s.offset_min, mandatory: s.mandatory })));
      await fleet.reload(); F = fleet.get(); routeDraft = loadRouteDraft(D.routeId); drawRoutePanel(true); toast("Recorrido guardado. Desde ahora se controla ese servicio.", "ok", 4500);
    } catch (x) { toast(plainErr(x), "err", 9000); btn.disabled = false; }
  }
  async function removeRoute() {
    if (!(await confirmBox("¿Quitar el recorrido de este servicio? Los viajes dejan de controlarse (paradas, sentido y atrasos). No se borra ninguna geocerca.", "Quitar el recorrido", "No", { focusCancel: true }))) return;
    try { await save.removeRoute(routeDraft.routeId); await fleet.reload(); F = fleet.get(); routeDraft = loadRouteDraft(routeDraft.routeId); paintRouteLine(); drawRoutePanel(true); toast("Recorrido quitado.", "ok", 3000); } catch (x) { toast(plainErr(x), "err", 9000); }
  }

  // ------------------------------------------------------------------ arranque
  // al pasar a la pestaña de recorridos se dibuja el trazado guardado; al volver a geocercas se saca
  const afterTab = () => { if (tab === "routes") { paintRouteLine(); fitRoute(); } else { routeLayer?.remove(); routeLayer = null; } };
  if (tab === "routes") { drawRoutePanel(); const t = setInterval(() => { if (api) { clearInterval(t); afterTab(); } }, 200); ctx.cleanup(() => clearInterval(t)); }
  else drawFenceList();
}
