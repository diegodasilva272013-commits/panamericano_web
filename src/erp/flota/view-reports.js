// Reportes de la flota. Cada uno se ve en pantalla y se baja a Excel, PDF o CSV.
import { h, icon, table, input, put } from "../kit.js";
import { toast, plainErr } from "../../admin/ui.js";
import { pageHead } from "../views-ops.js";
import { routeName } from "../trips.js";
import { addDays, CATEGORIES, money } from "../model.js";
import { fleet } from "./store.js";
import { fetchPositions, fetchDaily, fetchTripsRange, fetchEventsRange, fetchAlertsRange } from "./data.js";
import { showError, rowsOf } from "./view-live.js";
import { toXlsx, toPdf, toCsvText, downloadBytes, MIME, safeName } from "./export.js";
import { STATUS, TRIP_STATUS, STOP_STATUS, ALERTS, SEVERITY, vehicleStatus, ago, fmtFull, fmtDayEs, dayStart, dayEnd, jujuyDay, dur, km } from "./status.js";

const nameOf = (F, id) => F.vehicleById.get(id)?.code || "—";
const num = (n, d = 1) => (n == null || n === "" ? null : Math.round(Number(n) * 10 ** d) / 10 ** d);
const daysTo = (iso, today) => Math.round((Date.parse(iso + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 864e5);
const vehFilter = (F, p) => (p.vehicles.length ? p.vehicles : F.vehicles.map((v) => v.id));
const rangeLabel = (p) => (p.from === p.to ? fmtDayEs(p.from) : `del ${fmtDayEs(p.from)} al ${fmtDayEs(p.to)}`);
const whoLabel = (F, p) => (p.vehicles.length ? p.vehicles.map((id) => nameOf(F, id)).join(", ") : "todos los coches");

/** Definición de cada reporte. needs: qué filtros usa. run devuelve { columns, rows, subtitle }. */
export const REPORTS = [
  { id: "posiciones", group: "Recorridos", icon: "gps", title: "Posiciones", desc: "Cada posición que transmitió un coche en un horario: dónde estuvo, a qué velocidad y con qué rumbo.", needs: ["vehicle", "range", "time"], defaultDays: 0,
    async run(p, F) {
      const a = new Date(`${p.from}T${p.timeFrom || "00:00"}:00-03:00`).toISOString(), b = new Date(`${p.to}T${p.timeTo || "23:59"}:59-03:00`).toISOString();
      const rows = await fetchPositions(p.vehicle, a, b, { max: 50000 });
      return { subtitle: `${nameOf(F, p.vehicle)} · ${rangeLabel(p)} ${p.timeFrom || "00:00"}-${p.timeTo || "23:59"}${rows.length >= 50000 ? " · primeras 50.000 posiciones" : ""}`,
        columns: [{ h: "Fecha y hora" }, { h: "Latitud", num: true }, { h: "Longitud", num: true }, { h: "Velocidad (km/h)", num: true }, { h: "Rumbo (°)", num: true }, { h: "Motor" }, { h: "Tensión (V)", num: true }, { h: "Odómetro (km)", num: true }],
        rows: rows.map((r) => [fmtFull(r.event_time, true), num(r.lat, 5), num(r.lng, 5), r.speed, r.course, r.ignition ? "Encendido" : "Apagado", num(r.voltage, 1), r.odometer_m != null ? num(r.odometer_m / 1000, 1) : null]) };
    } },
  { id: "ultimas", group: "Recorridos", icon: "pin", title: "Últimas posiciones", desc: "Dónde está cada coche ahora, con un enlace para abrirlo en el mapa.", needs: ["vehicles"],
    async run(p, F) {
      const list = rowsOf(F).filter((r) => vehFilter(F, p).includes(r.v.id));
      return { subtitle: `${whoLabel(F, p)} · al ${fmtFull(new Date().toISOString())}`,
        columns: [{ h: "Coche" }, { h: "Patente" }, { h: "Último dato" }, { h: "Estado" }, { h: "Velocidad (km/h)", num: true }, { h: "Latitud", num: true }, { h: "Longitud", num: true }, { h: "Mapa" }],
        rows: list.map((r) => [r.v.code, r.v.plate, r.st?.last_time ? fmtFull(r.st.last_time) : "Sin datos", STATUS[r.status].label, r.st?.speed ?? null, num(r.st?.lat, 5), num(r.st?.lng, 5), r.st?.lat != null ? `https://www.google.com/maps?q=${r.st.lat},${r.st.lng}` : ""]) };
    } },
  { id: "estado", group: "Recorridos", icon: "campana", title: "Estado actual de la flota", desc: "Cómo está cada coche en este momento: estado, motor, tensión, señal y viaje.", needs: ["vehicles"],
    async run(p, F, ctx) {
      const list = rowsOf(F).filter((r) => vehFilter(F, p).includes(r.v.id));
      return { subtitle: `${whoLabel(F, p)} · al ${fmtFull(new Date().toISOString())}`,
        columns: [{ h: "Coche" }, { h: "Estado" }, { h: "Motor" }, { h: "Velocidad (km/h)", num: true }, { h: "Tensión (V)", num: true }, { h: "Señal (CSQ)", num: true }, { h: "Satélites", num: true }, { h: "Odómetro (km)", num: true }, { h: "Último dato" }, { h: "Viaje" }],
        rows: list.map((r) => [r.v.code, STATUS[r.status].label, r.st ? (r.st.ignition ? "Encendido" : "Apagado") : "", r.st?.speed ?? null, num(r.st?.voltage, 1), r.st?.csq ?? null, r.st?.sats ?? null, r.st?.odometer_m != null ? num(r.st.odometer_m / 1000, 1) : null, r.seen ? `${fmtFull(new Date(r.seen).toISOString())} (${ago(r.seen)})` : "Sin datos", r.trip ? `${r.trip.trip_time} ${routeName(ctx.data().content, r.trip.route_id).replace(/ · .*/, "")} · ${TRIP_STATUS[r.trip.status].label}` : ""]) };
    } },
  { id: "distancias", group: "Recorridos", icon: "ruta", title: "Distancias diarias", desc: "Kilómetros, tiempo en marcha, tiempo detenido con motor y velocidades de cada coche, día por día.", needs: ["vehicles", "range"], defaultDays: 6, maxDays: 92,
    async run(p, F) {
      const rows = await fetchDaily(p.from, p.to, p.vehicles);
      return { subtitle: `${whoLabel(F, p)} · ${rangeLabel(p)}`,
        columns: [{ h: "Día" }, { h: "Coche" }, { h: "Distancia (km)", num: true }, { h: "En marcha" }, { h: "Detenido con motor" }, { h: "Velocidad máxima (km/h)", num: true }, { h: "Velocidad media en marcha (km/h)", num: true }, { h: "Primer dato" }, { h: "Último dato" }, { h: "Posiciones", num: true }],
        rows: rows.map((r) => [fmtDayEs(r.day), r.code, Number(r.km), dur(Number(r.moving_min) * 60), dur(Number(r.idle_min) * 60), r.max_speed, r.avg_speed != null ? Number(r.avg_speed) : null, fmtFull(r.first_at).slice(11), fmtFull(r.last_at).slice(11), r.positions]) };
    } },
  { id: "viajes", group: "Viajes", icon: "horarios", title: "Control de viajes", desc: "Cada salida con su coche: cuándo salió, si llegó, si hubo atraso y cuántas paradas frenó.", needs: ["vehicles", "range"], defaultDays: 6, maxDays: 92,
    async run(p, F, ctx) {
      const { trips, stops } = await fetchTripsRange(p.from, p.to), ids = vehFilter(F, p);
      const list = trips.filter((t) => t.vehicle_id && ids.includes(t.vehicle_id));
      return { subtitle: `${whoLabel(F, p)} · ${rangeLabel(p)}`,
        columns: [{ h: "Fecha" }, { h: "Hora" }, { h: "Servicio" }, { h: "Coche" }, { h: "Estado" }, { h: "Salió" }, { h: "Atraso en la salida (min)", num: true }, { h: "Llegó" }, { h: "Paradas con frenada", num: true }, { h: "Paradas sin frenar", num: true }, { h: "Distancia (km)", num: true }, { h: "Velocidad máxima (km/h)", num: true }],
        rows: list.map((t) => { const st = stops.filter((s) => s.trip_id === t.id); const first = st.find((s) => s.idx === 0);
          const dep = t.started_at ? Math.round((Date.parse(t.started_at) - Date.parse(t.planned_at)) / 60000) : null;
          return [fmtDayEs(t.trip_date), t.trip_time, routeName(ctx.data().content, t.route_id).replace(/ · .*/, ""), nameOf(F, t.vehicle_id), TRIP_STATUS[t.status].label, t.started_at ? fmtFull(t.started_at).slice(11) : "", dep, t.ended_at ? fmtFull(t.ended_at).slice(11) : "", st.filter((s) => s.status === "ok").length, st.filter((s) => s.status === "omitida").length, t.distance_m != null ? num(t.distance_m / 1000, 1) : null, t.max_speed ?? null]; }) };
    } },
  { id: "paradas", group: "Viajes", icon: "pin", title: "Paradas y permanencias", desc: "Por cada parada de cada viaje: cuándo llegó, cuánto estuvo, si frenó y cuánto atraso tuvo.", needs: ["vehicles", "range"], defaultDays: 6, maxDays: 31,
    async run(p, F, ctx) {
      const { trips, stops } = await fetchTripsRange(p.from, p.to), ids = vehFilter(F, p), by = new Map(trips.map((t) => [t.id, t]));
      const rows = stops.filter((s) => { const t = by.get(s.trip_id); return t && t.vehicle_id && ids.includes(t.vehicle_id); }).sort((a, b) => { const A = by.get(a.trip_id), B = by.get(b.trip_id); return (A.trip_date + A.trip_time).localeCompare(B.trip_date + B.trip_time) || a.idx - b.idx; });
      return { subtitle: `${whoLabel(F, p)} · ${rangeLabel(p)}`,
        columns: [{ h: "Fecha" }, { h: "Hora de salida" }, { h: "Servicio" }, { h: "Coche" }, { h: "Parada" }, { h: "Esperada" }, { h: "Llegó" }, { h: "Salió" }, { h: "Detenido" }, { h: "Atraso (min)", num: true }, { h: "Resultado" }],
        rows: rows.map((s) => { const t = by.get(s.trip_id); return [fmtDayEs(t.trip_date), t.trip_time, routeName(ctx.data().content, t.route_id).replace(/ · .*/, ""), nameOf(F, t.vehicle_id), s.name, s.planned_at ? fmtFull(s.planned_at).slice(11) : "", s.arrived_at ? fmtFull(s.arrived_at).slice(11) : "", s.departed_at ? fmtFull(s.departed_at).slice(11) : "", s.dwell_s != null ? dur(s.dwell_s) : "", s.delay_min, STOP_STATUS[s.status]?.label || s.status]; }) };
    } },
  { id: "excesos", group: "Control", icon: "velocidad", title: "Excesos de velocidad", desc: "Cada vez que un coche superó el límite: cuándo, cuánto duró y la velocidad máxima.", needs: ["vehicles", "range"], defaultDays: 6, maxDays: 93,
    async run(p, F) {
      const ids = vehFilter(F, p), list = (await fetchAlertsRange(dayStart(p.from), dayEnd(p.to))).filter((a) => a.kind === "exceso_velocidad" && ids.includes(a.vehicle_id));
      return { subtitle: `${whoLabel(F, p)} · ${rangeLabel(p)} · límite general ${F.settings.speedLimit} km/h`,
        columns: [{ h: "Coche" }, { h: "Desde" }, { h: "Hasta" }, { h: "Duración" }, { h: "Velocidad máxima (km/h)", num: true }, { h: "Límite (km/h)", num: true }, { h: "Gravedad" }, { h: "Atendida" }],
        rows: list.map((a) => [nameOf(F, a.vehicle_id), fmtFull(a.started_at, true), a.ended_at ? fmtFull(a.ended_at, true) : "en curso", a.ended_at ? dur((Date.parse(a.ended_at) - Date.parse(a.started_at)) / 1000) : "", a.data?.maxSpeed ?? null, a.data?.limit ?? F.settings.speedLimit, SEVERITY[a.severity]?.label || a.severity, a.ack_at ? "Sí" : "No"]) };
    } },
  { id: "alertas", group: "Control", icon: "alert", title: "Alertas", desc: "Todas las alertas del período: velocidad, sentido, paradas, atrasos, falta de señal, zonas prohibidas, batería.", needs: ["vehicles", "range"], defaultDays: 6, maxDays: 93,
    async run(p, F) {
      const ids = vehFilter(F, p), list = (await fetchAlertsRange(dayStart(p.from), dayEnd(p.to))).filter((a) => ids.includes(a.vehicle_id));
      return { subtitle: `${whoLabel(F, p)} · ${rangeLabel(p)}`,
        columns: [{ h: "Cuándo" }, { h: "Coche" }, { h: "Tipo" }, { h: "Alerta" }, { h: "Detalle" }, { h: "Gravedad" }, { h: "Duración" }, { h: "Atendida" }],
        rows: list.map((a) => [fmtFull(a.started_at, true), nameOf(F, a.vehicle_id), ALERTS[a.kind]?.label || a.kind, a.title, a.detail, SEVERITY[a.severity]?.label || a.severity, a.ended_at ? dur((Date.parse(a.ended_at) - Date.parse(a.started_at)) / 1000) : "en curso", a.ack_at ? "Sí" : "No"]) };
    } },
  { id: "geocercas", group: "Control", icon: "geocerca", title: "Entradas y salidas de geocercas", desc: "Cuándo cada coche entró o salió de una parada, terminal o zona.", needs: ["vehicles", "range"], defaultDays: 1, maxDays: 31,
    async run(p, F) {
      const ids = vehFilter(F, p), ev = (await fetchEventsRange(dayStart(p.from), dayEnd(p.to))).filter((e) => ids.includes(e.vehicle_id));
      return { subtitle: `${whoLabel(F, p)} · ${rangeLabel(p)}`,
        columns: [{ h: "Fecha y hora" }, { h: "Coche" }, { h: "Geocerca" }, { h: "Evento" }, { h: "Velocidad (km/h)", num: true }],
        rows: ev.map((e) => [fmtFull(e.at, true), nameOf(F, e.vehicle_id), F.fenceById.get(e.geofence_id)?.name || "—", e.kind === "entra" ? "Entró" : "Salió", e.speed ?? null]) };
    } },
  { id: "documentos", group: "Administración", icon: "reporte", title: "Vencimiento de documentos", desc: "VTV, seguro, habilitaciones y demás: lo vencido y lo que vence pronto.", needs: ["vehicles", "docs"],
    async run(p, F) {
      const t = jujuyDay(), ids = vehFilter(F, p), maxDays = p.docs === "vencidos" ? -1 : p.docs === "30" ? 30 : p.docs === "90" ? 90 : 36500;
      const list = F.docs.filter((d) => ids.includes(d.vehicle_id) && daysTo(d.expires_on, t) <= maxDays);
      return { subtitle: `${whoLabel(F, p)} · al ${fmtDayEs(t)}`,
        columns: [{ h: "Coche" }, { h: "Documento" }, { h: "Número" }, { h: "Vence" }, { h: "Días", num: true }, { h: "Estado" }],
        rows: list.map((d) => { const n = daysTo(d.expires_on, t); return [nameOf(F, d.vehicle_id), d.kind, d.number, fmtDayEs(d.expires_on), n, n < 0 ? "Vencido" : n <= 30 ? "Vence pronto" : "Vigente"]; }) };
    } },
  { id: "gastos", group: "Administración", icon: "coin", title: "Gastos por coche", desc: "Lo que se gastó en cada coche, por categoría (combustible, peajes, mantenimiento…). Sale de Gastos.", needs: ["vehicles", "range"], defaultDays: 29, maxDays: 366,
    async run(p, F, ctx) {
      const ids = vehFilter(F, p), exp = ctx.data().exp.filter((e) => e.vehicle_id && ids.includes(e.vehicle_id) && String(e.spent_at).slice(0, 10) >= p.from && String(e.spent_at).slice(0, 10) <= p.to);
      const g = new Map();
      for (const e of exp) { const k = `${e.vehicle_id}|${e.category}`; const x = g.get(k) || { v: e.vehicle_id, c: e.category, n: 0, t: 0 }; x.n++; x.t += Number(e.amount); g.set(k, x); }
      const rows = [...g.values()].sort((a, b) => nameOf(F, a.v).localeCompare(nameOf(F, b.v), "es", { numeric: true }) || b.t - a.t);
      return { subtitle: `${whoLabel(F, p)} · ${rangeLabel(p)} · en pesos`,
        columns: [{ h: "Coche" }, { h: "Categoría" }, { h: "Gastos", num: true }, { h: "Total ($)", num: true }],
        rows: rows.map((x) => [nameOf(F, x.v), CATEGORIES[x.c] || x.c, x.n, Math.round(x.t * 100) / 100]) };
    } },
];

const RS = { id: "posiciones", vehicles: [], vehicle: "", from: "", to: "", timeFrom: "00:00", timeTo: "23:59", docs: "30" };

export function reportes(ctx, pre = {}) {
  if (pre.report) RS.id = pre.report;
  const page = h("div", { class: "page" }, h("p", { class: "boot" }, "Cargando…"));
  fleet.ensure().then((F) => mount(page, ctx, F)).catch((e) => showError(page, e, () => ctx.redraw()));
  return page;
}

function mount(page, ctx, F) {
  const rep = () => REPORTS.find((r) => r.id === RS.id) || REPORTS[0];
  const today = jujuyDay();
  if (!RS.vehicle) RS.vehicle = F.vehicles[0]?.id || "";
  const menu = h("nav", { class: "rp-menu", "aria-label": "Reportes" });
  const form = h("div", { class: "rp-form" }), out = h("div", { class: "rp-out" });
  let result = null, seq = 0;

  function drawMenu() {
    const groups = [...new Set(REPORTS.map((r) => r.group))];
    put(menu, groups.map((g) => h("div", { class: "rp-group" }, h("p", { class: "side__group" }, g), REPORTS.filter((r) => r.group === g).map((r) => h("button", { type: "button", class: "rp-item" + (r.id === rep().id ? " is-on" : ""), "aria-current": String(r.id === rep().id), onclick: () => { RS.id = r.id; result = null; resetDates(); drawMenu(); drawForm(); put(out, h("p", { class: "empty" }, "Elegí los filtros y tocá «Generar».")); } }, icon(r.icon, 18), h("span", {}, h("b", {}, r.title)))))));
  }
  function resetDates() { const r = rep(); RS.to = today; RS.from = addDays(today, -(r.defaultDays ?? 6)); }
  if (!RS.from) resetDates();

  function drawForm() {
    const r = rep(), f = {};
    const fields = [];
    if (r.needs.includes("vehicle")) { f.vehicle = input({ label: "Coche", options: F.vehicles.map((v) => [v.id, v.code + (v.plate ? ` · ${v.plate}` : "")]), value: RS.vehicle }); f.vehicle.input.addEventListener("change", () => { RS.vehicle = f.vehicle.get(); }); fields.push(f.vehicle.el); }
    if (r.needs.includes("vehicles")) {
      const boxes = F.vehicles.map((v) => { const c = h("input", { type: "checkbox", value: v.id, checked: RS.vehicles.includes(v.id) ? true : null, onchange: () => { RS.vehicles = [...box.querySelectorAll("input:checked")].map((x) => x.value); sum.textContent = label(); } }); return h("label", { class: "check check--sm" }, c, h("span", {}, v.code)); });
      const label = () => (RS.vehicles.length ? `${RS.vehicles.length} ${RS.vehicles.length === 1 ? "coche" : "coches"}` : "Todos los coches");
      const sum = h("span", {}, label());
      const box = h("div", { class: "rp-vlist" }, h("div", { class: "rp-vlist__acts" }, h("button", { type: "button", class: "link", onclick: () => { box.querySelectorAll("input").forEach((x) => { x.checked = false; }); RS.vehicles = []; sum.textContent = label(); } }, "Todos"), h("button", { type: "button", class: "link", onclick: () => { box.querySelectorAll("input").forEach((x) => { x.checked = true; }); RS.vehicles = F.vehicles.map((v) => v.id); sum.textContent = label(); } }, "Marcar todos")), h("div", { class: "rp-vlist__grid" }, boxes));
      fields.push(h("details", { class: "rp-vehicles field" }, h("summary", {}, h("span", { class: "rp-vehicles__l" }, "Coches"), sum), box));
    }
    if (r.needs.includes("range")) {
      f.from = input({ label: "Desde", type: "date", value: RS.from, maxv: today }); f.to = input({ label: "Hasta", type: "date", value: RS.to, maxv: today });
      f.from.input.addEventListener("change", () => { RS.from = f.from.get(); }); f.to.input.addEventListener("change", () => { RS.to = f.to.get(); });
      fields.push(h("div", { class: "grid2" }, f.from.el, f.to.el));
    }
    if (r.needs.includes("time")) {
      f.tf = input({ label: "Desde la hora", type: "time", value: RS.timeFrom }); f.tt = input({ label: "Hasta la hora", type: "time", value: RS.timeTo });
      f.tf.input.addEventListener("change", () => { RS.timeFrom = f.tf.get() || "00:00"; }); f.tt.input.addEventListener("change", () => { RS.timeTo = f.tt.get() || "23:59"; });
      fields.push(h("div", { class: "grid2" }, f.tf.el, f.tt.el));
    }
    if (r.needs.includes("docs")) { f.docs = input({ label: "Mostrar", options: [["vencidos", "Solo vencidos"], ["30", "Vencidos y los que vencen en 30 días"], ["90", "Vencidos y los que vencen en 90 días"], ["todos", "Todos los documentos"]], value: RS.docs }); f.docs.input.addEventListener("change", () => { RS.docs = f.docs.get(); }); fields.push(f.docs.el); }
    const go = h("button", { type: "button", class: "btn", id: "rp-go", onclick: generate }, icon("reporte", 18), "Generar");
    put(form, h("h2", {}, r.title), h("p", { class: "hint" }, r.desc), h("div", { class: "rp-fields" }, fields), go);
  }

  async function generate() {
    const r = rep(), my = ++seq;
    if (r.needs.includes("vehicle") && !RS.vehicle) return toast("Primero cargá un coche en Vehículos.", "err", 5000);
    if (r.needs.includes("range")) {
      if (!RS.from || !RS.to) return toast("Elegí las fechas.", "err", 4000);
      if (RS.from > RS.to) return toast("La fecha «Desde» no puede ser posterior a «Hasta».", "err", 5000);
      const span = Math.round((Date.parse(RS.to) - Date.parse(RS.from)) / 864e5) + 1;
      if (r.maxDays && span > r.maxDays) return toast(`Para este reporte elegí un período de hasta ${r.maxDays} días.`, "err", 6000);
    }
    const go = document.getElementById("rp-go"); go.disabled = true; put(out, h("p", { class: "boot" }, "Generando el reporte…"));
    try { const res = await r.run({ ...RS, vehicle: RS.vehicle, vehicles: RS.vehicles }, F, ctx); if (my !== seq) return; result = { ...res, id: r.id, title: r.title }; drawResult(); }
    catch (e) { if (my === seq) put(out, h("p", { class: "err", role: "alert" }, plainErr(e))); }
    finally { go.disabled = false; }
  }

  const fileBase = () => `${safeName(result.title)}-${RS.from && ["posiciones", "ultimas", "estado", "documentos"].indexOf(result.id) < 0 ? RS.from + "_" + RS.to : jujuyDay()}`;
  function drawResult() {
    const { columns, rows, subtitle, title } = result, CAP = 300;
    const exp = (kind) => () => {
      try {
        if (kind === "xlsx") downloadBytes(`${fileBase()}.xlsx`, toXlsx({ title, sheet: title, columns, rows }), MIME.xlsx);
        else if (kind === "pdf") downloadBytes(`${fileBase()}.pdf`, toPdf({ title, subtitle, columns, rows }), MIME.pdf);
        else downloadBytes(`${fileBase()}.csv`, enc(toCsvText({ columns, rows })), MIME.csv);
        toast("Descargado.", "ok", 2200);
      } catch (e) { console.error(e); toast("No se pudo armar el archivo.", "err", 6000); }
    };
    put(out,
      h("div", { class: "rp-result__head" }, h("div", {}, h("h3", {}, title), h("p", { class: "hint" }, `${subtitle} · ${rows.length.toLocaleString("es-AR")} ${rows.length === 1 ? "fila" : "filas"}`)),
        h("div", { class: "chips" }, h("button", { type: "button", class: "btn btn--ghost", disabled: !rows.length, onclick: exp("xlsx") }, icon("descargar", 18), "Excel"), h("button", { type: "button", class: "btn btn--ghost", disabled: !rows.length, onclick: exp("pdf") }, icon("descargar", 18), "PDF"), h("button", { type: "button", class: "btn btn--ghost", disabled: !rows.length, onclick: exp("csv") }, icon("descargar", 18), "CSV"))),
      table({ label: title, rows: rows.slice(0, CAP), empty: "No hay datos para estos filtros.", cols: columns.map((c, i) => ({ h: c.h, num: c.num, c: (r) => { const v = r[i]; if (v == null || v === "") return ""; if (typeof v === "number") return v.toLocaleString("es-AR", { maximumFractionDigits: 5 }); if (/^https?:\/\//.test(v)) return h("a", { href: v, target: "_blank", rel: "noopener", class: "link" }, "Abrir"); return v; } })) }),
      rows.length > CAP ? h("p", { class: "hint" }, `Se muestran las primeras ${CAP} filas. La descarga trae las ${rows.length.toLocaleString("es-AR")}.`) : null);
  }
  const enc = (t) => new TextEncoder().encode(t);

  put(page, pageHead("Reportes de la flota", "Elegí un reporte, ajustá los filtros y bajalo a Excel o PDF."), h("div", { class: "rp-layout" }, menu, h("section", { class: "panel rp-main" }, form, out)));
  drawMenu(); drawForm(); put(out, h("p", { class: "empty" }, "Elegí los filtros y tocá «Generar»."));
}
