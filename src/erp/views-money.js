import { h, icon, chip, kpi, table, input, drawer, download, barChart, put, STATUS_TONE, PAY_TONE } from "./kit.js";
import { toast, confirmBox, plainErr } from "../admin/ui.js";
import { money, r2, todayJ, addDays, addMonths, monthStart, monthEnd, fmtDay, fmtMonth, cashIn, spend, sold, monthly, toCsv, METHODS, CATEGORIES, STATUS, PAY, inRange } from "./model.js";
import { routeName } from "./trips.js";
import { saveExpense, deleteExpense } from "./api.js";
import { pageHead } from "./views-ops.js";

const norm = (x) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);
const monthNav = (get, set, label) => {
  const t = h("strong", { class: "monthnav__t" });
  const paint = () => { t.textContent = fmtMonth(get()); };
  const move = (n) => { set(addMonths(get(), n)); paint(); };
  paint();
  return h("div", { class: "monthnav no-print", "aria-label": label },
    h("button", { type: "button", class: "ico", "aria-label": "Mes anterior", onclick: () => move(-1) }, h("span", { class: "flip" }, icon("arrow", 20))), t,
    h("button", { type: "button", class: "ico", "aria-label": "Mes siguiente", onclick: () => move(1) }, icon("arrow", 20)),
    h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: () => { set(monthStart(todayJ())); paint(); } }, "Este mes"));
};

/* =========================================================== COBROS */
const CS = { tab: "registrados", preset: "month", method: "", kind: "", limit: 100 };
const CPRESETS = { today: "Hoy", month: "Este mes", prev: "Mes anterior", last30: "Últimos 30 días", all: "Todo" };
const crange = (p, t) => ({ today: [t, t], month: [monthStart(t), monthEnd(t)], prev: [addMonths(monthStart(t), -1), monthEnd(addMonths(monthStart(t), -1))], last30: [addDays(t, -30), t], all: ["", ""] }[p]);

