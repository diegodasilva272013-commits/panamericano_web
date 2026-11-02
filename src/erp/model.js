// Cálculos del ERP, sin pantalla: reservas agrupadas, saldos, cobros y finanzas.
// Una "reserva" es el conjunto de asientos con el mismo código; la base guarda una fila por asiento.

export const METHODS = { efectivo: "Efectivo", transferencia: "Transferencia", mercadopago: "Mercado Pago", tarjeta: "Tarjeta", otro: "Otro" };
export const CATEGORIES = { combustible: "Combustible", peajes: "Peajes", sueldos: "Sueldos", mantenimiento: "Mantenimiento", seguros: "Seguros", impuestos: "Impuestos y tasas", comisiones: "Comisiones", otros: "Otros" };
export const STATUS = { pendiente: "Por confirmar", confirmada: "Confirmada", cancelada: "Cancelada" };
export const PAY = { sin_cobrar: "Sin cobrar", parcial: "Cobro parcial", pagada: "Pagada", de_mas: "Cobrado de más", a_devolver: "A devolver", sin_tarifa: "Sin tarifa", sin_movimiento: "Sin cobros" };

const TZ = "America/Argentina/Jujuy";
const MONEY = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const MONEY2 = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 });
// pesos sin centavos si es un número redondo; con centavos si no
export const money = (n) => { const v = Math.round((+n || 0) * 100) / 100; return (Number.isInteger(v) ? MONEY : MONEY2).format(v); };
export const r2 = (n) => Math.round((+n || 0) * 100) / 100;

