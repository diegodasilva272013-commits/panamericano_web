// Acceso a los datos de la flota desde el ERP (solo lectura y administración; el receptor GPS es quien escribe posiciones).
import { sb } from "../api.js";
import { jujuyDay, settingsOf } from "./status.js";

const oops = (e, what) => {
  const txt = `${e?.code || ""} ${e?.message || ""}`;
  if (/relation|does not exist|PGRST205|42P01|schema cache/i.test(txt)) { const x = new Error("Falta activar la flota en la base: ejecutá supabase/flota.sql en Supabase (una sola vez)."); x.setup = true; return x; }
  if (/row-level security|permission denied|42501/i.test(txt)) return new Error("Tu cuenta no tiene permiso para esto.");
  if (/fetch|network|abort|load failed/i.test(txt)) return new Error("No hay conexión con la base de datos. Revisá tu internet y probá de nuevo.");
  console.warn("[flota]", what, txt);
  return new Error(`No se pudo ${what}. Probá de nuevo; si sigue igual, avisá a quien administra el sistema.`);
};
const ok = ({ data, error }, what) => { if (error) throw oops(error, what); return data || []; };

export const fetchStates = async () => ok(await sb.from("vehicle_state").select("*"), "leer la posición de los coches");
export const fetchOpenAlerts = async (days = 7) =>
  ok(await sb.from("fleet_alerts").select("*").gte("started_at", new Date(Date.now() - days * 864e5).toISOString()).order("started_at", { ascending: false }).limit(500), "leer las alertas");

/** Viajes de un día (con sus paradas). */
export async function fetchTripsOn(day) {
  const trips = ok(await sb.from("fleet_trips").select("*").eq("trip_date", day).order("trip_time"), "leer los viajes");
  const ids = trips.map((t) => t.id);
  const stops = ids.length ? ok(await sb.from("fleet_trip_stops").select("*").in("trip_id", ids).order("idx"), "leer las paradas de los viajes") : [];
  return { trips, stops };
}

/** Viajes entre dos días (yyyy-mm-dd) con todas sus paradas. */
export async function fetchTripsRange(fromDay, toDay) {
  const trips = ok(await sb.from("fleet_trips").select("*").gte("trip_date", fromDay).lte("trip_date", toDay).order("trip_date").order("trip_time").limit(5000), "leer los viajes");
  const stops = [];
  for (let i = 0; i < trips.length; i += 200) {
    const ids = trips.slice(i, i + 200).map((t) => t.id);
    stops.push(...ok(await sb.from("fleet_trip_stops").select("*").in("trip_id", ids).order("idx"), "leer las paradas de los viajes"));
  }
  return { trips, stops };
}