export function cobros(ctx, pre = {}) {
  if (pre.tab) CS.tab = pre.tab;
  const today = todayJ();
  const body = h("div"), head = h("div", { class: "tabs", role: "tablist", "aria-label": "Cobros" });
  const tabs = [["registrados", "Cobros registrados"], ["porcobrar", "Por cobrar"], ["adevolver", "A devolver"]];

  const picker = () => {
    const q = input({ label: "Reserva", type: "search", placeholder: "Código, nombre o teléfono", max: 60 }), res = h("div", { class: "lines" });
    const fill = () => {
      const t = norm(q.get()).trim();
      const l = ctx.bks().filter((b) => b.status !== "cancelada" && (t ? norm([b.code, b.names.join(" "), b.phone].join(" ")).includes(t) : b.balance > 0))
        .sort((a, b) => (b.balance > 0) - (a.balance > 0) || b.date.localeCompare(a.date)).slice(0, 30);
      put(res, ...(l.length ? l.map((b) => h("button", { type: "button", class: "line", onclick: () => { dr.close(); ctx.open(b.code, { form: "cobro" }); } },
        h("strong", { class: "line__t" }, b.code), h("span", { class: "line__m" }, b.names[0] + (b.names.length > 1 ? ` +${b.names.length - 1}` : ""), h("small", { class: "sub" }, ` · ${fmtDay(b.date)} ${b.time}`)),
        b.balance > 0 ? chip(`Debe ${money(b.balance)}`, "bad") : chip("Al día", "ok"))) : [h("p", { class: "empty" }, t ? "Ninguna reserva coincide." : "No hay reservas con saldo por cobrar. Buscá por código o nombre.")]));
    };
    q.input.addEventListener("input", fill); fill();
    const dr = drawer({ title: "Registrar un cobro", sub: "Elegí la reserva a la que corresponde.", body: h("div", { class: "dsec" }, q.el, res) });
    q.input.focus();
  };

  const draw = () => {
    put(head, ...tabs.map(([id, t]) => h("button", { type: "button", role: "tab", id: "tab-" + id, "aria-selected": String(CS.tab === id), class: "tab" + (CS.tab === id ? " is-sel" : ""), onclick: () => { CS.tab = id; CS.limit = 100; draw(); } }, t)));
    const d = ctx.data(), bks = ctx.bks(), bkOf = new Map(bks.map((b) => [b.code, b]));
    if (CS.tab === "registrados") {
      const preset = input({ label: "Fechas", options: Object.entries(CPRESETS), value: CS.preset }), method = input({ label: "Forma de pago", options: [["", "Todas"], ...Object.entries(METHODS)], value: CS.method }), kind = input({ label: "Tipo", options: [["", "Cobros y devoluciones"], ["cobro", "Solo cobros"], ["devolucion", "Solo devoluciones"]], value: CS.kind });
      const out = h("div", { class: "vstack" });
      const fill = () => {
        const [a, b] = crange(CS.preset, today);
        const rows = d.pay.filter((p) => inRange(p.paid_at, a, b) && (!CS.method || p.method === CS.method) && (!CS.kind || p.kind === CS.kind)).sort((x, y) => y.paid_at.localeCompare(x.paid_at) || String(y.created_at).localeCompare(String(x.created_at)));
        const sums = cashIn(rows, "", "");
        put(out, 
          h("div", { class: "kpis kpis--sm" }, kpi({ label: "Cobrado (neto)", value: money(sums.total), sub: `${rows.length} ${rows.length === 1 ? "movimiento" : "movimientos"}` }),
            ...Object.entries(sums.by).filter(([, v]) => v).map(([m, v]) => kpi({ label: METHODS[m] || m, value: money(v) }))),
          table({ label: "Cobros registrados", empty: "No hay cobros registrados con esos filtros.", rows: rows.slice(0, CS.limit), onRow: (p) => bkOf.has(p.code) && ctx.open(p.code), cols: [
            { h: "Fecha", c: (p) => fmtDay(p.paid_at) }, { h: "Reserva", c: (p) => h("span", {}, h("strong", { class: "mono" }, p.code), !bkOf.has(p.code) && h("small", { class: "sub block" }, "reserva borrada")) },
            { h: "Pasajero", c: (p) => bkOf.get(p.code)?.names[0] || "—" }, { h: "Tipo", c: (p) => (p.kind === "devolucion" ? chip("Devolución", "bad") : chip("Cobro", "ok")) },
            { h: "Forma", c: (p) => METHODS[p.method] || p.method }, { h: "Referencia", c: (p) => p.ref || "—" },
            { h: "Importe", num: true, c: (p) => h("strong", { class: p.kind === "devolucion" ? "neg" : "" }, (p.kind === "devolucion" ? "− " : "") + money(p.amount)) }] }),
          rows.length > CS.limit ? h("button", { type: "button", class: "btn btn--ghost more", onclick: () => { CS.limit += 100; fill(); } }, `Ver más (${rows.length - CS.limit} restantes)`) : null);
        out.dataset.csv = "1"; out._rows = rows;
      };
      [[preset, "preset"], [method, "method"], [kind, "kind"]].forEach(([f, k]) => f.input.addEventListener("change", () => { CS[k] = f.get(); CS.limit = 100; fill(); }));
      fill(); ctx.viewUpdate = () => { draw(); };
      put(body, h("div", { class: "tools no-print" }, preset.el, method.el, kind.el,
        h("button", { type: "button", class: "btn btn--ghost", onclick: () => download(`cobros-${today}.csv`, toCsv([["Fecha", (p) => p.paid_at], ["Reserva", (p) => p.code], ["Pasajero", (p) => bkOf.get(p.code)?.names.join(" / ") || ""], ["Tipo", (p) => (p.kind === "devolucion" ? "Devolución" : "Cobro")], ["Forma de pago", (p) => METHODS[p.method]], ["Referencia", (p) => p.ref], ["Importe", (p) => (p.kind === "devolucion" ? -p.amount : p.amount)]], out._rows)) }, icon("down", 18), "Exportar a Excel")), out);
    } else {
      const por = CS.tab === "porcobrar";
      const rows = bks.filter((b) => (por ? b.status !== "cancelada" && b.balance > 0 : b.pay === "a_devolver" || b.pay === "de_mas")).sort((a, b) => a.date.localeCompare(b.date));
      const tot = rows.reduce((a, b) => a + (por ? b.balance : b.pay === "a_devolver" ? b.net : -b.balance), 0);
      put(body, 
        h("div", { class: "kpis kpis--sm" }, kpi({ label: por ? "Total por cobrar" : "Total a devolver", value: money(tot), sub: `${rows.length} ${rows.length === 1 ? "reserva" : "reservas"}`, tone: rows.length ? "bad" : "ok" })),
        table({ label: por ? "Reservas con saldo" : "Reservas a devolver", empty: por ? "No hay saldos por cobrar. Todo está al día." : "No hay nada para devolver.", rows, onRow: (b) => ctx.open(b.code, { form: por ? "cobro" : "devolucion" }), cols: [
          { h: "Reserva", c: (b) => h("strong", { class: "mono" }, b.code) }, { h: "Pasajero", c: (b) => h("span", {}, b.names[0] + (b.names.length > 1 ? ` +${b.names.length - 1}` : ""), h("small", { class: "sub block" }, b.phone || "sin teléfono")) },
          { h: "Viaje", c: (b) => h("span", {}, `${fmtDay(b.date)} ${b.time}`, h("small", { class: "sub block" }, b.date < today ? `hace ${daysBetween(b.date, today)} d` : b.date === today ? "hoy" : `en ${daysBetween(today, b.date)} d`)) },
          { h: "Estado", c: (b) => chip(STATUS[b.status], STATUS_TONE[b.status]) }, { h: "Total", num: true, c: (b) => money(b.total) }, { h: "Cobrado", num: true, c: (b) => money(b.net) },
          { h: por ? "Saldo" : "A devolver", num: true, c: (b) => h("strong", { class: "neg" }, money(por ? b.balance : b.pay === "a_devolver" ? b.net : -b.balance)) }] }));
      ctx.viewUpdate = draw;
    }
  };
  draw();
  return h("div", { class: "page" }, pageHead("Cobros", "Lo que se cobró, lo que falta cobrar y lo que hay que devolver.", h("button", { type: "button", class: "btn btn--primary", onclick: picker }, icon("plus", 18), "Registrar un cobro")), head, body);
}

