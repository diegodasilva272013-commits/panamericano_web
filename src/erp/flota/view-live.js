// Mapa en vivo: todos los coches con velocidad, rumbo, estado y viaje; ficha de cada coche; alertas al instante.
import { h, icon, chip, put } from "../kit.js";
import { toast, plainErr } from "../../admin/ui.js";
import { fleet, openAlerts } from "./store.js";
import { watchLive, ackAlert } from "./data.js";
import { createFleetMap, mapTools } from "./map.js";
import { STATUS, ALERTS, SEVERITY, TRIP_STATUS, STOP_STATUS, vehicleStatus, ago, compass, csqBars, km, fmtHm, fmtWhen } from "./status.js";
import { openReplay } from "./replay.js";
import { distance } from "../../../gps-server/geo.js";

const norm = (x) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const FILTERS = [["all", "Todos"], ["moving", "En marcha"], ["idle", "Detenidos"], ["parked", "Apagados"], ["offline", "Sin señal"], ["alert", "Con alerta"]];
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } } };

/** Viaje que corresponde mostrar de un coche: el que está en curso, si no el próximo de hoy, si no el último terminado hace poco. */
export function tripFor(F, vehicleId) {
  const mine = F.trips.filter((t) => t.vehicle_id === vehicleId);
  const live = mine.find((t) => t.status === "en_curso");
  if (live) return live;
  const next = mine.filter((t) => t.status === "programado" && t.trip_date >= F.today).sort((a, b) => (a.trip_date + a.trip_time).localeCompare(b.trip_date + b.trip_time))[0];
  if (next) return next;
  return mine.filter((t) => t.status === "completado").sort((a, b) => Date.parse(b.ended_at || 0) - Date.parse(a.ended_at || 0))[0] || null;
}

export function rowsOf(F, now = Date.now()) {
  const open = openAlerts(F);
  return F.vehicles.filter((v) => v.active !== false).map((v) => {
    const st = F.stateById.get(v.id) || null, status = vehicleStatus(v, st, now, F.settings);
    const alerts = open.filter((a) => a.vehicle_id === v.id);
    return { v, st, status, alerts, trip: tripFor(F, v.id), seen: st ? Math.max(Date.parse(st.last_received || 0) || 0, Date.parse(st.last_time || 0) || 0) : 0 };
  });
}

let audio = null;
function beep() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain(); o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.07;
    o.connect(g); g.connect(audio.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.5); o.stop(audio.currentTime + 0.5);
  } catch { /* el navegador no deja sonar sin un gesto previo */ }
}

export function mapa(ctx, pre = {}) {
  const page = h("div", { class: "page page--fleet" }, h("p", { class: "boot" }, "Cargando la flota…"));
  fleet.ensure().then((F) => mount(page, ctx, F, pre)).catch((e) => showError(page, e, () => ctx.redraw()));
  return page;
}

export function showError(page, e, retry) {
  page.replaceChildren(h("div", { class: "empty-state" }, icon("alert", 28), h("h2", {}, e.setup ? "Falta activar la flota" : "No pudimos cargar la flota"),
    h("p", {}, e.setup ? "Es un paso que se hace una sola vez: en Supabase → SQL Editor pegá todo el archivo supabase/flota.sql y tocá Run. No borra nada de lo que ya hay." : plainErr(e)),
    h("button", { type: "button", class: "btn", onclick: retry }, "Reintentar")));
}

