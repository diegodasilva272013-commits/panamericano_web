import { h, icon, chip, kpi, table, input, drawer, download, barChart, put, STATUS_TONE, PAY_TONE } from "./kit.js";
import { money, todayJ, addDays, monthStart, monthEnd, fmtDay, fmtDayLong, cashIn, spend, sold, pending, monthly, passengers, toCsv, STATUS, PAY, iso } from "./model.js";
import { tripsOn, routeName } from "./trips.js";
import { openBooking } from "./detail.js";
import { fleet, openAlerts } from "./flota/store.js";
import { rowsOf } from "./flota/view-live.js";

export const pageHead = (title, desc, ...acts) => h("header", { class: "page__head" }, h("div", {}, h("h1", { class: "title" }, title), desc && h("p", { class: "page__desc" }, desc)), acts.length ? h("div", { class: "page__acts no-print" }, ...acts) : null);
const norm = (x) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const bar = (a, b) => h("span", { class: "occ", role: "img", "aria-label": `${a} de ${b} asientos` }, h("span", { class: "occ__fill" + (pct(a, b) >= 90 ? " is-full" : ""), style: `width:${Math.min(100, pct(a, b))}%` }), h("span", { class: "occ__t" }, `${a}/${b}`));

/* Resumen de la flota en el Inicio: aparece solo si la flota está activada y hay coches cargados (si no, no molesta). */
function flotaPanel(ctx) {
  const box = h("section", { class: "panel panel--flota", hidden: true });
  fleet.ensure().then((F) => {
    if (!box.isConnected || !F.vehicles.length) return;
    const rows = rowsOf(F), n = (k) => rows.filter((r) => r.status === k).length, al = openAlerts(F), crit = al.filter((a) => a.severity === "critica").length;
    const enCurso = F.trips.filter((t) => t.status === "en_curso").length;
    const k = (l, v, tone = "") => h("span", { class: "fk" + (tone ? " fk--" + tone : "") }, h("b", {}, String(v)), l);
    put(box, h("div", { class: "panel__top" }, h("h2", {}, "Flota ahora"), h("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: () => ctx.go("mapa", {}) }, icon("mapa", 16), "Abrir el mapa")),
      h("div", { class: "fks" }, k("en marcha", n("moving"), "ok"), k("detenidos", n("idle") + n("parked")), k("sin señal", n("offline"), n("offline") ? "bad" : ""), k("viajes en curso", enCurso),
        h("button", { type: "button", class: "fk fk--btn" + (al.length ? " fk--bad" : ""), onclick: () => ctx.go("alertas", {}) }, h("b", {}, String(al.length)), crit ? `alertas sin atender (${crit} críticas)` : al.length === 1 ? "alerta sin atender" : "alertas sin atender")));
    box.hidden = false;
  }).catch(() => { /* flota sin activar: el Inicio queda como siempre */ });
  return box;
}

/* =========================================================== INICIO */
export function inicio(ctx) {
  const today = todayJ(), tomorrow = addDays(today, 1), ms = monthStart(today), me = monthEnd(today);
  const d = ctx.data(), bks = ctx.bks();
  const porConfirmar = bks.filter((b) => b.status === "pendiente" && b.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const saldo = pending(bks), saldoViejo = pending(bks, { onlyPast: true, today });
  const aDevolver = bks.filter((b) => b.pay === "a_devolver");
  const sinTarifa = bks.filter((b) => b.status !== "cancelada" && b.pay === "sin_tarifa" && b.date >= today);
  const cobrado = cashIn(d.pay, ms, me).total, gastos = spend(d.exp, ms, me).total, vendido = sold(d.res, ms, me);
  const trHoy = tripsOn(d, bks, today), trMan = tripsOn(d, bks, tomorrow);
  const paxHoy = trHoy.reduce((a, t) => a + t.pax, 0);
  const resultado = cobrado - gastos;

  const todo = [];
  porConfirmar.slice(0, 6).forEach((b) => todo.push({ b, why: chip("Por confirmar", "warn"), meta: `${fmtDay(b.date)} ${b.time}` }));
  saldoViejo.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6).forEach((b) => todo.push({ b, why: chip(`Debe ${money(b.balance)}`, "bad"), meta: `viajó el ${fmtDay(b.date)}` }));
  aDevolver.slice(0, 6).forEach((b) => todo.push({ b, why: chip(`Devolver ${money(b.net)}`, "bad"), meta: "cancelada" }));
  sinTarifa.slice(0, 4).forEach((b) => todo.push({ b, why: chip("Sin tarifa", "off"), meta: `${fmtDay(b.date)} ${b.time}` }));

  const tripLine = (t) => h("button", { type: "button", class: "line" + (t.closed ? " is-off" : ""), onclick: () => ctx.go("salidas", { date: t.rows[0] ? iso(t.rows[0].trip_date) : today, open: t.key }) },
    h("strong", { class: "line__t" }, t.time), h("span", { class: "line__m" }, routeName(d.content, t.routeId).replace(/ · .*/, ""), t.closed && h("small", { class: "sub" }, " · cerrada")), bar(t.seats, t.cap));
  const tripList = (list, empty) => (list.length ? h("div", { class: "lines" }, list.filter((t) => t.pax || !t.closed).slice(0, 10).map(tripLine)) : h("p", { class: "empty" }, empty));

  const withRes = (list) => list.filter((t) => t.pax > 0);
  return h("div", { class: "page" },
    pageHead("Inicio", `${fmtDayLong(today)}. Lo que pasa hoy y lo que hay que resolver.`),
    ctx.alerts(),
    h("div", { class: "kpis" },
      kpi({ label: "Salen hoy", value: `${withRes(trHoy).length} ${withRes(trHoy).length === 1 ? "salida" : "salidas"}`, sub: `${paxHoy} ${paxHoy === 1 ? "pasajero" : "pasajeros"} con reserva`, go: () => ctx.go("salidas", {}) }),
      kpi({ label: "Por confirmar", value: porConfirmar.length, sub: porConfirmar.length ? "esperan una respuesta" : "todo al día", tone: porConfirmar.length ? "warn" : "", go: () => ctx.go("reservas", { status: "pendiente", preset: "upcoming" }) }),
      kpi({ label: "Por cobrar", value: money(saldo.reduce((a, b) => a + b.balance, 0)), sub: `${saldo.length} ${saldo.length === 1 ? "reserva" : "reservas"}${saldoViejo.length ? ` · ${saldoViejo.length} de viajes ya hechos` : ""}`, tone: saldoViejo.length ? "bad" : "", go: () => ctx.go("cobros", { tab: "porcobrar" }) }),
      kpi({ label: "Cobrado este mes", value: money(cobrado), sub: `vendido: ${money(vendido.total)}`, go: () => ctx.go("finanzas", {}) }),
      kpi({ label: "Gastos del mes", value: money(gastos), go: () => ctx.go("gastos", {}) }),
      kpi({ label: "Resultado del mes", value: money(resultado), sub: "cobrado menos gastos", tone: resultado < 0 ? "bad" : resultado > 0 ? "ok" : "", go: () => ctx.go("finanzas", {}) })),
    flotaPanel(ctx),
    h("div", { class: "cols" },
      h("section", { class: "panel" }, h("h2", {}, "Para resolver"), todo.length
        ? h("div", { class: "lines" }, todo.map((x) => h("button", { type: "button", class: "line", onclick: () => ctx.open(x.b.code) },
          h("strong", { class: "line__t" }, x.b.code), h("span", { class: "line__m" }, x.b.names[0] + (x.b.names.length > 1 ? ` +${x.b.names.length - 1}` : ""), h("small", { class: "sub" }, " · " + x.meta)), x.why)))
        : h("p", { class: "okline" }, icon("check", 18), "No hay nada pendiente. Reservas confirmadas y cobradas.")),
      h("section", { class: "panel" }, h("h2", {}, "Salidas de hoy"), tripList(withRes(trHoy), "Hoy no hay reservas."),
        h("h2", { class: "h2b" }, "Mañana"), tripList(withRes(trMan), "Mañana todavía no hay reservas."))),
    h("section", { class: "panel" },
      h("div", { class: "panel__top" }, h("h2", {}, "Últimos 6 meses"), h("span", { class: "legend" }, h("i", { class: "sw sw--in" }), "Cobrado", h("i", { class: "sw sw--out" }), "Gastos")),
      barChart(monthly(d.pay, d.exp, 6, today))));
}

/* =========================================================== RESERVAS */
const PRESETS = { upcoming: "Desde hoy en adelante", today: "Hoy", week: "Próximos 7 días", month: "Este mes", last30: "Últimos 30 días", all: "Todas las fechas" };
const presetRange = (p, today) => ({ upcoming: [today, ""], today: [today, today], week: [today, addDays(today, 6)], month: [monthStart(today), monthEnd(today)], last30: [addDays(today, -30), today], all: ["", ""] }[p] || ["", ""]);
const RS = { q: "", preset: "upcoming", status: "", pay: "", route: "", limit: 100 };

export function reservas(ctx, pre = {}) {
  if (Object.keys(pre).length) Object.assign(RS, { q: "", preset: "upcoming", status: "", pay: "", route: "" }, pre); // al llegar desde otra pantalla se parte de filtros limpios
  RS.limit = 100;
  const d = ctx.data(), today = todayJ();
  const q = input({ label: "Buscar", type: "search", value: RS.q, placeholder: "Código, nombre, documento o teléfono", max: 60, cls: "grow" });
  const preset = input({ label: "Fechas", options: Object.entries(PRESETS), value: RS.preset });
  const status = input({ label: "Estado", options: [["", "Todos"], ...Object.entries(STATUS)], value: RS.status });
  const pay = input({ label: "Cobro", options: [["", "Todos"], ["con_saldo", "Con saldo por cobrar"], ...Object.entries(PAY)], value: RS.pay });
  const route = input({ label: "Servicio", options: [["", "Todos"], ...d.content.routes.map((r) => [r.id, routeName(d.content, r.id)])], value: RS.route });
  const list = h("div"), foot = h("p", { class: "hint" });
  let shown = [];

  const filtered = () => {
    const [a, b] = presetRange(RS.preset, today), t = norm(RS.q).trim();
    return ctx.bks().filter((x) => {
      if (t) { if (!norm([x.code, x.names.join(" "), x.phone, x.email, x.rows.map((r) => r.passenger_doc).join(" ")].join(" ")).includes(t)) return false; }
      else if ((a && x.date < a) || (b && x.date > b)) return false;
      if (RS.status && x.status !== RS.status) return false;
      if (RS.pay === "con_saldo" ? !(x.status !== "cancelada" && x.balance > 0) : RS.pay && x.pay !== RS.pay) return false;
      if (RS.route && x.route !== RS.route) return false;
      return true;
    }).sort((x, y) => (RS.preset === "upcoming" || RS.preset === "today" || RS.preset === "week" ? 1 : -1) * (x.date.localeCompare(y.date) || x.time.localeCompare(y.time)));
  };
  const update = () => {
    shown = filtered();
    const page = shown.slice(0, RS.limit);
    put(list, table({ label: "Reservas", empty: RS.q ? "Ninguna reserva coincide con esa búsqueda." : "No hay reservas con esos filtros.", onRow: (b) => ctx.open(b.code), rows: page, cols: [
      { h: "Reserva", c: (b) => h("span", {}, h("strong", { class: "mono" }, b.code), h("small", { class: "sub block" }, b.rows[0].source === "web" ? "web" : "boletería")) },
      { h: "Viaje", c: (b) => h("span", {}, h("strong", {}, `${fmtDay(b.date)} ${b.time}`), h("small", { class: "sub block" }, `${b.from} → ${b.to}`)) },
      { h: "Pasajeros", c: (b) => h("span", {}, b.names[0] + (b.names.length > 1 ? ` +${b.names.length - 1}` : ""), h("small", { class: "sub block" }, `Asiento${b.seats.length > 1 ? "s" : ""} ${b.seats.join(", ")}`)) },
      { h: "Total", num: true, c: (b) => (b.status === "cancelada" ? "—" : b.total ? money(b.total) : "—") },
      { h: "Cobrado", num: true, c: (b) => (b.net ? money(b.net) : "—") },
      { h: "Saldo", num: true, c: (b) => (b.status === "cancelada" ? (b.net > 0 ? h("strong", { class: "neg" }, "−" + money(b.net)) : "—") : b.balance > 0 ? h("strong", { class: "neg" }, money(b.balance)) : b.balance < 0 ? h("strong", {}, "+" + money(-b.balance)) : "—") },
      { h: "Estado", c: (b) => h("span", { class: "chips" }, chip(STATUS[b.status], STATUS_TONE[b.status]), b.status !== "cancelada" || b.net > 0 ? chip(PAY[b.pay], PAY_TONE[b.pay]) : null) }] }));
    if (shown.length > RS.limit) list.append(h("button", { type: "button", class: "btn btn--ghost more", onclick: () => { RS.limit += 100; update(); } }, `Ver más (${shown.length - RS.limit} restantes)`));
    const act = shown.filter((b) => b.status !== "cancelada");
    foot.textContent = `${shown.length} ${shown.length === 1 ? "reserva" : "reservas"}${RS.q ? " (buscando en todas las fechas)" : ""} · total ${money(act.reduce((a, b) => a + b.total, 0))} · cobrado ${money(shown.reduce((a, b) => a + b.net, 0))} · por cobrar ${money(act.reduce((a, b) => a + Math.max(0, b.balance), 0))}`;
  };
  const on = (f, key, ev) => f.input.addEventListener(ev, () => { RS[key] = f.get(); RS.limit = 100; update(); });
  on(q, "q", "input"); on(preset, "preset", "change"); on(status, "status", "change"); on(pay, "pay", "change"); on(route, "route", "change");
  ctx.viewUpdate = update; update();
  return h("div", { class: "page" },
    pageHead("Reservas", "Todas las reservas en un solo lugar, de la web y de la boletería.",
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => download(`reservas-${today}.csv`, toCsv([["Código", (b) => b.code], ["Fecha", (b) => b.date], ["Hora", (b) => b.time], ["Servicio", (b) => routeName(d.content, b.route)], ["Desde", (b) => b.from], ["Hasta", (b) => b.to], ["Asientos", (b) => b.seats.join(" ")], ["Pasajeros", (b) => b.names.join(" / ")], ["Teléfono", (b) => b.phone], ["Estado", (b) => STATUS[b.status]], ["Total", (b) => b.total], ["Cobrado", (b) => b.net], ["Saldo", (b) => b.status === "cancelada" ? 0 : b.balance], ["Cobro", (b) => PAY[b.pay]], ["Origen", (b) => (b.rows[0].source === "web" ? "web" : "boletería")]], shown)) }, icon("down", 18), "Exportar a Excel"),
      h("a", { class: "btn btn--primary", href: "/admin#/reservas", target: "_blank", rel: "noopener" }, icon("plus", 18), "Cargar una reserva")),
    h("div", { class: "tools no-print" }, q.el, preset.el, status.el, pay.el, route.el),
    list, foot);
}