/* =========================================================== GASTOS */
const GS = { month: "", cat: "", route: "", limit: 100 };
export function gastos(ctx) {
  const today = todayJ(); if (!GS.month) GS.month = monthStart(today);
  const d0 = ctx.data();
  const cat = input({ label: "Categoría", options: [["", "Todas"], ...Object.entries(CATEGORIES)], value: GS.cat });
  const route = input({ label: "Servicio", options: [["", "Todos"], ...d0.content.routes.map((r) => [r.id, routeName(d0.content, r.id)])], value: GS.route });
  const out = h("div", { class: "vstack" });
  const rowsNow = () => ctx.data().exp.filter((e) => inRange(e.spent_at, GS.month, monthEnd(GS.month)) && (!GS.cat || e.category === GS.cat) && (!GS.route || e.route_id === GS.route)).sort((a, b) => b.spent_at.localeCompare(a.spent_at) || String(b.created_at).localeCompare(String(a.created_at)));
  const fill = () => {
    const d = ctx.data(), rows = rowsNow(), tot = r2(rows.reduce((a, e) => a + e.amount, 0)), sp = spend(rows, "", "");
    const busName = (id) => d.content.buses.find((b) => b.id === id)?.name;
    put(out, 
      h("div", { class: "kpis kpis--sm" }, kpi({ label: "Gastos del mes", value: money(tot), sub: `${rows.length} ${rows.length === 1 ? "gasto" : "gastos"}` }),
        ...Object.entries(sp.by).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => kpi({ label: CATEGORIES[c] || c, value: money(v), sub: tot ? Math.round((v / tot) * 100) + "%" : "" }))),
      table({ label: "Gastos", empty: "No hay gastos cargados en este mes. Tocá «Cargar un gasto».", rows: rows.slice(0, GS.limit), onRow: (e) => form(e), cols: [
        { h: "Fecha", c: (e) => fmtDay(e.spent_at) }, { h: "Categoría", c: (e) => chip(CATEGORIES[e.category] || e.category) },
        { h: "Detalle", c: (e) => h("span", {}, e.description || "—", e.supplier && h("small", { class: "sub block" }, e.supplier)) },
        { h: "Coche / servicio", c: (e) => [e.bus_id && busName(e.bus_id), e.route_id && routeName(d.content, e.route_id)].filter(Boolean).join(" · ") || "—" },
        { h: "Forma", c: (e) => METHODS[e.method] || e.method }, { h: "Importe", num: true, c: (e) => h("strong", {}, money(e.amount)) }] }),
      rows.length > GS.limit ? h("button", { type: "button", class: "btn btn--ghost more", onclick: () => { GS.limit += 100; fill(); } }, `Ver más (${rows.length - GS.limit} restantes)`) : null);
  };

  function form(e) {
    const d = ctx.data(), isNew = !e;
    const f = {
      date: input({ label: "Fecha", type: "date", value: e?.spent_at || (inRange(today, GS.month, monthEnd(GS.month)) ? today : GS.month), maxv: today }),
      cat: input({ label: "Categoría", options: Object.entries(CATEGORIES), value: e?.category || "combustible" }),
      amount: input({ label: "Importe ($)", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: e?.amount ?? "", required: true }),
      method: input({ label: "Forma de pago", options: Object.entries(METHODS), value: e?.method || "efectivo" }),
      desc: input({ label: "Detalle", placeholder: "Por ejemplo: gasoil, coche 12", value: e?.description || "", max: 120, cls: "full" }),
      sup: input({ label: "Proveedor (opcional)", value: e?.supplier || "", max: 80 }),
      bus: input({ label: "Coche (opcional)", options: [["", "Ninguno"], ...d.content.buses.map((b) => [b.id, b.name])], value: e?.bus_id || "" }),
      route: input({ label: "Servicio (opcional)", options: [["", "Ninguno"], ...d.content.routes.map((r) => [r.id, routeName(d.content, r.id)])], value: e?.route_id || "" }),
    };
    let busy = false;
    const submit = async (ev) => {
      ev.preventDefault(); if (busy) return;
      const amount = r2(+f.amount.get()); f.amount.error(""); f.date.error("");
      if (!(amount > 0)) return f.amount.error("Escribí un importe mayor a cero.");
      if (!f.date.get()) return f.date.error("Elegí la fecha.");
      if (f.date.get() > today) return f.date.error("La fecha no puede ser futura.");
      busy = true; save.disabled = true;
      try {
        const row = await saveExpense({ id: e?.id, spent_at: f.date.get(), category: f.cat.get(), amount, description: f.desc.get().trim(), supplier: f.sup.get().trim(), method: f.method.get(), bus_id: f.bus.get(), route_id: f.route.get() });
        await ctx.reload(); dr.close(); toast(isNew ? `Gasto de ${money(amount)} cargado.` : "Gasto actualizado.", "ok", 4000);
        if (!inRange(row.spent_at, GS.month, monthEnd(GS.month))) { GS.month = monthStart(row.spent_at); ctx.redraw(); }
      } catch (x) { toast(plainErr(x), "err", 9000); busy = false; save.disabled = false; }
    };
    const save = h("button", { type: "submit", class: "btn btn--primary" }, isNew ? "Cargar el gasto" : "Guardar los cambios");
    const del = !isNew && h("button", { type: "button", class: "btn btn--ghost", onclick: async () => {
      if (!(await confirmBox(`¿Borrar el gasto de ${money(e.amount)} del ${fmtDay(e.spent_at)}${e.description ? " (" + e.description + ")" : ""}? No se puede deshacer.`, "Borrar el gasto", "No", { focusCancel: true }))) return;
      try { await deleteExpense(e.id); await ctx.reload(); dr.close(); toast("Gasto borrado.", "ok", 4000); } catch (x) { toast(plainErr(x), "err", 9000); }
    } }, icon("trash", 18), "Borrar");
    const fm = h("form", { class: "payform payform--flat", onsubmit: submit, novalidate: true },
      h("div", { class: "grid2" }, f.date.el, f.cat.el), h("div", { class: "grid2" }, f.amount.el, f.method.el), f.desc.el, h("div", { class: "grid2" }, f.sup.el, f.bus.el), f.route.el,
      h("div", { class: "payform__act" }, del, save));
    const dr = drawer({ title: isNew ? "Cargar un gasto" : "Gasto", sub: isNew ? "Combustible, peajes, sueldos, arreglos…" : fmtDay(e.spent_at), body: fm });
    f.amount.input.focus();
  }

  [[cat, "cat"], [route, "route"]].forEach(([f, k]) => f.input.addEventListener("change", () => { GS[k] = f.get(); GS.limit = 100; fill(); }));
  ctx.viewUpdate = fill; fill();
  const nav = monthNav(() => GS.month, (m) => { GS.month = m; GS.limit = 100; fill(); }, "Mes de los gastos");
  return h("div", { class: "page" }, pageHead("Gastos", "Lo que gasta la empresa: combustible, peajes, sueldos, arreglos.",
    h("button", { type: "button", class: "btn btn--ghost", onclick: () => download(`gastos-${GS.month.slice(0, 7)}.csv`, toCsv([["Fecha", (e) => e.spent_at], ["Categoría", (e) => CATEGORIES[e.category] || e.category], ["Detalle", (e) => e.description], ["Proveedor", (e) => e.supplier], ["Forma de pago", (e) => METHODS[e.method]], ["Coche", (e) => ctx.data().content.buses.find((b) => b.id === e.bus_id)?.name || ""], ["Servicio", (e) => (e.route_id ? routeName(ctx.data().content, e.route_id) : "")], ["Importe", (e) => e.amount]], rowsNow())) }, icon("down", 18), "Exportar a Excel"),
    h("button", { type: "button", class: "btn btn--primary", onclick: () => form(null) }, icon("plus", 18), "Cargar un gasto")),
    h("div", { class: "tools no-print" }, nav, cat.el, route.el), out);
}

