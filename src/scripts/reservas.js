// Conexión de las reservas con la base (Supabase). Las dos funciones validan todo en el servidor:
// lo que mande el navegador nunca se toma como cierto.
import { SUPABASE } from "./config.js";

export const reservasListas = () => !!(SUPABASE.url && SUPABASE.anonKey);

async function rpc(fn, body) {
  if (!reservasListas()) throw Object.assign(new Error("Las reservas por la web todavía no están activadas."), { kind: "NO_DISPONIBLE" });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(`${SUPABASE.url}/rest/v1/rpc/${fn}`, {
      method: "POST", signal: ctl.signal,
      headers: { apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error("No pudimos conectarnos. Revisá tu conexión y probá de nuevo."), { kind: "RED" });
  } finally { clearTimeout(timer); }
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    // los errores propios llegan como "CODIGO:mensaje para la persona"
    const m = /^([A-Z_]+):(.*)$/s.exec(json?.message || "");
    if (m) throw Object.assign(new Error(m[2].trim() || "No se pudo completar."), { kind: m[1], detail: m[2].trim() });
    // la función todavía no existe en la base (falta correr supabase/booking.sql) u otro problema del servicio
    throw Object.assign(new Error("Las reservas por la web no están disponibles en este momento."), { kind: res.status === 404 ? "NO_DISPONIBLE" : "RED" });
  }
  return json;
}

// asientos ocupados de una salida (sin datos personales) y si está cerrada
export const tripInfo = (route, date, time) => rpc("trip_info", { p_route: route, p_date: date, p_time: time });

// reserva uno o más asientos; devuelve { code, seats, fare, total }
export const bookSeats = ({ route, date, time, from, to, seats, people, phone, email }) =>
  rpc("book_seats", { p_route: route, p_date: date, p_time: time, p_from: from, p_to: to, p_seats: seats, p_people: people, p_phone: phone, p_email: email || "" });
