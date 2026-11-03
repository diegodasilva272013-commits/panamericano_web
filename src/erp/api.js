import { sb, fetchRemote, withDefaults, getSession, signIn, signOut, isAdmin, configured } from "../admin/api.js";
import { todayJ, addDays } from "./model.js";

export { sb, getSession, signIn, signOut, isAdmin, configured };

// La base entrega hasta 1000 filas por pedido: se pide por páginas hasta traer todo.
async function all(make) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw fail(error);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    if (from > 200000) break; // tope de seguridad
  }
  return out;
}
function fail(error) {
  const txt = `${error.code || ""} ${error.message || ""}`;
  if (/relation|does not exist|PGRST205|42P01/i.test(txt)) { const e = new Error("Faltan activar los cobros y gastos en la base: ejecutá el archivo supabase/erp.sql en Supabase (una sola vez)."); e.setup = true; return e; }
  console.warn("[erp]", txt);
  if (/row-level security|permission denied|42501/i.test(txt)) return new Error("Tu cuenta no tiene permiso para esto.");
  if (/fetch|network|abort|load failed/i.test(txt)) return new Error("No hay conexión con la base de datos. Revisá tu internet y probá de nuevo.");
  return new Error("No se pudo completar. Probá de nuevo; si sigue igual, avisá a quien administra el sistema.");
}

// Se trae lo de los últimos 2 años y todo lo que viene: alcanza de sobra y mantiene el panel rápido.
export const sinceDate = (today = todayJ()) => addDays(today, -730);

export async function loadAll() {
  const since = sinceDate();
  await sb.rpc("release_expired_holds"); // libera lo que no se pagó a tiempo (si todavía no existe en la base, se ignora)
  const [res, pay, exp, remote, closed, review] = await Promise.all([
    all(() => sb.from("reservations").select("*").gte("trip_date", since).order("trip_date").order("id")),
    all(() => sb.from("payments").select("*").gte("paid_at", since).order("paid_at").order("id")),
    all(() => sb.from("expenses").select("*").gte("spent_at", since).order("spent_at").order("id")),
    fetchRemote().catch(() => null),
    all(() => sb.from("closed_trips").select("*").gte("trip_date", since).order("trip_date").order("id")).catch(() => []),
    // pagos online que hay que mirar a mano (monto distinto, etc.); si todavía no se activaron los pagos online, no hay nada
    all(() => sb.from("payment_orders").select("*").eq("state", "revision").order("updated_at")).catch(() => []),
  ]);
  return { res: res.map((r) => ({ ...r, trip_date: String(r.trip_date).slice(0, 10) })), pay: pay.map(fixPay), exp: exp.map(fixExp), closed, review, content: withDefaults(remote?.data), since };
}
const fixPay = (p) => ({ ...p, amount: +p.amount, paid_at: String(p.paid_at).slice(0, 10) });
const fixExp = (e) => ({ ...e, amount: +e.amount, spent_at: String(e.spent_at).slice(0, 10) });

export async function addPayment({ code, kind, amount, method, paid_at, ref, note }) {
  const { data, error } = await sb.from("payments").insert({ code, kind, amount, method, paid_at, ref: ref || "", note: note || "" }).select("*").limit(1);
  if (error) throw fail(error);
  return fixPay(data[0]);
}
export async function deletePayment(id) {
  const { error } = await sb.from("payments").delete().eq("id", id);
  if (error) throw fail(error);
}
export async function saveExpense(e) {
  const row = { spent_at: e.spent_at, category: e.category, amount: e.amount, description: e.description || "", supplier: e.supplier || "", method: e.method, bus_id: e.bus_id || null, route_id: e.route_id || null };
  const q = e.id ? sb.from("expenses").update(row).eq("id", e.id) : sb.from("expenses").insert(row);
  const { data, error } = await q.select("*").limit(1);
  if (error) throw fail(error);
  if (!data?.length) throw new Error("No se pudo guardar el gasto.");
  return fixExp(data[0]);
}
export async function deleteExpense(id) {
  const { error } = await sb.from("expenses").delete().eq("id", id);
  if (error) throw fail(error);
}
// Cambia el estado de todos los asientos de la reserva. Reabrir una cancelada puede chocar con otra venta del mismo asiento.
export async function setStatus(code, status) {
  const { error } = await sb.from("reservations").update({ status }).eq("code", code);
  if (error?.code === "23P01") throw new Error("No se puede reabrir: alguno de esos asientos ya lo tomó otra reserva.");
  if (error) throw fail(error);
}
export async function setNote(code, note) {
  const { error } = await sb.from("reservations").update({ note: String(note).slice(0, 300) }).eq("code", code);
  if (error) throw fail(error);
}