/* =========================================================== SALIDAS */
const SS = { date: "", open: "", all: false };
export function salidas(ctx, pre = {}) {
  const today = todayJ(); if (pre.date) SS.date = pre.date; if (!SS.date) SS.date = today; if (pre.open !== undefined) SS.open = pre.open;
  const d = ctx.data();
  const box = h("div", { class: "trips" });
  const dateIn = input({ label: "Fecha", type: "date", value: SS.date });
  const title = h("h2", { class: "daytitle" });
  const go = (iso2) => { SS.date = iso2 || today; SS.open = ""; dateIn.set(SS.date); update(); };
  dateIn.input.addEventListener("change", () => dateIn.get() && go(dateIn.get()));

  const manifest = (t) => {
    const bkOf = new Map(ctx.bks().map((b) => [b.code, b]));
    const rows = [...t.rows].sort((a, b) => String(a.seat).localeCompare(String(b.seat), "es", { numeric: true }));
    return h("div", { class: "manifest" },
      h("div", { class: "manifest__top no-print" },
        h("button", { type: "button", class: "btn btn--sm", onclick: () => { document.body.classList.add("printing"); const off = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", off); }; window.addEventListener("afterprint", off); window.print(); setTimeout(off, 1500); } }, "Imprimir planilla"),
        h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: () => download(`planilla-${SS.date}-${t.time.replace(":", "")}.csv`, toCsv([["Asiento", (r) => r.seat], ["Pasajero", (r) => r.passenger_name], ["Documento", (r) => r.passenger_doc], ["Sube en", (r) => r.from_name], ["Baja en", (r) => r.to_name], ["Teléfono", (r) => r.phone], ["Reserva", (r) => r.code], ["Estado", (r) => STATUS[r.status]], ["Saldo", (r) => { const b = bkOf.get(r.code); return b && b.status !== "cancelada" ? Math.max(0, b.balance) : 0; }]], rows.filter((r) => r.status !== "cancelada"))) }, icon("down", 16), "Exportar a Excel")),
      h("h3", { class: "print-only" }, `Planilla de pasajeros · ${fmtDayLong(SS.date)} ${t.time} · ${routeName(d.content, t.routeId)}`),
      table({ label: "Planilla de pasajeros", empty: "Esta salida todavía no tiene pasajeros.", onRow: (r) => ctx.open(r.code), rows, cols: [
        { h: "Asiento", c: (r) => h("strong", {}, r.seat) }, { h: "Pasajero", c: (r) => h("span", { class: r.status === "cancelada" ? "strike" : "" }, r.passenger_name) },
        { h: "Documento", c: (r) => r.passenger_doc || "—" }, { h: "Tramo", c: (r) => `${r.from_name} → ${r.to_name}` }, { h: "Teléfono", c: (r) => r.phone || "—" },
        { h: "Reserva", c: (r) => h("span", { class: "mono" }, r.code) },
        { h: "Estado", c: (r) => { const b = bkOf.get(r.code); return h("span", { class: "chips" }, chip(STATUS[r.status], STATUS_TONE[r.status]), b && r.status !== "cancelada" && b.balance > 0 ? chip(`Debe ${money(b.balance)}`, "bad") : null); } }] }));
  };

  function update() {
    const list = tripsOn(ctx.data(), ctx.bks(), SS.date);
    title.textContent = fmtDayLong(SS.date) + (SS.date === today ? " (hoy)" : "");
    const pax = list.reduce((a, t) => a + t.pax, 0), withRes = list.filter((t) => t.rows.length || t.closed || t.key === SS.open);
    const empty = list.length - withRes.length;
    // por defecto solo las salidas con movimiento: un día tiene decenas de horarios y casi todos están vacíos
    const shownList = SS.all ? list : withRes;
    put(box, 
      h("p", { class: "hint" }, `${withRes.length} ${withRes.length === 1 ? "salida con reservas" : "salidas con reservas"} de ${list.length} programadas · ${pax} ${pax === 1 ? "pasajero" : "pasajeros"} · cobrado ${money(list.reduce((a, t) => a + t.cobrado, 0))} de ${money(list.reduce((a, t) => a + t.sold, 0))}`),
      !shownList.length ? h("p", { class: "empty" }, "Todavía no hay reservas para este día.") : null,
      ...shownList.map((t) => {
        const open = SS.open === t.key;
        return h("section", { class: "trip" + (open ? " is-open" : "") + (t.closed ? " is-closed" : "") },
          h("button", { type: "button", class: "trip__head", "aria-expanded": String(open), onclick: () => { SS.open = open ? "" : t.key; update(); } },
            h("strong", { class: "trip__t" }, t.time), h("span", { class: "trip__r" }, routeName(d.content, t.routeId), t.closed && h("small", { class: "sub block" }, "Cerrada" + (t.closed.reason ? ": " + t.closed.reason : ""))),
            bar(t.seats, t.cap), h("span", { class: "trip__m" }, t.pax ? `${money(t.cobrado)} / ${money(t.sold)}` : "Sin reservas"), icon(open ? "up" : "down", 18)),
          open ? manifest(t) : null);
      }), empty > 0 || SS.all ? h("button", { type: "button", class: "btn btn--ghost more no-print", onclick: () => { SS.all = !SS.all; update(); } }, SS.all ? "Ocultar las salidas sin reservas" : `Mostrar también las ${empty} salidas sin reservas`) : null);
  }
  ctx.viewUpdate = update; update();
  return h("div", { class: "page" }, pageHead("Salidas", "Cada salida del día con sus pasajeros, ocupación y cobros."),
    h("div", { class: "daynav no-print" },
      h("button", { type: "button", class: "btn btn--ghost", "aria-label": "Día anterior", onclick: () => go(addDays(SS.date, -1)) }, h("span", { class: "flip" }, icon("arrow", 18))), dateIn.el,
      h("button", { type: "button", class: "btn btn--ghost", "aria-label": "Día siguiente", onclick: () => go(addDays(SS.date, 1)) }, icon("arrow", 18)),
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => go(today) }, "Hoy")),
    title, box);
}