/* ---------- fechas (todas ISO "YYYY-MM-DD", hora de Jujuy) ---------- */
export const todayJ = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
export const iso = (x) => String(x ?? "").slice(0, 10);
export function addDays(s, n) { const d = new Date(iso(s) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const monthStart = (s) => iso(s).slice(0, 8) + "01";
export function addMonths(s, n) { const d = new Date(monthStart(s) + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
export const monthEnd = (s) => addDays(addMonths(s, 1), -1);
const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MON = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const dow = (s) => DOW[new Date(iso(s) + "T12:00:00Z").getUTCDay()];
export const fmtDay = (s) => { if (!s) return ""; const [y, m, d] = iso(s).split("-"); return `${+d}/${+m}/${y.slice(2)}`; };
export const fmtDayLong = (s) => { const [y, m, d] = iso(s).split("-"); return `${dow(s)} ${+d} de ${MON[+m - 1]}`; };
export const fmtMonth = (s) => { const [y, m] = iso(s).split("-"); return `${MON[+m - 1]} de ${y}`; };
export const fmtMonthShort = (s) => { const [y, m] = iso(s).split("-"); return `${MON[+m - 1].slice(0, 3)} ${y.slice(2)}`; };
export const inRange = (s, a, b) => { const x = iso(s); return (!a || x >= a) && (!b || x <= b); };

/* ---------- reservas ---------- */
const signed = (p) => (p.kind === "devolucion" ? -1 : 1) * (+p.amount || 0);
export const netPaid = (pays) => r2(pays.reduce((a, p) => a + signed(p), 0));

// Agrupa las filas (una por asiento) en reservas, con lo cobrado y el saldo de cada una.
export function bookings(resRows, payRows) {
  const pays = new Map();
  for (const p of payRows) { if (!pays.has(p.code)) pays.set(p.code, []); pays.get(p.code).push(p); }
  const by = new Map();
  for (const r of resRows) { if (!by.has(r.code)) by.set(r.code, []); by.get(r.code).push(r); }
  const out = [];
  for (const [code, rows] of by) {
    rows.sort((a, b) => String(a.seat).localeCompare(String(b.seat), "es", { numeric: true }));
    const live = rows.filter((r) => r.status !== "cancelada");
    const f = rows[0];
    const status = !live.length ? "cancelada" : live.some((r) => r.status === "pendiente") ? "pendiente" : "confirmada";
    const total = r2(live.reduce((a, r) => a + (+r.fare || 0), 0));
    const noFare = live.filter((r) => r.fare == null).length;
    const mine = pays.get(code) || [];
    const net = netPaid(mine);
    const balance = r2(total - net); // >0 falta cobrar · <0 hay que devolver
    let pay;
    if (status === "cancelada") pay = net > 0 ? "a_devolver" : "sin_movimiento";
    else if (total === 0 && noFare) pay = net > 0 ? "parcial" : "sin_tarifa";
    else if (net <= 0) pay = total === 0 ? "pagada" : "sin_cobrar";
    else if (balance > 0) pay = "parcial";
    else if (balance < 0) pay = "de_mas";
    else pay = "pagada";
    out.push({
      code, rows, live, status, total, noFare, net, balance, pay, pays: mine.sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)) || String(b.created_at).localeCompare(String(a.created_at))),
      date: iso(f.trip_date), time: f.trip_time, route: f.route_id, from: f.from_name, to: f.to_name,
      seats: live.length ? live.map((r) => r.seat) : rows.map((r) => r.seat),
      names: [...new Set((live.length ? live : rows).map((r) => r.passenger_name))],
      phone: f.phone || "", email: f.email || "", note: rows.map((r) => r.note).find(Boolean) || "", source: f.source, created: f.created_at,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.time.localeCompare(b.time) || a.code.localeCompare(b.code));
}

// Cobros que apuntan a una reserva que ya no existe (se borró a mano): hay que verlos, no perderlos.
export const orphanPayments = (resRows, payRows) => { const s = new Set(resRows.map((r) => r.code)); return payRows.filter((p) => !s.has(p.code)); };

/* ---------- salidas ---------- */
export function tripsOf(resRows) {
  const m = new Map();
  for (const r of resRows) { const k = `${r.route_id}|${iso(r.trip_date)}|${r.trip_time}`; if (!m.has(k)) m.set(k, { key: k, route: r.route_id, date: iso(r.trip_date), time: r.trip_time, rows: [] }); m.get(k).rows.push(r); }
  return [...m.values()];
}

/* ---------- pasajeros ---------- */
const digits = (s) => String(s || "").replace(/\D/g, "");
// Una persona se reconoce por documento; si no hay, por teléfono + nombre.
export function passengers(resRows, bks) {
  const bkOf = new Map(bks.map((b) => [b.code, b]));
  const m = new Map();
  for (const r of resRows) {
    if (r.status === "cancelada") continue;
    const doc = digits(r.passenger_doc), ph = digits(r.phone);
    const key = doc ? "d" + doc : ph ? "t" + ph + "|" + String(r.passenger_name).trim().toLowerCase() : "n" + String(r.passenger_name).trim().toLowerCase();
    if (!m.has(key)) m.set(key, { key, name: r.passenger_name, doc: r.passenger_doc, phone: r.phone, email: r.email, seats: 0, codes: new Set(), trips: new Set(), last: "", next: "" });
    const p = m.get(key);
    p.seats++; p.codes.add(r.code); p.trips.add(`${r.route_id}|${iso(r.trip_date)}|${r.trip_time}`);
    if (!p.phone && r.phone) p.phone = r.phone; if (!p.email && r.email) p.email = r.email; if (!p.doc && r.passenger_doc) p.doc = r.passenger_doc;
    const d = iso(r.trip_date); if (d > p.last) p.last = d;
  }
  const today = todayJ();
  return [...m.values()].map((p) => {
    const mine = [...p.codes].map((c) => bkOf.get(c)).filter(Boolean);
    const spent = r2(mine.reduce((a, b) => a + (b.live.length ? Math.min(b.net, b.total) * (b.live.filter((r) => keyOfRow(r) === p.key).length / b.live.length) : 0), 0));
    const owes = r2(mine.reduce((a, b) => a + Math.max(0, b.balance) * (b.live.filter((r) => keyOfRow(r) === p.key).length / (b.live.length || 1)), 0));
    const upcoming = mine.filter((b) => b.date >= today).map((b) => b.date).sort()[0] || "";
    return { ...p, trips: p.trips.size, codes: [...p.codes], spent, owes, next: upcoming };
  }).sort((a, b) => b.last.localeCompare(a.last));
}
const keyOfRow = (r) => { const doc = digits(r.passenger_doc), ph = digits(r.phone); return doc ? "d" + doc : ph ? "t" + ph + "|" + String(r.passenger_name).trim().toLowerCase() : "n" + String(r.passenger_name).trim().toLowerCase(); };

/* ---------- finanzas ---------- */
// Dinero cobrado (neto de devoluciones) entre dos fechas, por método
export function cashIn(payRows, a, b) {
  const by = {}; let total = 0;
  for (const p of payRows) if (inRange(p.paid_at, a, b)) { const v = signed(p); by[p.method] = r2((by[p.method] || 0) + v); total += v; }
  return { total: r2(total), by };
}
export function spend(expRows, a, b) {
  const by = {}; let total = 0;
  for (const e of expRows) if (inRange(e.spent_at, a, b)) { by[e.category] = r2((by[e.category] || 0) + +e.amount); total += +e.amount; }
  return { total: r2(total), by };
}
// Valor de los viajes del período (por fecha de viaje, sin cancelados)
export function sold(resRows, a, b) {
  let total = 0, seats = 0; const codes = new Set();
  for (const r of resRows) if (r.status !== "cancelada" && inRange(r.trip_date, a, b)) { total += +r.fare || 0; seats++; codes.add(r.code); }
  return { total: r2(total), seats, bookings: codes.size };
}
export const pending = (bks, { onlyPast, today } = {}) => bks.filter((b) => b.status !== "cancelada" && b.balance > 0 && (!onlyPast || b.date < today));

// Últimos n meses (el actual incluido): cobrado, gastos y resultado
export function monthly(payRows, expRows, n, today) {
  const out = []; const cur = monthStart(today);
  for (let i = n - 1; i >= 0; i--) { const a = addMonths(cur, -i), b = monthEnd(a); const c = cashIn(payRows, a, b).total, g = spend(expRows, a, b).total; out.push({ month: a, in: c, out: g, net: r2(c - g) }); }
  return out;
}

/* ---------- CSV (para Excel en español: separador ";" y coma decimal) ---------- */
export function toCsv(cols, rows) {
  // un texto que empieza con = o @ (o +/- sin número) lo tomaría Excel como fórmula: se le antepone una comilla
  const risky = /^(=|@|[+-](?![0-9]))/;
  const cell = (v) => { if (v == null) return ""; if (typeof v === "number") return String(v).replace(".", ","); const s = String(v); return /[;"\n\r]/.test(s) || risky.test(s) ? '"' + (risky.test(s) ? "'" : "") + s.replace(/"/g, '""') + '"' : s; };
  return "﻿" + [cols.map((c) => cell(c[0])).join(";"), ...rows.map((r) => cols.map((c) => cell(c[1](r))).join(";"))].join("\r\n");
}
