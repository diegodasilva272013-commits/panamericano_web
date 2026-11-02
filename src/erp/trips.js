import { runsOn, seatsOf } from "../scripts/data.js";
import { iso, r2 } from "./model.js";

export const routeName = (content, id) => { const r = content.routes.find((x) => x.id === id); return r ? `${r.from || "Origen"} → ${r.to || "Destino"}${r.service ? " · " + r.service : ""}` : id; };
export const busOf = (content, route) => content.buses.find((b) => b.id === route?.busId) || content.buses[0];

// Las salidas de un día: las que marca el horario de la web para ese día + cualquier otra que ya tenga reservas.
// Cada una trae asientos usados, capacidad, lo vendido, lo cobrado y si está cerrada.
export function tripsOn(data, bks, date) {
  const { content, res, closed } = data;
  const map = new Map();
  for (const r of content.routes) for (const t of r.times || []) if (runsOn(r.days?.[t], date)) map.set(`${r.id}|${t}`, { key: `${r.id}|${t}`, route: r, routeId: r.id, time: t, rows: [] });
  for (const x of res) {
    if (iso(x.trip_date) !== date) continue;
    const k = `${x.route_id}|${x.trip_time}`;
    if (!map.has(k)) map.set(k, { key: k, route: content.routes.find((r) => r.id === x.route_id) || { id: x.route_id, from: x.from_name, to: x.to_name }, routeId: x.route_id, time: x.trip_time, rows: [], extra: true });
    map.get(k).rows.push(x);
  }
  const bkOf = new Map(bks.map((b) => [b.code, b]));
  return [...map.values()].map((t) => {
    const live = t.rows.filter((x) => x.status !== "cancelada");
    const bus = busOf(content, t.route), cap = seatsOf(bus).length;
    const codes = [...new Set(live.map((x) => x.code))];
    const seats = new Set(live.map((x) => x.seat)).size;
    const soldV = r2(live.reduce((a, x) => a + (+x.fare || 0), 0));
    const cobrado = r2(codes.reduce((a, c) => a + (bkOf.get(c)?.net || 0), 0));
    const cl = closed.find((c) => c.route_id === t.routeId && iso(c.trip_date) === date && (!c.trip_time || c.trip_time === t.time));
    return { ...t, live, cap, seats, pax: live.length, bookings: codes.length, sold: soldV, cobrado, closed: cl || null, bus };
  }).sort((a, b) => a.time.localeCompare(b.time) || a.routeId.localeCompare(b.routeId));
}
