// Mapa en vivo: todos los coches con velocidad, rumbo, estado y viaje; ficha de cada coche; alertas al instante.
import { h, icon, chip, put } from "../kit.js";
import { toast, plainErr } from "../../admin/ui.js";
import { fleet, openAlerts } from "./store.js";
import { watchLive, ackAlert } from "./data.js";
import { createFleetMap, mapTools } from "./map.js";
import { STATUS, ALERTS, SEVERITY, TRIP_STATUS, STOP_STATUS, vehicleStatus, ago, compass, csqBars, km, fmtHm, fmtWhen } from "./status.js";
import { openReplay } from "./replay.js";

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
  const stamp = h("span", { class: "fl__stamp" });
  const search = h("input", { type: "search", class: "fl__search", placeholder: "Buscar coche o patente", "aria-label": "Buscar coche o patente", maxlength: 30, oninput: (e) => { query = e.target.value; drawList(); } });
  const chips = h("div", { class: "fl__chips", role: "group", "aria-label": "Filtrar por estado" });
  const empty = h("div", { class: "fl__none", hidden: true });

  const soundBtn = h("button", { type: "button", class: "mt", title: "Sonido al llegar una alerta crítica", "aria-label": "Sonido de alertas", "aria-pressed": String(sound), onclick: () => { sound = !sound; LS.set("flota.sound", sound ? "1" : "0"); soundBtn.setAttribute("aria-pressed", String(sound)); soundBtn.classList.toggle("is-on", sound); if (sound) beep(); } }, icon("campana", 20));
  soundBtn.classList.toggle("is-on", sound);
  const fenceBtn = h("button", { type: "button", class: "mt", title: "Mostrar las geocercas", "aria-label": "Mostrar las geocercas", "aria-pressed": "false", onclick: () => { fencesAll = !fencesAll; fenceBtn.setAttribute("aria-pressed", String(fencesAll)); fenceBtn.classList.toggle("is-on", fencesAll); drawFences(); } }, icon("geocerca", 20));

  const wrap = h("div", { class: "fl" },
    h("section", { class: "fl__side", "aria-label": "Coches" }, h("div", { class: "fl__sidehead" }, search, chips), list, empty),
    h("section", { class: "fl__stage", "aria-label": "Mapa" }, mapEl, kpis, card, stamp));
  page.replaceChildren(wrap);

  // ------------------------------------------------------------------ lista
  const rows = () => rowsOf(F);
  const match = (r) => {
    if (filter === "alert" ? !r.alerts.length : filter !== "all" && r.status !== filter) return false;
    const q = norm(query).trim(); return !q || norm(r.v.code).includes(q) || norm(r.v.plate).includes(q);
  };

  function drawChips(all) {
    const count = (k) => (k === "all" ? all.length : k === "alert" ? all.filter((r) => r.alerts.length).length : all.filter((r) => r.status === k).length);
    put(chips, FILTERS.map(([k, l]) => h("button", { type: "button", class: "fl__chip" + (filter === k ? " is-on" : ""), "aria-pressed": String(filter === k), onclick: () => { filter = k; drawList(); } }, l, h("b", {}, String(count(k))))));
  }

  function drawList() {
    const all = rows(), shown = all.filter(match);
    drawChips(all); drawKpis(all);
    const order = { moving: 0, idle: 1, parked: 2, offline: 3, nodata: 4, nodevice: 5 };
    shown.sort((a, b) => (b.alerts.length ? 1 : 0) - (a.alerts.length ? 1 : 0) || order[a.status] - order[b.status] || a.v.code.localeCompare(b.v.code, "es", { numeric: true }));
    put(list, shown.map((r) => {
      const s = STATUS[r.status];
      return h("button", { type: "button", role: "listitem", class: "fv fv--" + r.status + (selected === r.v.id ? " is-sel" : ""), "data-id": r.v.id, "aria-pressed": String(selected === r.v.id), onclick: () => select(r.v.id, true) },
        h("span", { class: "fv__dot", "aria-hidden": "true" }),
        h("span", { class: "fv__name" }, h("b", {}, r.v.code), h("small", {}, [r.v.plate, r.trip && r.trip.status === "en_curso" ? ctx.routeName(r.trip.route_id).replace(/ · .*/, "") : ""].filter(Boolean).join(" · ") || s.label)),
        h("span", { class: "fv__speed" }, r.status === "moving" ? h("b", {}, String(Math.round(r.st.speed || 0)), h("i", {}, " km/h")) : h("small", {}, s.label)),
        h("span", { class: "fv__age" }, r.seen ? ago(r.seen) : "—"),
        r.alerts.length ? h("span", { class: "fv__al", title: `${r.alerts.length} ${r.alerts.length === 1 ? "alerta" : "alertas"} sin atender` }, icon("alert", 14), String(r.alerts.length)) : null);
    }));
    empty.hidden = shown.length > 0;
    if (!shown.length) empty.replaceChildren(h("p", {}, all.length ? "Ningún coche coincide con el filtro." : "Todavía no cargaste coches."),
      !all.length ? h("button", { type: "button", class: "btn", onclick: () => ctx.go("vehiculos", {}) }, "Cargar coches") : h("button", { type: "button", class: "btn btn--ghost", onclick: () => { filter = "all"; query = ""; search.value = ""; drawList(); } }, "Quitar filtros"));
    paintMap(all);
    if (selected) drawCard();
  }

  function drawKpis(all) {
    const n = (k) => all.filter((r) => r.status === k).length, al = openAlerts(F).length;
    const k = (l, v, tone = "") => h("span", { class: "fl__k" + (tone ? " is-" + tone : "") }, h("b", {}, String(v)), l);
    put(kpis, k("coches", all.length), k("en marcha", n("moving"), "ok"), k("detenidos", n("idle") + n("parked")), k("sin señal", n("offline"), n("offline") ? "bad" : ""), al ? h("button", { type: "button", class: "fl__k fl__k--al", onclick: () => ctx.go("alertas", {}) }, icon("alert", 15), h("b", {}, String(al)), al === 1 ? "alerta" : "alertas") : null);
    stamp.textContent = "En vivo · " + new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Argentina/Jujuy" }).format(new Date());
  }

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
    document.querySelectorAll(".fv.is-sel").forEach((b) => b.scrollIntoView?.({ block: "nearest" }));
  }

  function drawCard() {
    const r = rows().find((x) => x.v.id === selected);
    if (!r) { card.hidden = true; return; }
    const { v, st } = r, s = STATUS[r.status];
    const stat = (l, val) => h("div", { class: "fc__stat" }, h("span", {}, l), h("strong", {}, val));
    const bars = csqBars(st?.csq);
    const signal = h("span", { class: "fc__bars", role: "img", "aria-label": `Señal ${bars} de 5` }, [1, 2, 3, 4, 5].map((i) => h("i", { class: i <= bars ? "on" : "", style: `height:${4 + i * 3}px` })));
    const T = r.trip, route = T && F.routes.find((x) => x.route_id === T.route_id);
    const stopsDef = T ? F.routeStops.filter((x) => x.route_id === T.route_id).sort((a, b) => a.idx - b.idx) : [];
    const tripStops = new Map(F.tripStops.filter((x) => x.trip_id === T?.id).map((x) => [x.idx, x]));
    const gmaps = st && st.lat != null ? `https://www.google.com/maps?q=${st.lat},${st.lng}` : null;
    const street = st && st.lat != null ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${st.lat},${st.lng}` : null;
    put(card,
      h("header", { class: "fc__head" }, h("div", {}, h("h2", {}, v.code), h("p", {}, [v.plate, v.notes].filter(Boolean).join(" · ") || "Sin patente cargada")), chip(s.label, s.tone), h("button", { type: "button", class: "ico fc__x", "aria-label": "Cerrar la ficha", onclick: () => select(null) }, icon("x", 20))),
      st && st.last_time ? h("div", { class: "fc__speed" }, h("div", {}, h("strong", {}, String(Math.round(st.speed || 0))), h("span", {}, "km/h")), h("div", { class: "fc__dir" }, h("span", { class: "fc__compass", style: `transform:rotate(${Math.round(st.course || 0)}deg)` }, icon("arrow", 18)), h("b", {}, compass(st.course || 0)), h("small", {}, `${Math.round(st.course || 0)}°`))) : h("p", { class: "fc__none" }, v.device_id ? "Todavía no transmitió ninguna posición." : "Este coche no tiene equipo GPS cargado."),
      st && st.last_time ? h("div", { class: "fc__grid" }, stat("Motor", st.ignition ? "Encendido" : "Apagado"), stat("Último dato", `${fmtHm(st.last_time)} · ${ago(r.seen)}`), stat("Tensión", st.voltage != null ? `${Number(st.voltage).toFixed(1)} V` : "—"), stat("Odómetro", st.odometer_m != null ? `${km(st.odometer_m, 0)} km` : "—"), stat("Señal", signal), stat("Satélites", st.sats != null ? String(st.sats) : "—")) : null,
      st && st.lat != null ? h("p", { class: "fc__loc" }, icon("pin", 16), h("span", { class: "mono" }, `${Number(st.lat).toFixed(5)}, ${Number(st.lng).toFixed(5)}`), h("a", { href: gmaps, target: "_blank", rel: "noopener" }, "Mapa"), h("a", { href: street, target: "_blank", rel: "noopener" }, "Street View")) : null,
      T ? h("section", { class: "fc__trip" }, h("div", { class: "fc__triphead" }, h("div", {}, h("small", {}, "Viaje"), h("strong", {}, `${T.trip_time} · ${ctx.routeName(T.route_id).replace(/ · .*/, "")}`)), chip(TRIP_STATUS[T.status].label, TRIP_STATUS[T.status].tone)),
        stopsDef.length ? h("ol", { class: "fc__stops" }, stopsDef.map((d) => { const ts = tripStops.get(d.idx), tone = ts ? STOP_STATUS[ts.status]?.tone || "off" : "off"; const late = ts && ts.delay_min > F.settings.delayTolMin;
          return h("li", { class: "fc__stop is-" + (ts ? ts.status : "pendiente") }, h("i", { class: "fc__node" }), h("span", {}, d.name), ts && ts.arrived_at ? h("em", {}, fmtHm(ts.arrived_at), late ? h("b", { class: "late" }, ` +${ts.delay_min}′`) : null) : h("em", {}, "—")); })) : h("p", { class: "fc__none" }, route ? "Este recorrido todavía no tiene paradas." : "Este servicio todavía no tiene recorrido cargado. Se arma en Geocercas y recorridos.")) : null,
      r.alerts.length ? h("section", { class: "fc__alerts" }, h("h3", {}, "Alertas sin atender"), r.alerts.slice(0, 4).map((a) => h("div", { class: "fc__alert is-" + a.severity }, icon(ALERTS[a.kind]?.icon || "alert", 16), h("div", {}, h("b", {}, a.title), h("small", {}, `${fmtWhen(a.started_at)}${a.detail ? " · " + a.detail : ""}`)),
        h("button", { type: "button", class: "btn btn--ghost fc__ack", onclick: async (e) => { e.currentTarget.disabled = true; try { await ackAlert(a.id); fleet.patchAlert(a.id, { ack_at: new Date().toISOString() }); } catch (x) { toast(plainErr(x), "err", 6000); e.currentTarget.disabled = false; } } }, "Atendida")))) : null,
      h("div", { class: "fc__acts" },
        h("button", { type: "button", class: "btn" + (api?.isFollowing() === v.id ? "" : " btn--ghost"), disabled: !st || st.lat == null, onclick: (e) => { const on = api.isFollowing() !== v.id; api.follow(on ? v.id : null); if (on) api.focus(v.id, 15); e.currentTarget.classList.toggle("btn--ghost", !on); e.currentTarget.textContent = on ? "Siguiendo" : "Seguir"; } }, api?.isFollowing() === v.id ? "Siguiendo" : "Seguir"),
        h("button", { type: "button", class: "btn btn--ghost", disabled: !v.device_id, onclick: () => openReplay(ctx, F, { vehicleId: v.id }) }, icon("ruta", 18), "Recorrido de hoy"),
        T ? h("button", { type: "button", class: "btn btn--ghost", onclick: () => ctx.go("viajes", { date: T.trip_date, open: T.id }) }, "Ver viaje") : null));
  }

  // ------------------------------------------------------------------ en vivo
  createFleetMap(mapEl, { base: LS.get("flota.base") || "oscuro", onSelect: (id) => select(id, false) }).then((m) => {
    if (!mapEl.isConnected) { m.destroy(); return; }
    api = m;
    const bar = mapTools(api, { onFit: () => (selected ? api.focus(selected) : api.fit()), extra: [fenceBtn, soundBtn] });
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
  ctx.cleanup(() => { off(); stopLive(); clearInterval(tick); api?.destroy(); api = null; });
  drawList();
  if (selected) select(selected, true);
}