/* =========================================================== FINANZAS */
const FS = { month: "", limit: 50 };
export function finanzas(ctx) {
  const today = todayJ(); if (!FS.month) FS.month = monthStart(today);
  const out = h("div", { class: "vstack" });
  const fill = () => {
    const d = ctx.data(), bks = ctx.bks(), a = FS.month, b = monthEnd(a);
    const cin = cashIn(d.pay, a, b), sp = spend(d.exp, a, b), vend = sold(d.res, a, b), result = r2(cin.total - sp.total);
    const mBks = bks.filter((x) => x.status !== "cancelada" && x.date >= a && x.date <= b);
    const porCobrar = r2(mBks.reduce((s, x) => s + Math.max(0, x.balance), 0));
    // por servicio: viajes del mes y gastos asignados a ese servicio
    const byRoute = new Map();
    const R = (id) => { if (!byRoute.has(id)) byRoute.set(id, { id, sold: 0, paid: 0, spend: 0, pax: 0 }); return byRoute.get(id); };
    mBks.forEach((x) => { const r = R(x.route); r.sold += x.total; r.paid += Math.min(x.net, x.total); r.pax += x.live.length; });
    d.exp.filter((e) => inRange(e.spent_at, a, b) && e.route_id).forEach((e) => { R(e.route_id).spend += e.amount; });
    const unassigned = r2(d.exp.filter((e) => inRange(e.spent_at, a, b) && !e.route_id).reduce((s, e) => s + e.amount, 0));
    const moves = [
      ...d.pay.filter((p) => inRange(p.paid_at, a, b)).map((p) => ({ date: p.paid_at, type: p.kind === "devolucion" ? "Devolución" : "Cobro", what: `${p.code} · ${ctx.bks().find((x) => x.code === p.code)?.names[0] || "reserva borrada"}`, method: p.method, in: p.kind === "devolucion" ? 0 : p.amount, out: p.kind === "devolucion" ? p.amount : 0, t: p.created_at })),
      ...d.exp.filter((e) => inRange(e.spent_at, a, b)).map((e) => ({ date: e.spent_at, type: "Gasto", what: `${CATEGORIES[e.category] || e.category}${e.description ? " · " + e.description : ""}`, method: e.method, in: 0, out: e.amount, t: e.created_at })),
    ].sort((x, y) => y.date.localeCompare(x.date) || String(y.t).localeCompare(String(x.t)));
    const share = (v, t) => (t > 0 ? Math.round((v / t) * 100) + "%" : "—");
    put(out, 
      h("div", { class: "kpis kpis--5" },
        kpi({ label: "Cobrado", value: money(cin.total), sub: "entró a caja (neto de devoluciones)" }), kpi({ label: "Gastos", value: money(sp.total) }),
        kpi({ label: "Resultado de caja", value: money(result), sub: "cobrado menos gastos", tone: result < 0 ? "bad" : result > 0 ? "ok" : "" }),
        kpi({ label: "Vendido (viajes del mes)", value: money(vend.total), sub: `${vend.seats} ${vend.seats === 1 ? "asiento" : "asientos"} en ${vend.bookings} ${vend.bookings === 1 ? "reserva" : "reservas"}` }),
        kpi({ label: "Falta cobrar de esos viajes", value: money(porCobrar), tone: porCobrar ? "warn" : "", go: () => ctx.go("cobros", { tab: "porcobrar" }) })),
      h("div", { class: "cols" },
        h("section", { class: "panel" }, h("h2", {}, "Cobrado por forma de pago"), Object.keys(cin.by).length ? table({ label: "Cobrado por forma de pago", rows: Object.entries(cin.by).sort((x, y) => y[1] - x[1]), cols: [{ h: "Forma", c: ([m]) => METHODS[m] || m }, { h: "Importe", num: true, c: ([, v]) => money(v) }, { h: "%", num: true, c: ([, v]) => share(v, cin.total) }] }) : h("p", { class: "empty" }, "No hay cobros en este mes.")),
        h("section", { class: "panel" }, h("h2", {}, "Gastos por categoría"), Object.keys(sp.by).length ? table({ label: "Gastos por categoría", rows: Object.entries(sp.by).sort((x, y) => y[1] - x[1]), cols: [{ h: "Categoría", c: ([c]) => CATEGORIES[c] || c }, { h: "Importe", num: true, c: ([, v]) => money(v) }, { h: "%", num: true, c: ([, v]) => share(v, sp.total) }] }) : h("p", { class: "empty" }, "No hay gastos en este mes."))),
      h("section", { class: "panel" }, h("h2", {}, "Por servicio"), h("p", { class: "hint" }, "Viajes del mes y gastos cargados a ese servicio. Lo cobrado es lo que ya entró por esos viajes."),
        byRoute.size || unassigned ? table({ label: "Resultado por servicio", rows: [...byRoute.values(), ...(unassigned ? [{ id: "", sold: 0, paid: 0, spend: unassigned, pax: 0 }] : [])].sort((x, y) => y.sold - x.sold), cols: [
          { h: "Servicio", c: (r) => (r.id ? routeName(d.content, r.id) : "Gastos sin servicio asignado") }, { h: "Pasajeros", num: true, c: (r) => r.pax || "—" },
          { h: "Vendido", num: true, c: (r) => (r.sold ? money(r.sold) : "—") }, { h: "Cobrado", num: true, c: (r) => (r.paid ? money(r.paid) : "—") },
          { h: "Gastos", num: true, c: (r) => (r.spend ? money(r.spend) : "—") }, { h: "Resultado", num: true, c: (r) => h("strong", { class: r.paid - r.spend < 0 ? "neg" : "" }, money(r.paid - r.spend)) }] }) : h("p", { class: "empty" }, "Sin viajes ni gastos por servicio en este mes.")),
      h("section", { class: "panel" }, h("div", { class: "panel__top" }, h("h2", {}, "Últimos 12 meses"), h("span", { class: "legend" }, h("i", { class: "sw sw--in" }), "Cobrado", h("i", { class: "sw sw--out" }), "Gastos")), barChart(monthly(d.pay, d.exp, 12, today))),
      h("section", { class: "panel" }, h("div", { class: "panel__top" }, h("h2", {}, "Libro de caja"),
        h("button", { type: "button", class: "btn btn--sm btn--ghost no-print", onclick: () => download(`caja-${a.slice(0, 7)}.csv`, toCsv([["Fecha", (m) => m.date], ["Tipo", (m) => m.type], ["Concepto", (m) => m.what], ["Forma de pago", (m) => METHODS[m.method] || m.method], ["Entrada", (m) => m.in], ["Salida", (m) => m.out]], [...moves].reverse())) }, icon("down", 16), "Exportar a Excel")),
        table({ label: "Libro de caja", empty: "No hubo movimientos en este mes.", rows: moves.slice(0, FS.limit), cols: [
          { h: "Fecha", c: (m) => fmtDay(m.date) }, { h: "Tipo", c: (m) => chip(m.type, m.type === "Cobro" ? "ok" : "bad") }, { h: "Concepto", c: (m) => m.what }, { h: "Forma", c: (m) => METHODS[m.method] || m.method },
          { h: "Entrada", num: true, c: (m) => (m.in ? money(m.in) : "") }, { h: "Salida", num: true, c: (m) => (m.out ? h("span", { class: "neg" }, money(m.out)) : "") }] }),
        moves.length > FS.limit ? h("button", { type: "button", class: "btn btn--ghost more", onclick: () => { FS.limit += 50; fill(); } }, `Ver más (${moves.length - FS.limit} restantes)`) : null));
  };
  ctx.viewUpdate = fill; fill();
  return h("div", { class: "page" }, pageHead("Finanzas", "Cuánto entró, cuánto salió y cómo viene cada servicio."),
    h("div", { class: "tools no-print" }, monthNav(() => FS.month, (m) => { FS.month = m; FS.limit = 50; fill(); }, "Mes")), out);
}