function mount(page, ctx, F0, pre) {
  let F = F0, selected = pre.vehicle || null, filter = "all", query = "", sound = LS.get("flota.sound") === "1", fencesAll = false, api = null, fitted = false;
  const list = h("div", { class: "fl__list", role: "list" });
  const kpis = h("div", { class: "fl__kpis", "aria-live": "polite" });
  const card = h("aside", { class: "fl__card", hidden: true, "aria-label": "Detalle del coche" });
  const mapEl = h("div", { class: "fl__map" });
  const search = h("input", { type: "search", class: "fl__search", placeholder: "Buscar coche o patente", "aria-label": "Buscar coche o patente", maxlength: 30, oninput: (e) => { query = e.target.value; drawList(); } });
  const chips = h("div", { class: "fl__chips", role: "group", "aria-label": "Filtrar por estado" });
  const empty = h("div", { class: "fl__none", hidden: true });

  const soundBtn = h("button", { type: "button", class: "mt", title: "Sonido al llegar una alerta crítica", "aria-label": "Sonido de alertas", "aria-pressed": String(sound), onclick: () => { sound = !sound; LS.set("flota.sound", sound ? "1" : "0"); soundBtn.setAttribute("aria-pressed", String(sound)); soundBtn.classList.toggle("is-on", sound); if (sound) beep(); } }, icon("campana", 20));
  soundBtn.classList.toggle("is-on", sound);
  const fenceBtn = h("button", { type: "button", class: "mt", title: "Mostrar las geocercas", "aria-label": "Mostrar las geocercas", "aria-pressed": "false", onclick: () => { fencesAll = !fencesAll; fenceBtn.setAttribute("aria-pressed", String(fencesAll)); fenceBtn.classList.toggle("is-on", fencesAll); drawFences(); } }, icon("geocerca", 20));

  // ---- medir distancias y buscar los coches más cercanos a un punto (como en StreetZ)
  let tool = null, toolPts = [], toolLayer = null;
  const near = h("div", { class: "fl__near", hidden: true, role: "dialog", "aria-label": "Coches más cercanos" });
  const toolBtn = (name, label, ic) => { const b = h("button", { type: "button", class: "mt", title: label, "aria-label": label, "aria-pressed": "false", onclick: () => setTool(tool === name ? null : name) }, icon(ic, 20)); return b; };
  const rulerBtn = toolBtn("ruler", "Medir distancias", "regla"), nearBtn = toolBtn("near", "Buscar los coches más cercanos a un punto", "cerca");
  const km1 = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`);
  function setTool(t) {
    tool = t; toolPts = []; toolLayer?.remove(); toolLayer = null; near.hidden = true;
    rulerBtn.classList.toggle("is-on", t === "ruler"); rulerBtn.setAttribute("aria-pressed", String(t === "ruler")); nearBtn.classList.toggle("is-on", t === "near"); nearBtn.setAttribute("aria-pressed", String(t === "near"));
    if (api) api.map.getContainer().style.cursor = t ? "crosshair" : "";
    if (t === "ruler") toast("Tocá el mapa para marcar puntos y medir. Volvé a tocar el botón para terminar.", "ok", 4500);
    if (t === "near") toast("Tocá el mapa en el punto que te interesa.", "ok", 3500);
  }
  function onToolClick(e) {
    if (!tool) return;
    const L = api.L, ll = [e.latlng.lat, e.latlng.lng];
    if (tool === "ruler") {
      toolPts.push(ll); toolLayer?.remove();
      const total = toolPts.reduce((a, p, i) => (i ? a + distance(toolPts[i - 1], p) : 0), 0);
      toolLayer = L.layerGroup([L.polyline(toolPts, { color: "#f4b400", weight: 3, dashArray: "6 6" }), ...toolPts.map((p) => L.circleMarker(p, { radius: 4, color: "#0b0b0a", weight: 2, fillColor: "#f4b400", fillOpacity: 1 })),
        L.marker(ll, { interactive: false, icon: L.divIcon({ className: "ruler-wrap", html: `<span class="ruler-tag">${km1(total)}</span>`, iconSize: [0, 0] }) })]).addTo(api.map);
    } else if (tool === "near") {
      toolLayer?.remove();
      const list = rowsOf(F).filter((r) => r.st && r.st.lat != null).map((r) => ({ r, d: distance(ll, [r.st.lat, r.st.lng]) })).sort((a, b) => a.d - b.d).slice(0, 5);
      toolLayer = L.layerGroup([L.circleMarker(ll, { radius: 7, color: "#fff", weight: 3, fillColor: "#ef4444", fillOpacity: 1 }), ...(list[0] ? [L.polyline([ll, [list[0].r.st.lat, list[0].r.st.lng]], { color: "#ef4444", weight: 2, dashArray: "4 6" })] : [])]).addTo(api.map);
      put(near, h("div", { class: "fl__neartop" }, h("b", {}, "Más cercanos a ese punto"), h("button", { type: "button", class: "ico", "aria-label": "Cerrar", onclick: () => setTool(null) }, icon("x", 18))),
        list.length ? list.map(({ r, d }) => h("button", { type: "button", class: "fl__nearrow", onclick: () => { setTool(null); select(r.v.id, true); } }, h("i", { class: "fv__dot fv--" + r.status }), h("b", {}, r.v.code), h("span", {}, STATUS[r.status].label), h("em", {}, km1(d)))) : h("p", { class: "empty" }, "Ningún coche tiene posición todavía."));
      near.hidden = false;
    }
  }

  const wrap = h("div", { class: "fl" },
    h("section", { class: "fl__side", "aria-label": "Coches" }, h("div", { class: "fl__sidehead" }, search, chips), list, empty),
    h("section", { class: "fl__stage", "aria-label": "Mapa" }, mapEl, kpis, near, card));
  page.replaceChildren(wrap);

  // ------------------------------------------------------------------ lista
  const rows = () => rowsOf(F);
  const match = (r) => {
    if (filter === "alert" ? !r.alerts.length : filter !== "all" && r.status !== filter) return false;
    const q = norm(query).trim(); return !q || norm(r.v.code).includes(q) || norm(r.v.plate).includes(q);
  };

  // los filtros se arman una vez y después solo cambian los números: un clic no se pierde cuando llegan datos nuevos
  const chipEls = new Map();
  function drawChips(all) {
    if (!chipEls.size) FILTERS.forEach(([k, l]) => { const b = h("b"); const btn = h("button", { type: "button", class: "fl__chip", onclick: () => { filter = k; drawList(); } }, l, b); chipEls.set(k, { btn, b }); chips.append(btn); });
    for (const [k] of FILTERS) {
      const { btn, b } = chipEls.get(k), count = k === "all" ? all.length : k === "alert" ? all.filter((r) => r.alerts.length).length : all.filter((r) => r.status === k).length;
      setText(b, String(count)); btn.classList.toggle("is-on", filter === k); btn.setAttribute("aria-pressed", String(filter === k));
    }
  }

  function drawList() {
    const all = rows(), shown = all.filter(match);
    drawChips(all); drawKpis(all);
    const order = { moving: 0, idle: 1, parked: 2, offline: 3, nodata: 4, nodevice: 5 };
    shown.sort((a, b) => (b.alerts.length ? 1 : 0) - (a.alerts.length ? 1 : 0) || order[a.status] - order[b.status] || a.v.code.localeCompare(b.v.code, "es", { numeric: true }));
    // las filas se actualizan en el lugar (no se reemplazan): así un clic o el foco no se pierden cuando llegan datos nuevos
    const els = shown.map((r) => { let c = rowCmp.get(r.v.id); if (!c) { c = buildRow(r.v.id); rowCmp.set(r.v.id, c); } updateRow(c, r); return c.el; });
    if (list.children.length !== els.length || els.some((e, i) => list.children[i] !== e)) list.replaceChildren(...els);
    empty.hidden = shown.length > 0;
    if (!shown.length) empty.replaceChildren(h("p", {}, all.length ? "Ningún coche coincide con el filtro." : "Todavía no cargaste coches."),
      !all.length ? h("button", { type: "button", class: "btn", onclick: () => ctx.go("vehiculos", {}) }, "Cargar coches") : h("button", { type: "button", class: "btn btn--ghost", onclick: () => { filter = "all"; query = ""; search.value = ""; drawList(); } }, "Quitar filtros"));
    paintMap(all);
    if (selected) drawCard();
  }

  const rowCmp = new Map();
  const setText = (node, t) => { if (node.textContent !== t) node.textContent = t; };
  function buildRow(id) {
    const code = h("b"), sub = h("small"), speed = h("span", { class: "fv__speed" }), age = h("span", { class: "fv__age" });
    const el = h("button", { type: "button", role: "listitem", "data-id": id, onclick: () => select(id, true) }, h("span", { class: "fv__dot", "aria-hidden": "true" }), h("span", { class: "fv__name" }, code, sub), speed, age);
    return { el, code, sub, speed, age, alKey: "", spKey: "" };
  }
  function updateRow(c, r) {
    const cls = "fv fv--" + r.status + (selected === r.v.id ? " is-sel" : "");
    if (c.el.className !== cls) c.el.className = cls;
    c.el.setAttribute("aria-pressed", String(selected === r.v.id));
    const s = STATUS[r.status], n = r.alerts.length, alKey = `${r.v.code}|${n}`;
    if (c.alKey !== alKey) { c.alKey = alKey; c.code.replaceChildren(r.v.code, ...(n ? [h("span", { class: "fv__al", title: `${n} ${n === 1 ? "alerta" : "alertas"} sin atender` }, icon("alert", 13), String(n))] : [])); }
    setText(c.sub, [r.v.plate, r.trip && r.trip.status === "en_curso" ? ctx.routeName(r.trip.route_id).replace(/ · .*/, "") : ""].filter(Boolean).join(" · ") || s.label);
    const spKey = r.status === "moving" ? `m${Math.round(r.st.speed || 0)}` : `s${s.label}`;
    if (c.spKey !== spKey) { c.spKey = spKey; c.speed.replaceChildren(r.status === "moving" ? h("b", {}, String(Math.round(r.st.speed || 0)), h("i", {}, " km/h")) : h("small", {}, s.label)); }
    setText(c.age, r.seen ? ago(r.seen) : "—");
  }

  // los contadores también se arman una vez
  const kEl = (cls = "") => { const b = h("b"), txt = document.createTextNode(""); return { b, txt, el: h("span", { class: "fl__k " + cls }, b, txt) }; };
  const kLiveTxt = document.createTextNode(""), kLive = h("span", { class: "fl__k fl__k--live" }, h("i"), kLiveTxt);
  const kCoches = kEl(), kMarcha = kEl("is-ok"), kDet = kEl(), kSin = kEl();
  const kAlN = h("b"), kAlT = document.createTextNode(""), kAl = h("button", { type: "button", class: "fl__k fl__k--al", hidden: true, onclick: () => ctx.go("alertas", {}) }, icon("alert", 15), kAlN, kAlT);
  kpis.append(kLive, kCoches.el, kMarcha.el, kDet.el, kSin.el, kAl);
  function drawKpis(all) {
    const n = (k) => all.filter((r) => r.status === k).length, al = openAlerts(F).length;
    kLiveTxt.textContent = stampText();
    const set = (c, v, l) => { setText(c.b, String(v)); if (c.txt.textContent !== l) c.txt.textContent = l; };
    set(kCoches, all.length, "coches"); set(kMarcha, n("moving"), "en marcha"); set(kDet, n("idle") + n("parked"), "detenidos"); set(kSin, n("offline"), "sin señal");
    kSin.el.classList.toggle("is-bad", n("offline") > 0);
    kAl.hidden = !al; setText(kAlN, String(al)); kAlT.textContent = al === 1 ? "alerta" : "alertas";
  }
  const stampText = () => "En vivo " + new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Argentina/Jujuy" }).format(new Date());

  // ------------------------------------------------------------------ mapa
  function paintMap(all) {
    if (!api) return;
    api.update(all.filter((r) => r.st && r.st.lat != null).map((r) => ({ id: r.v.id, code: r.v.code, lat: r.st.lat, lng: r.st.lng, course: r.st.course, speed: r.st.speed, status: r.status, alert: r.alerts.some((a) => a.severity === "critica") })));
    if (!fitted && all.some((r) => r.st && r.st.lat != null)) { fitted = true; if (selected) api.focus(selected); else api.fit(); }
  }
  function drawFences() {
    if (!api) return;
    const r = selected && tripFor(F, selected), route = r && F.routes.find((x) => x.route_id === r.route_id);
    if (selected && route) {
      const ids = new Set(F.routeStops.filter((s) => s.route_id === route.route_id).map((s) => s.geofence_id));
      api.showFences(F.geofences.filter((g) => ids.has(g.id)), true); api.showRoute(route.polyline);
    } else { api.showFences(F.geofences, fencesAll); api.clearRoute(); }
  }

  // ------------------------------------------------------------------ ficha del coche
  function select(id, focus) {
    selected = id; api?.select(id);
    if (!id) { card.hidden = true; api?.follow(null); drawList(); drawFences(); return; }
    card.hidden = false; drawList(); drawFences();
    if (focus && api) api.focus(id);
    if (focus && matchMedia("(max-width:960px)").matches) mapEl.parentElement.scrollIntoView?.({ block: "start", behavior: "smooth" }); // en el celular la ficha aparece sobre el mapa: se lleva la vista ahí
    document.querySelectorAll(".fv.is-sel").forEach((b) => b.scrollIntoView?.({ block: "nearest" }));
  }

  let cardCmp = null, cardFor = null;
  function drawCard() {
    const r = rows().find((x) => x.v.id === selected);
    if (!r) { card.hidden = true; return; }
    if (!cardCmp || cardFor !== selected) { cardCmp = buildCard(r); cardFor = selected; card.replaceChildren(...cardCmp.nodes); card.scrollTop = 0; }
    cardCmp.update(r);
  }

  /** La ficha se arma una vez por coche y después solo se cambian los textos: los botones no se reemplazan, así nada se pierde al llegar datos nuevos. */
  function buildCard(r0) {
    const v = r0.v;
    const name = h("h2", {}, v.code), sub = h("p"), chipBox = h("span"), close = h("button", { type: "button", class: "ico fc__x", "aria-label": "Cerrar la ficha", onclick: () => select(null) }, icon("x", 20));
    const head = h("header", { class: "fc__head" }, h("div", {}, name, sub), chipBox, close);
    const spd = h("strong"), dirB = h("b"), dirS = h("small"), comp = h("span", { class: "fc__compass" }, icon("arrow", 18));
    const speedBox = h("div", { class: "fc__speed" }, h("div", {}, spd, h("span", {}, "km/h")), h("div", { class: "fc__dir" }, comp, dirB, dirS));
    const none = h("p", { class: "fc__none" });
    const stat = (l) => { const val = h("strong"); return { val, el: h("div", { class: "fc__stat" }, h("span", {}, l), val) }; };
    const sMotor = stat("Motor"), sAgo = stat("Último dato"), sV = stat("Tensión"), sOdo = stat("Odómetro"), sSig = stat("Señal"), sSat = stat("Satélites");
    const grid = h("div", { class: "fc__grid" }, sMotor.el, sAgo.el, sV.el, sOdo.el, sSig.el, sSat.el);
    const coords = h("span", { class: "mono" }), aMap = h("a", { target: "_blank", rel: "noopener" }, "Mapa"), aStreet = h("a", { target: "_blank", rel: "noopener" }, "Street View");
    const loc = h("p", { class: "fc__loc" }, icon("pin", 16), coords, aMap, aStreet);
    const tripBox = h("div"), alertsBox = h("div");
    const follow = h("button", { type: "button", class: "btn btn--ghost", onclick: () => { const on = api.isFollowing() !== v.id; api.follow(on ? v.id : null); if (on) api.focus(v.id, 15); syncFollow(); } }, "Seguir");
    const replay = h("button", { type: "button", class: "btn btn--ghost", onclick: () => openReplay(ctx, F, { vehicleId: v.id }) }, icon("ruta", 18), "Recorrido de hoy");
    const trip = h("button", { type: "button", class: "btn btn--ghost", hidden: true }, "Ver viaje");
    const syncFollow = () => { const on = api?.isFollowing() === v.id; follow.classList.toggle("btn--ghost", !on); setText(follow, on ? "Siguiendo" : "Seguir"); };
    const nodes = [head, speedBox, none, grid, loc, tripBox, alertsBox, h("div", { class: "fc__acts" }, follow, replay, trip)];
    let tripSig = "", alertsSig = "", chipSig = "";

    return { nodes, update(r) {
      const { st } = r, S = STATUS[r.status], T = r.trip;
      setText(sub, [v.plate, v.notes].filter(Boolean).join(" · ") || "Sin patente cargada");
      if (chipSig !== S.label) { chipSig = S.label; chipBox.replaceChildren(chip(S.label, S.tone)); }
      const has = !!(st && st.last_time);
      speedBox.hidden = !has; grid.hidden = !has; none.hidden = has; loc.hidden = !(st && st.lat != null);
      setText(none, v.device_id ? "Todavía no transmitió ninguna posición." : "Este coche no tiene equipo GPS cargado.");
      if (has) {
        setText(spd, String(Math.round(st.speed || 0))); setText(dirB, compass(st.course || 0)); setText(dirS, `${Math.round(st.course || 0)}°`); comp.style.transform = `rotate(${Math.round(st.course || 0)}deg)`;
        setText(sMotor.val, st.ignition ? "Encendido" : "Apagado"); setText(sAgo.val, ago(r.seen)); sAgo.el.title = `Última posición a las ${fmtHm(st.last_time)}`;
        setText(sV.val, st.voltage != null ? `${Number(st.voltage).toFixed(1)} V` : "—"); setText(sOdo.val, st.odometer_m != null ? `${km(st.odometer_m, 0)} km` : "—"); setText(sSat.val, st.sats != null ? String(st.sats) : "—");
        const bars = csqBars(st.csq), bk = String(bars);
        if (sSig.val.dataset.b !== bk) { sSig.val.dataset.b = bk; sSig.val.replaceChildren(h("span", { class: "fc__bars", role: "img", "aria-label": `Señal ${bars} de 5` }, [1, 2, 3, 4, 5].map((i) => h("i", { class: i <= bars ? "on" : "", style: `height:${4 + i * 3}px` })))); }
      }
      if (st && st.lat != null) { setText(coords, `${Number(st.lat).toFixed(5)}, ${Number(st.lng).toFixed(5)}`); aMap.href = `https://www.google.com/maps?q=${st.lat},${st.lng}`; aStreet.href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${st.lat},${st.lng}`; }
      follow.disabled = !(st && st.lat != null); replay.disabled = !v.device_id; syncFollow();
      trip.hidden = !T; if (T) trip.onclick = () => ctx.go("viajes", { date: T.trip_date, open: T.id });

      // viaje y alertas: se rearman solo si cambiaron
      const stopsDef = T ? F.routeStops.filter((x) => x.route_id === T.route_id).sort((a, b) => a.idx - b.idx) : [];
      const tripStops = new Map(F.tripStops.filter((x) => x.trip_id === T?.id).map((x) => [x.idx, x]));
      const tSig = JSON.stringify([T?.id, T?.status, stopsDef.map((d) => [d.idx, d.name, tripStops.get(d.idx)?.status, tripStops.get(d.idx)?.arrived_at, tripStops.get(d.idx)?.delay_min]), F.settings.delayTolMin]);
      if (tSig !== tripSig) {
        tripSig = tSig;
        const route = T && F.routes.find((x) => x.route_id === T.route_id);
        tripBox.replaceChildren(...(T ? [h("section", { class: "fc__trip" }, h("div", { class: "fc__triphead" }, h("div", {}, h("small", {}, "Viaje"), h("strong", {}, `${T.trip_time} · ${ctx.routeName(T.route_id).replace(/ · .*/, "")}`)), chip(TRIP_STATUS[T.status].label, TRIP_STATUS[T.status].tone)),
          stopsDef.length ? h("ol", { class: "fc__stops" }, stopsDef.map((d) => { const ts = tripStops.get(d.idx), late = ts && ts.delay_min > F.settings.delayTolMin;
            return h("li", { class: "fc__stop is-" + (ts ? ts.status : "pendiente") }, h("i", { class: "fc__node" }), h("span", {}, d.name), ts && ts.arrived_at ? h("em", {}, fmtHm(ts.arrived_at), late ? h("b", { class: "late" }, ` +${ts.delay_min}\u2032`) : null) : h("em", {}, "—")); }))
            : h("p", { class: "fc__none" }, route ? "Este recorrido todavía no tiene paradas." : "Este servicio todavía no tiene recorrido cargado. Se arma en Geocercas y recorridos."))] : []));
      }
      const aSig = JSON.stringify(r.alerts.slice(0, 4).map((a) => [a.id, a.ack_at, a.detail]));
      if (aSig !== alertsSig) {
        alertsSig = aSig;
        alertsBox.replaceChildren(...(r.alerts.length ? [h("section", { class: "fc__alerts" }, h("h3", {}, "Alertas sin atender"), r.alerts.slice(0, 4).map((a) => h("div", { class: "fc__alert is-" + a.severity }, icon(ALERTS[a.kind]?.icon || "alert", 16), h("div", {}, h("b", {}, a.title), h("small", {}, `${fmtWhen(a.started_at)}${a.detail ? " · " + a.detail : ""}`)),
          h("button", { type: "button", class: "btn btn--ghost fc__ack", onclick: async (e) => { e.currentTarget.disabled = true; try { await ackAlert(a.id); fleet.patchAlert(a.id, { ack_at: new Date().toISOString() }); } catch (x) { toast(plainErr(x), "err", 6000); e.currentTarget.disabled = false; } } }, "Atendida"))))] : []));
      }
    } };
  }

  // ------------------------------------------------------------------ en vivo
  createFleetMap(mapEl, { base: LS.get("flota.base") || "oscuro", onSelect: (id) => select(id, false) }).then((m) => {
    if (!mapEl.isConnected) { m.destroy(); return; }
    api = m;
    const bar = mapTools(api, { onFit: () => (selected ? api.focus(selected) : api.fit()), extra: [rulerBtn, nearBtn, fenceBtn, soundBtn] });
    api.map.on("click", onToolClick);
    mapEl.parentElement.append(bar);
    bar.querySelector(".mt-bases")?.addEventListener("click", () => LS.set("flota.base", api.base()));
    api.select(selected); drawList(); drawFences();
  }).catch((e) => { mapEl.replaceChildren(h("p", { class: "fl__maperr" }, "No se pudo cargar el mapa. Revisá tu conexión.")); console.warn("[flota] mapa", e); });

  const off = fleet.on((what) => { F = fleet.get(); if (what === "states" || what === "alerts" || what === "load") drawList(); });
  const stopLive = watchLive({
    onStates: (r) => fleet.patchStates(r),
    onAlerts: (r, live) => { const fresh = fleet.patchAlerts(r); if (!live && !fresh.length) return; for (const a of fresh.filter((x) => !x.ended_at && Date.now() - Date.parse(x.started_at) < 120_000)) {
      const v = F.vehicleById.get(a.vehicle_id); toast(`${v?.code || "Coche"}: ${a.title}`, a.severity === "critica" ? "err" : "ok", 9000, { label: "Ver", icon: "arrow", run: () => select(a.vehicle_id, true) }); if (sound && a.severity === "critica") beep(); } },
  });
  const tick = setInterval(() => { if (!document.hidden) drawList(); }, 10_000);
  const esc = (e) => { if (e.key === "Escape" && tool) setTool(null); };
  document.addEventListener("keydown", esc);
  ctx.cleanup(() => { off(); stopLive(); clearInterval(tick); document.removeEventListener("keydown", esc); api?.destroy(); api = null; });
  drawList();
  if (selected) select(selected, true);
}