/* =========================================================== PASAJEROS */
const PS = { q: "", limit: 100 };
export function pasajeros(ctx) {
  const q = input({ label: "Buscar", type: "search", value: PS.q, placeholder: "Nombre, documento o teléfono", max: 60, cls: "grow" });
  const list = h("div"), foot = h("p", { class: "hint" });
  let shown = [];
  const all = () => passengers(ctx.data().res, ctx.bks());
  const update = () => {
    const t = norm(PS.q).trim();
    shown = all().filter((p) => !t || norm([p.name, p.doc, p.phone, p.email].join(" ")).includes(t));
    put(list, table({ label: "Pasajeros", empty: t ? "Nadie coincide con esa búsqueda." : "Todavía no hay pasajeros.", onRow: (p) => detail(p), rows: shown.slice(0, PS.limit), cols: [
      { h: "Pasajero", c: (p) => h("span", {}, h("strong", {}, p.name), h("small", { class: "sub block" }, p.doc || "sin documento")) },
      { h: "Contacto", c: (p) => h("span", {}, p.phone || "—", p.email && h("small", { class: "sub block" }, p.email)) },
      { h: "Viajes", num: true, c: (p) => p.trips }, { h: "Último viaje", c: (p) => fmtDay(p.last) }, { h: "Próximo", c: (p) => (p.next ? fmtDay(p.next) : "—") },
      { h: "Pagó", num: true, c: (p) => (p.spent ? money(p.spent) : "—") }, { h: "Debe", num: true, c: (p) => (p.owes > 0 ? h("strong", { class: "neg" }, money(p.owes)) : "—") }] }));
    if (shown.length > PS.limit) list.append(h("button", { type: "button", class: "btn btn--ghost more", onclick: () => { PS.limit += 100; update(); } }, `Ver más (${shown.length - PS.limit} restantes)`));
    foot.textContent = `${shown.length} ${shown.length === 1 ? "pasajero" : "pasajeros"}. Se reconoce a una persona por su documento (o por teléfono y nombre si no lo dejó).`;
  };
  const detail = (p) => {
    const mine = ctx.bks().filter((b) => p.codes.includes(b.code));
    const dr = drawer({ title: p.name, sub: [p.doc && "DNI " + p.doc, p.phone, p.email].filter(Boolean).join(" · ") || "Sin datos de contacto",
      body: h("div", { class: "dsec" }, h("h3", {}, `${mine.length} ${mine.length === 1 ? "reserva" : "reservas"}`), table({ label: "Reservas del pasajero", rows: mine, onRow: (b) => { dr.close(); ctx.open(b.code); }, cols: [
        { h: "Viaje", c: (b) => h("span", {}, h("strong", {}, `${fmtDay(b.date)} ${b.time}`), h("small", { class: "sub block" }, `${b.from} → ${b.to}`)) },
        { h: "Reserva", c: (b) => h("span", { class: "mono" }, b.code) }, { h: "Estado", c: (b) => chip(STATUS[b.status], STATUS_TONE[b.status]) },
        { h: "Saldo", num: true, c: (b) => (b.balance > 0 && b.status !== "cancelada" ? h("strong", { class: "neg" }, money(b.balance)) : "—") }] }) ) });
  };
  q.input.addEventListener("input", () => { PS.q = q.get(); PS.limit = 100; update(); });
  ctx.viewUpdate = update; update();
  return h("div", { class: "page" }, pageHead("Pasajeros", "Quién viaja con la empresa, cuántas veces y si debe algo.",
    h("button", { type: "button", class: "btn btn--ghost", onclick: () => download(`pasajeros-${todayJ()}.csv`, toCsv([["Nombre", (p) => p.name], ["Documento", (p) => p.doc], ["Teléfono", (p) => p.phone], ["Email", (p) => p.email], ["Viajes", (p) => p.trips], ["Último viaje", (p) => p.last], ["Próximo viaje", (p) => p.next], ["Pagó", (p) => p.spent], ["Debe", (p) => p.owes]], shown)) }, icon("down", 18), "Exportar a Excel")),
    h("div", { class: "tools" }, q.el), list, foot);
}
