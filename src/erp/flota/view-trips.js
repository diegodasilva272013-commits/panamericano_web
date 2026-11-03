// Viajes: las salidas de cada día con el coche asignado, y cómo viene cada una (salida, paradas, llegada, atrasos).
import { h, icon, chip, kpi, table, input, drawer, put } from "../kit.js";
import { toast, plainErr } from "../../admin/ui.js";
import { pageHead } from "../views-ops.js";
import { tripsOn, routeName } from "../trips.js";
import { addDays, fmtDayLong } from "../model.js";
import { fleet } from "./store.js";
import { save, fetchTripsOn } from "./data.js";
import { showError } from "./view-live.js";
import { openReplay } from "./replay.js";
import { TRIP_STATUS, STOP_STATUS, ALERTS, SEVERITY, fmtHm, fmtWhen, dur, jujuyDay, km } from "./status.js";

const VS = { date: "" };

export function viajes(ctx, pre = {}) {
  if (pre.date) VS.date = pre.date;
  const page = h("div", { class: "page" }, h("p", { class: "boot" }, "Cargando los viajes…"));
  fleet.ensure().then((F) => mount(page, ctx, F, pre)).catch((e) => showError(page, e, () => ctx.redraw()));
  return page;
}

function mount(page, ctx, F, pre) {
  const today = jujuyDay();
  if (!VS.date) VS.date = today;
  let day = { trips: [], stops: [] }, seq = 0;
  const body = h("div", { class: "vstack" });
  const dateIn = h("input", { type: "date", value: VS.date, "aria-label": "Día", onchange: (e) => { if (e.target.value) { VS.date = e.target.value; load(); } } });
  const go = (n) => { VS.date = addDays(VS.date, n); dateIn.value = VS.date; load(); };
  const vehicles = () => fleet.get().vehicles.filter((v) => v.active !== false);

  async function load() {
    const my = ++seq; put(body, h("p", { class: "boot" }, "Cargando…"));
    try { const d = await fetchTripsOn(VS.date); if (my !== seq) return; day = d; draw(); if (pre.open) { const t = day.trips.find((x) => x.id === pre.open); pre = {}; if (t) detail(t); } }
    catch (e) { if (my === seq) put(body, h("p", { class: "err", role: "alert" }, plainErr(e))); }
  }

  function draw() {
    const F2 = fleet.get(), deps = tripsOn(ctx.data(), ctx.bks(), VS.date);
    const byKey = new Map(day.trips.map((t) => [`${t.route_id}|${t.trip_time}`, t]));
    // viajes cargados que ya no figuran en el horario (se sacó un horario del panel) también se muestran
    for (const t of day.trips) if (!deps.some((d) => d.key === `${t.route_id}|${t.trip_time}`)) deps.push({ key: `${t.route_id}|${t.trip_time}`, routeId: t.route_id, time: t.trip_time, pax: 0, seats: 0, cap: 0, extra: true });
    deps.sort((a, b) => a.time.localeCompare(b.time) || a.routeId.localeCompare(b.routeId));
    const stopsOf = (t) => day.stops.filter((s) => s.trip_id === t.id);
    const routeStopCount = (rid) => F2.routeStops.filter((s) => s.route_id === rid).length;
    const rows = deps.map((d) => ({ d, t: byKey.get(d.key) || null }));
    const assigned = rows.filter((r) => r.t?.vehicle_id).length;
    const delayed = rows.filter((r) => stopsOf(r.t || {}).some((s) => s.delay_min > F2.settings.delayTolMin) || r.t?.delayed).length;
    const omitted = day.stops.filter((s) => s.status === "omitida").length;
    put(body,
      h("div", { class: "kpis kpis--sm" },
        kpi({ label: "Salidas del día", value: rows.length, sub: `${assigned} con coche asignado` }),
        kpi({ label: "En curso", value: rows.filter((r) => r.t?.status === "en_curso").length, tone: "ok" }),
        kpi({ label: "Completadas", value: rows.filter((r) => r.t?.status === "completado").length }),
        kpi({ label: "Con atraso", value: delayed, tone: delayed ? "warn" : "" }),
        kpi({ label: "Paradas sin frenar", value: omitted, tone: omitted ? "bad" : "" })),
      h("section", { class: "panel" }, table({
        label: "Salidas del día", rows, empty: "Ese día no hay salidas en el horario de la web.", onRow: (r) => (r.t ? detail(r.t) : toast("Asignale un coche a la salida para poder seguirla.", "ok", 3500)),
        cols: [
          { h: "Hora", c: (r) => h("strong", { class: "mono" }, r.d.time) },
          { h: "Servicio", c: (r) => h("span", {}, routeName(ctx.data().content, r.d.routeId).replace(/ · .*/, ""), !routeStopCount(r.d.routeId) ? h("small", { class: "block sub" }, "sin recorrido cargado") : null) },
          { h: "Pasajeros", c: (r) => (r.d.pax ? `${r.d.pax} de ${r.d.cap}` : "—"), num: true },
          { h: "Coche", c: (r) => {
            const sel = h("select", { class: "tsel", "aria-label": `Coche de la salida de las ${r.d.time}`, onclick: (e) => e.stopPropagation(), onchange: async (e) => {
              sel.disabled = true;
              try { await save.trip({ route_id: r.d.routeId, trip_date: VS.date, trip_time: r.d.time, vehicle_id: e.target.value }); const nd = await fetchTripsOn(VS.date); day = nd; fleet.reload().catch(() => {}); draw(); toast(e.target.value ? "Coche asignado." : "Coche quitado.", "ok", 2200); }
              catch (x) { toast(plainErr(x), "err", 8000); sel.disabled = false; }
            } }, h("option", { value: "" }, "— sin asignar —"), vehicles().map((v) => h("option", { value: v.id, selected: r.t?.vehicle_id === v.id ? true : null }, v.code + (v.device_id ? "" : " (sin equipo)"))));
            return sel; } },
          { h: "Estado", c: (r) => (r.t ? chip(TRIP_STATUS[r.t.status].label, TRIP_STATUS[r.t.status].tone) : h("span", { class: "sub" }, "—")) },
          { h: "Salió", c: (r) => (r.t?.started_at ? fmtHm(r.t.started_at) : "—") },
          { h: "Paradas", c: (r) => { if (!r.t) return "—"; const st = stopsOf(r.t), ok = st.filter((s) => s.status === "ok").length, bad = st.filter((s) => s.status === "omitida").length; return st.length ? h("span", { class: "chips" }, `${ok}/${routeStopCount(r.d.routeId) || st.length}`, bad ? chip(`${bad} sin frenar`, "bad") : null) : "—"; }, num: true },
          { h: "", c: (r) => (r.t ? h("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: (e) => { e.stopPropagation(); detail(r.t); } }, "Detalle") : null) },
        ] })));
  }

  function detail(t) {
    const F2 = fleet.get(), v = F2.vehicleById.get(t.vehicle_id), stops = day.stops.filter((s) => s.trip_id === t.id).sort((a, b) => a.idx - b.idx);
    const def = F2.routeStops.filter((s) => s.route_id === t.route_id).sort((a, b) => a.idx - b.idx);
    const rows = def.length ? def.map((d) => ({ d, s: stops.find((x) => x.idx === d.idx) || null })) : stops.map((s) => ({ d: { idx: s.idx, name: s.name }, s }));
    const alerts = F2.alerts.filter((a) => a.trip_id === t.id);
    const from = new Date((t.started_at ? Date.parse(t.started_at) : Date.parse(t.planned_at)) - 30 * 60_000), to = t.ended_at ? new Date(Date.parse(t.ended_at) + 20 * 60_000) : new Date();
    const dayStr = jujuyDay(from.getTime());
    const hm = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Jujuy", hour: "2-digit", minute: "2-digit" }).format(d);
    const body2 = h("div", { class: "dsec" },
      h("div", { class: "kpis kpis--sm" }, kpi({ label: "Coche", value: v?.code || "—", sub: v?.plate || "" }), kpi({ label: "Estado", value: TRIP_STATUS[t.status].label }),
        kpi({ label: "Salida", value: t.started_at ? fmtHm(t.started_at) : "—", sub: `programada ${t.trip_time}` }), kpi({ label: "Distancia", value: t.distance_m != null ? `${km(t.distance_m)} km` : "—", sub: t.max_speed ? `máx. ${t.max_speed} km/h` : "" })),
      h("h3", {}, "Paradas"),
      rows.length ? table({ label: "Paradas del viaje", rows, cols: [
        { h: "#", c: (r) => String(r.d.idx + 1), num: true }, { h: "Parada", c: (r) => r.d.name },
        { h: "Esperada", c: (r) => (r.s?.planned_at ? fmtHm(r.s.planned_at) : "—") }, { h: "Llegó", c: (r) => (r.s?.arrived_at ? fmtHm(r.s.arrived_at) : "—") }, { h: "Salió", c: (r) => (r.s?.departed_at ? fmtHm(r.s.departed_at) : "—") },
        { h: "Detenido", c: (r) => (r.s?.dwell_s != null ? dur(r.s.dwell_s) : "—"), num: true },
        { h: "Atraso", c: (r) => (r.s?.delay_min == null ? "—" : h("span", { class: r.s.delay_min > F2.settings.delayTolMin ? "neg" : "" }, `${r.s.delay_min > 0 ? "+" : ""}${r.s.delay_min} min`)), num: true },
        { h: "Resultado", c: (r) => { const st = r.s ? STOP_STATUS[r.s.status] : STOP_STATUS.pendiente; return chip(st.label, st.tone); } },
      ] }) : h("p", { class: "empty" }, "Este servicio todavía no tiene paradas cargadas. Se arman en Geocercas y recorridos."),
      alerts.length ? [h("h3", {}, "Alertas del viaje"), h("div", { class: "lines" }, alerts.map((a) => h("div", { class: "line line--static" }, icon(ALERTS[a.kind]?.icon || "alert", 16), h("span", { class: "line__m" }, `${a.title}${a.detail ? " · " + a.detail : ""}`), chip(SEVERITY[a.severity]?.label || a.severity, SEVERITY[a.severity]?.tone), h("small", { class: "sub" }, fmtWhen(a.started_at)))))] : null,
      h("div", { class: "payform__act" },
        h("button", { type: "button", class: "btn btn--ghost", disabled: !t.vehicle_id, onclick: () => { dr.close(); openReplay(ctx, fleet.get(), { vehicleId: t.vehicle_id, day: dayStr, from: hm(from), to: dayStr === jujuyDay(to.getTime()) ? hm(to) : "23:59" }); } }, icon("ruta", 18), "Ver el recorrido"),
        h("button", { type: "button", class: "btn", disabled: !t.vehicle_id, onclick: () => { dr.close(); ctx.go("mapa", { vehicle: t.vehicle_id }); } }, "Ver en el mapa")));
    const dr = drawer({ title: `${t.trip_time} · ${routeName(ctx.data().content, t.route_id).replace(/ · .*/, "")}`, sub: fmtDayLong(t.trip_date), body: body2 });
  }

  put(page, pageHead("Viajes", "Cada salida del día con su coche, y cómo viene: cuándo salió, dónde frenó y si hay atrasos.",
    h("div", { class: "datebar no-print" }, h("button", { type: "button", class: "ico", "aria-label": "Día anterior", onclick: () => go(-1) }, h("span", { class: "flip" }, icon("arrow", 20))), dateIn,
      h("button", { type: "button", class: "ico", "aria-label": "Día siguiente", onclick: () => go(1) }, icon("arrow", 20)), h("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: () => { VS.date = jujuyDay(); dateIn.value = VS.date; load(); } }, "Hoy"))), body);
  const timer = setInterval(() => { if (!document.hidden && !document.querySelector(".drawer")) load(); }, 20_000);
  ctx.cleanup(() => clearInterval(timer));
  load();
}