/** Entradas y salidas de geocercas de todos los coches entre dos instantes. */
export async function fetchEventsRange(fromIso, toIso, max = 20000) {
  const out = [];
  for (let from = 0; out.length < max; from += 1000) {
    const rows = ok(await sb.from("geofence_events").select("*").gte("at", fromIso).lte("at", toIso).order("at", { ascending: true }).range(from, from + 999), "leer las entradas y salidas de geocercas");
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}

export const fetchAlertsRange = async (fromIso, toIso) =>
  ok(await sb.from("fleet_alerts").select("*").gte("started_at", fromIso).lte("started_at", toIso).order("started_at", { ascending: false }).limit(2000), "leer las alertas");

/** Todo lo que necesitan las pantallas de la flota, de una vez. */
export async function loadFleet() {
  const today = jujuyDay(), from = jujuyDay(Date.now() - 864e5), to = jujuyDay(Date.now() + 864e5);
  const [vehicles, states, alerts, geofences, routes, routeStops, trips, settings, unknown, docs] = await Promise.all([
    sb.from("vehicles").select("*").order("code"),
    sb.from("vehicle_state").select("*"),
    sb.from("fleet_alerts").select("*").gte("started_at", new Date(Date.now() - 7 * 864e5).toISOString()).order("started_at", { ascending: false }).limit(500),
    sb.from("geofences").select("*").order("name"),
    sb.from("fleet_routes").select("*"),
    sb.from("fleet_route_stops").select("*").order("idx"),
    sb.from("fleet_trips").select("*").gte("trip_date", from).lte("trip_date", to).order("trip_time"),
    sb.from("fleet_settings").select("*").eq("id", "main"),
    sb.from("gps_unknown_devices").select("*").order("last_seen", { ascending: false }),
    sb.from("vehicle_documents").select("*").order("expires_on"),
  ]);
  const tripRows = ok(trips, "leer los viajes");
  const ids = tripRows.map((t) => t.id);
  const stops = ids.length ? ok(await sb.from("fleet_trip_stops").select("*").in("trip_id", ids), "leer las paradas de los viajes") : [];
  const F = {
    vehicles: ok(vehicles, "leer los vehículos"), states: ok(states, "leer la posición de los coches"), alerts: ok(alerts, "leer las alertas"),
    geofences: ok(geofences, "leer las geocercas"), routes: ok(routes, "leer los recorridos"), routeStops: ok(routeStops, "leer las paradas de los recorridos"),
    trips: tripRows, tripStops: stops, settings: settingsOf(ok(settings, "leer los ajustes")), unknown: ok(unknown, "leer los equipos desconocidos"), docs: ok(docs, "leer los documentos"), today, loadedAt: Date.now(),
  };
  F.stateById = new Map(F.states.map((s) => [s.vehicle_id, s]));
  F.vehicleById = new Map(F.vehicles.map((v) => [v.id, v]));
  F.fenceById = new Map(F.geofences.map((g) => [g.id, g]));
  return F;
}

/** Posiciones de un vehículo entre dos instantes ISO, por páginas de 1000. onPage recibe lo acumulado para ir mostrando. */
export async function fetchPositions(vehicleId, fromIso, toIso, { max = 50000, onPage } = {}) {
  const out = [];
  for (let from = 0; out.length < max; from += 1000) {
    const rows = ok(await sb.from("gps_positions").select("event_time,lat,lng,speed,course,ignition,voltage,odometer_m,sats,csq,rtype,extra")
      .eq("vehicle_id", vehicleId).gte("event_time", fromIso).lte("event_time", toIso).order("event_time", { ascending: true }).range(from, from + 999), "leer el recorrido");
    out.push(...rows);
    onPage?.(out);
    if (rows.length < 1000) break;
  }
  return out;
}

export const fetchGeofenceEvents = async (vehicleId, fromIso, toIso) =>
  ok(await sb.from("geofence_events").select("*").eq("vehicle_id", vehicleId).gte("at", fromIso).lte("at", toIso).order("at", { ascending: true }).limit(2000), "leer las entradas y salidas de geocercas");

export const fetchDaily = async (from, to, vehicleIds) => {
  const { data, error } = await sb.rpc("fleet_daily", { p_from: from, p_to: to, p_vehicles: vehicleIds && vehicleIds.length ? vehicleIds : null });
  if (error) throw oops(error, "calcular las distancias");
  return data || [];
};

export const ackAlert = async (id) => { const { error } = await sb.rpc("fleet_ack_alert", { p_id: id }); if (error) throw oops(error, "marcar la alerta como atendida"); };

// ------------------------------------------------------------ escritura desde el ERP
export const save = {
  async vehicle(v) {
    const row = { code: v.code.trim(), plate: (v.plate || "").trim().toUpperCase(), device_id: (v.device_id || "").trim() || null, bus_id: v.bus_id || null, active: v.active !== false, notes: v.notes || "" };
    const q = v.id ? sb.from("vehicles").update(row).eq("id", v.id).select().single() : sb.from("vehicles").insert(row).select().single();
    const { data, error } = await q;
    if (error) { if (/duplicate|unique/i.test(error.message)) throw new Error(/device/.test(error.message) ? "Ese equipo ya está cargado en otro coche." : "Ya existe un coche con ese nombre."); throw oops(error, "guardar el coche"); }
    return data;
  },
  async removeVehicle(id) { const { error } = await sb.from("vehicles").delete().eq("id", id); if (error) throw oops(error, "borrar el coche"); },
  async fence(g) {
    const row = { name: g.name.trim(), kind: g.kind, shape: g.shape, lat: g.lat ?? null, lng: g.lng ?? null, radius_m: g.radius_m ?? null, polygon: g.polygon ?? null, speed_limit: g.kind === "zona" ? g.speed_limit || null : null, color: g.color, active: g.active !== false };
    const q = g.id ? sb.from("geofences").update(row).eq("id", g.id).select().single() : sb.from("geofences").insert(row).select().single();
    const { data, error } = await q; if (error) throw oops(error, "guardar la geocerca"); return data;
  },
  async removeFence(id) {
    const { error } = await sb.from("geofences").delete().eq("id", id);
    if (error) { if (/foreign|violates/i.test(error.message)) throw new Error("Esa geocerca está usada como parada de un recorrido. Sacala del recorrido primero."); throw oops(error, "borrar la geocerca"); }
  },
  async route(routeId, polyline, corridor, stops) {
    let r = await sb.from("fleet_routes").upsert({ route_id: routeId, polyline, corridor_m: corridor, updated_at: new Date().toISOString() }, { onConflict: "route_id" }); if (r.error) throw oops(r.error, "guardar el recorrido");
    r = await sb.from("fleet_route_stops").delete().eq("route_id", routeId); if (r.error) throw oops(r.error, "guardar las paradas del recorrido");
    if (stops.length) { r = await sb.from("fleet_route_stops").insert(stops.map((s, i) => ({ route_id: routeId, idx: i, geofence_id: s.geofence_id, name: s.name, offset_min: s.offset_min ?? null, mandatory: s.mandatory !== false }))); if (r.error) throw oops(r.error, "guardar las paradas del recorrido"); }
  },
  async removeRoute(routeId) { const { error } = await sb.from("fleet_routes").delete().eq("route_id", routeId); if (error) throw oops(error, "borrar el recorrido"); },
  async trip(t) {
    const row = { route_id: t.route_id, trip_date: t.trip_date, trip_time: t.trip_time, vehicle_id: t.vehicle_id || null, planned_at: new Date(`${t.trip_date}T${t.trip_time}:00-03:00`).toISOString() };
    const { data, error } = await sb.from("fleet_trips").upsert(row, { onConflict: "route_id,trip_date,trip_time" }).select().single(); if (error) throw oops(error, "asignar el coche a la salida"); return data;
  },
  async settings(data) { const { error } = await sb.from("fleet_settings").upsert({ id: "main", data }, { onConflict: "id" }); if (error) throw oops(error, "guardar los ajustes"); },
  async doc(d) {
    const row = { vehicle_id: d.vehicle_id, kind: d.kind.trim(), number: (d.number || "").trim(), expires_on: d.expires_on, notes: d.notes || "" };
    const q = d.id ? sb.from("vehicle_documents").update(row).eq("id", d.id) : sb.from("vehicle_documents").insert(row);
    const { error } = await q; if (error) throw oops(error, "guardar el documento");
  },
  async removeDoc(id) { const { error } = await sb.from("vehicle_documents").delete().eq("id", id); if (error) throw oops(error, "borrar el documento"); },
  async linkUnknown(deviceId, vehicleId) {
    const { error } = await sb.from("vehicles").update({ device_id: deviceId }).eq("id", vehicleId); if (error) throw oops(error, "vincular el equipo");
    await sb.from("gps_unknown_devices").delete().eq("device_id", deviceId);
  },
};

/** Se entera de los cambios de la flota: en vivo (Realtime) y, por las dudas, consultando cada pocos segundos. Devuelve cómo cortarlo. */
export function watchLive({ onStates, onAlerts, everyMs = 6000 }) {
  let ch = null, stopped = false;
  try {
    ch = sb.channel("flota-en-vivo")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_state" }, (p) => p.new && onStates([p.new], true))
      .on("postgres_changes", { event: "*", schema: "public", table: "fleet_alerts" }, (p) => p.new && onAlerts([p.new], true))
      .subscribe();
  } catch { /* sin Realtime se usa solo la consulta periódica */ }
  const tick = async () => {
    if (stopped || document.hidden) return;
    try { onStates(await fetchStates(), false); onAlerts(await fetchOpenAlerts(2), false); } catch { /* ya se avisa en la próxima carga */ }
  };
  const timer = setInterval(tick, everyMs);
  const vis = () => { if (!document.hidden) tick(); };
  document.addEventListener("visibilitychange", vis);
  return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", vis); if (ch) try { sb.removeChannel(ch); } catch { /* nada */ } };
}
