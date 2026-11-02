import { h, icon, chip, STATUS_TONE, PAY_TONE, drawer, input, table, put } from "./kit.js";
import { confirmBox, toast, plainErr } from "../admin/ui.js";
import { addPayment, deletePayment, setStatus, setNote } from "./api.js";
import { money, r2, todayJ, fmtDay, fmtDayLong, METHODS, STATUS, PAY } from "./model.js";

const waLink = (phone, text) => { const d = String(phone || "").replace(/\D/g, ""); if (d.length < 8) return null; const n = d.startsWith("54") ? d : "54" + d.replace(/^0/, ""); return `https://wa.me/${n}?text=${encodeURIComponent(text)}`; };

// ficha completa de una reserva. ctx: { bks(), routeName(id), reload() }
export function openBooking(ctx, code, opts = {}) {
  let form = opts.form || null;            // "cobro" | "devolucion" | null
  let busy = false;
  const find = () => ctx.bks().find((b) => b.code === code);
  const dr = drawer({ title: code, sub: "", body: h("div"), foot: null, onClose: () => ctx.onDrawerClose?.() });

  const act = async (fn, ok) => {
    if (busy) return; busy = true;
    try { await fn(); await ctx.reload(); if (ok) toast(ok, "ok", 4500); }
    catch (e) { toast(plainErr(e), "err", 9000); await ctx.reload().catch(() => {}); }
    finally { busy = false; paint(); }
  };

  function paint() {
    const b = find();
    if (!b) { put(dr.body, h("p", { class: "empty" }, "Esta reserva ya no existe.")); put(dr.foot); return; }
    dr.panel.querySelector("h2").textContent = b.code;
    const sub = dr.panel.querySelector(".drawer__head p") || dr.panel.querySelector(".drawer__head div").appendChild(h("p"));
    sub.textContent = `${fmtDayLong(b.date)} · ${b.time} · ${ctx.routeName(b.route)}`;

    const wa = waLink(b.phone, `Hola ${b.names[0] || ""}, te escribimos de Panamericano por tu reserva ${b.code} (${fmtDay(b.date)} ${b.time}, ${b.from} → ${b.to}).`);
    const owes = b.balance > 0, refund = b.balance < 0 || (b.status === "cancelada" && b.net > 0);
    const money$ = (label, v, cls) => h("div", { class: "sum__i" + (cls ? " " + cls : "") }, h("span", {}, label), h("strong", {}, money(v)));

    const status = h("section", { class: "dsec" },
      h("div", { class: "dsec__row" }, chip(STATUS[b.status], STATUS_TONE[b.status]), chip(PAY[b.pay], PAY_TONE[b.pay]), b.rows[0].source === "web" ? chip("Pedida por la web") : chip("Cargada en boletería")),
      h("div", { class: "dsec__acts" },
        b.status === "pendiente" && h("button", { type: "button", class: "btn btn--sm", disabled: busy, onclick: () => act(() => setStatus(b.code, "confirmada"), "Reserva confirmada.") }, icon("check", 16), "Confirmar"),
        b.status !== "cancelada" && h("button", { type: "button", class: "btn btn--sm btn--ghost", disabled: busy, onclick: async () => {
          const msg = b.net > 0 ? `Vas a cancelar la reserva ${b.code}. Ya se cobraron ${money(b.net)}: quedan marcados "A devolver" hasta que registres la devolución. Los asientos quedan libres. ¿Cancelar?` : `Vas a cancelar la reserva ${b.code}. Los asientos quedan libres para otras personas. ¿Cancelar?`;
          if (await confirmBox(msg, "Cancelar la reserva", "No, dejarla", { focusCancel: true })) act(() => setStatus(b.code, "cancelada"), b.net > 0 ? `Reserva cancelada. Falta devolver ${money(b.net)}.` : "Reserva cancelada.");
        } }, "Cancelar reserva"),
        b.status === "cancelada" && h("button", { type: "button", class: "btn btn--sm btn--ghost", disabled: busy, onclick: () => act(() => setStatus(b.code, "pendiente"), "Reserva reabierta (por confirmar).") }, icon("undo", 16), "Reabrir")));

    const people = h("section", { class: "dsec" }, h("h3", {}, "Pasajeros"),
      table({ label: "Pasajeros", cols: [
        { h: "Asiento", c: (r) => h("strong", {}, r.seat) }, { h: "Nombre", c: (r) => r.passenger_name }, { h: "Documento", c: (r) => r.passenger_doc || "—" },
        { h: "Tarifa", num: true, c: (r) => (r.fare == null ? "sin tarifa" : money(r.fare)) },
        { h: "Estado", c: (r) => chip(STATUS[r.status], STATUS_TONE[r.status]) }], rows: b.rows }),
      h("p", { class: "hint" }, `${b.from} → ${b.to}`));

    const contact = h("section", { class: "dsec" }, h("h3", {}, "Contacto"),
      h("p", {}, b.phone ? h("a", { class: "link", href: "tel:" + b.phone.replace(/\s/g, "") }, b.phone) : "Sin teléfono", b.email && [" · ", h("a", { class: "link", href: "mailto:" + b.email }, b.email)]),
      wa && h("a", { class: "btn btn--sm btn--ghost", href: wa, target: "_blank", rel: "noopener" }, icon("external", 16), "Escribir por WhatsApp"));

    const cuenta = h("section", { class: "dsec" }, h("h3", {}, "Cuenta"),
      h("div", { class: "sum" }, money$("Total del viaje", b.total), money$("Cobrado", b.net),
        refund ? money$("A devolver", b.status === "cancelada" ? b.net : -b.balance, "is-bad") : money$("Saldo", Math.max(0, b.balance), owes ? "is-bad" : "is-ok")),
      b.noFare > 0 && h("p", { class: "warn" }, `${b.noFare} ${b.noFare === 1 ? "asiento no tiene" : "asientos no tienen"} tarifa cargada: el total puede estar incompleto.`),
      b.pays.length ? table({ label: "Cobros de la reserva", cols: [
        { h: "Fecha", c: (p) => fmtDay(p.paid_at) },
        { h: "Detalle", c: (p) => h("span", {}, p.kind === "devolucion" ? "Devolución" : "Cobro", " · ", METHODS[p.method] || p.method, p.ref && h("small", { class: "sub" }, " " + p.ref)) },
        { h: "Importe", num: true, c: (p) => h("strong", { class: p.kind === "devolucion" ? "neg" : "" }, (p.kind === "devolucion" ? "− " : "") + money(p.amount)) },
        { h: "", cls: "act", c: (p) => h("button", { type: "button", class: "ico ico--del ico--sm", "aria-label": `Anular este ${p.kind === "devolucion" ? "movimiento" : "cobro"} de ${money(p.amount)}`, disabled: busy, onclick: async () => {
          if (await confirmBox(`¿Anular ${p.kind === "devolucion" ? "la devolución" : "el cobro"} de ${money(p.amount)} del ${fmtDay(p.paid_at)}? Se borra del registro y el saldo se recalcula.`, "Anular", "No", { focusCancel: true })) act(() => deletePayment(p.id), "Se anuló el registro.");
        } }, icon("trash", 18)) }], rows: b.pays }) : h("p", { class: "empty" }, "Todavía no se registró ningún cobro."),
      form ? payForm(b) : null);

    const note = noteBox(b);
    put(dr.body, status, cuenta, people, contact, note);
    put(dr.foot, 
      form ? null : h("button", { type: "button", class: "btn btn--primary", disabled: busy || b.status === "cancelada" && b.net <= 0, onclick: () => { form = b.status === "cancelada" ? "devolucion" : "cobro"; paint(); dr.body.querySelector(".payform input")?.focus(); } }, icon("plus", 18), b.status === "cancelada" ? "Registrar devolución" : "Registrar cobro"),
      !form && b.status !== "cancelada" && b.net > 0 ? h("button", { type: "button", class: "btn btn--ghost", disabled: busy, onclick: () => { form = "devolucion"; paint(); dr.body.querySelector(".payform input")?.focus(); } }, "Devolver dinero") : null);
  }

  function noteBox(b) {
    const ta = input({ label: "Nota interna", long: true, value: b.note, hint: "Solo la ve el personal.", max: 300 });
    return h("section", { class: "dsec" }, ta.el, h("button", { type: "button", class: "btn btn--sm btn--ghost", disabled: busy, onclick: () => act(() => setNote(b.code, ta.get().trim()), "Nota guardada.") }, "Guardar nota"));
  }

  function payForm(b) {
    const isRefund = form === "devolucion";
    const maxBack = b.net;
    const f = {
      amount: input({ label: isRefund ? "Importe a devolver ($)" : "Importe cobrado ($)", type: "number", min: "0", step: "0.01", inputmode: "decimal", value: isRefund ? (b.status === "cancelada" ? b.net : Math.max(0, -b.balance) || "") : (b.balance > 0 ? b.balance : ""), required: true }),
      method: input({ label: "Forma de pago", options: Object.entries(METHODS), value: "efectivo" }),
      date: input({ label: "Fecha", type: "date", value: todayJ(), maxv: todayJ() }),
      ref: input({ label: "Referencia (opcional)", placeholder: "N.º de operación, comprobante…", max: 80 }),
    };
    const conf = b.status === "pendiente" && !isRefund ? h("input", { type: "checkbox", id: "confirm-too", checked: true }) : null;
    const submit = async (e) => {
      e.preventDefault();
      const amount = r2(+f.amount.get());
      f.amount.error(""); f.date.error("");
      if (!(amount > 0)) return f.amount.error("Escribí un importe mayor a cero.");
      if (!f.date.get()) return f.date.error("Elegí la fecha.");
      if (f.date.get() > todayJ()) return f.date.error("La fecha no puede ser futura.");
      if (isRefund && amount > maxBack + 0.001) return f.amount.error(`No se puede devolver más de lo cobrado (${money(maxBack)}).`);
      if (!isRefund && b.total > 0 && amount > b.balance + 0.001 && !(await confirmBox(`El importe (${money(amount)}) es mayor al saldo (${money(Math.max(0, b.balance))}). ¿Registrarlo igual?`, "Registrar igual", "Corregir", { focusCancel: true }))) return;
      const wasForm = form; form = null;
      await act(async () => {
        await addPayment({ code: b.code, kind: wasForm, amount, method: f.method.get(), paid_at: f.date.get(), ref: f.ref.get().trim() });
        if (conf?.checked) await setStatus(b.code, "confirmada");
      }, isRefund ? `Devolución de ${money(amount)} registrada.` : `Cobro de ${money(amount)} registrado${conf?.checked ? " y reserva confirmada" : ""}.`);
    };
    return h("form", { class: "payform", onsubmit: submit, novalidate: true },
      h("h4", {}, isRefund ? "Devolver dinero" : "Registrar un cobro"),
      h("div", { class: "grid2" }, f.amount.el, f.method.el), h("div", { class: "grid2" }, f.date.el, f.ref.el),
      conf && h("label", { class: "check" }, conf, h("span", {}, "Confirmar también la reserva")),
      h("div", { class: "payform__act" }, h("button", { type: "button", class: "btn btn--ghost", onclick: () => { form = null; paint(); } }, "Cancelar"), h("button", { type: "submit", class: "btn btn--primary", disabled: busy }, isRefund ? "Registrar devolución" : "Registrar cobro")));
  }

  ctx.redrawDrawer = paint;
  paint();
  if (form) dr.body.querySelector(".payform input")?.focus();
  return dr;
}
