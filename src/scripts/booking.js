import { ORIGINS, ROUTES, BOOKING, TZ, destinationsFor, short, WA_NUMBER, esc, stopsOf, busFor, fareBetween, runsOn } from "./data.js";
import { fillSelect } from "./schedule.js";
import { tripInfo, bookSeats } from "./reservas.js";
import { payConfig, mountPay, mountReturn } from "./pagos.js";

const $ = (s) => document.querySelector(s);
let payCfg = null; // medios de pago online activados (null = todavía no hay: la reserva se confirma por WhatsApp o teléfono)
const B = { step: 0, origin: ORIGINS[0], dest: "Tilcara", date: "", pax: 1, key: "", seats: [], people: [], taken: [], seatState: "idle", busy: false };
let layout = []; // filas del plano del coche de la salida elegida

const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
const byNum = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });
const money = (n) => "$" + Math.round(n).toLocaleString("es-AR");
const nowMin = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); const g = (t) => +p.find((x) => x.type === t).value; return g("hour") * 60 + g("minute"); };
const todayJujuy = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

// las salidas que de verdad se pueden reservar ese día para el tramo elegido
function options() {
  const out = [];
  ROUTES.filter((r) => r.from === B.origin && r.stops.includes(B.dest)).forEach((r) =>
    r.times.forEach((t) => {
      if (!runsOn(r.days?.[t], B.date)) return;
      const past = B.date === todayJujuy() && +t.slice(0, 2) * 60 + +t.slice(3) < nowMin() + (BOOKING.cutoffMinutes ?? 30);
      out.push({ key: `${r.id}|${t}`, time: t, route: r, past, service: r.service, days: r.days?.[t] });
    }));
  return out.sort((a, b) => a.time.localeCompare(b.time));
}
const current = () => options().find((o) => o.key === B.key) || null;
const segment = () => { const o = current(); if (!o) return null; const st = stopsOf(o.route); return { from: 0, to: st.indexOf(B.dest) }; };

function summary() {
  const parts = [], o = current();
  if (B.origin && B.dest) parts.push(`<b>${esc(short(B.origin))} → ${esc(short(B.dest))}</b>`);
  if (B.date) parts.push(esc(fmtDate(B.date)));
  if (o) parts.push(`${esc(o.time)} h`);
  if (B.seats.length) parts.push(`asiento${B.seats.length > 1 ? "s" : ""} ${[...B.seats].sort(byNum).join(", ")}`);
  return parts.join(" · ") || "Elegí origen, destino y fecha.";
}

function renderPeople() {
  $("#b-people").innerHTML = B.seats.map((s, i) => `
    <p class="pax">Pasajero ${i + 1} · asiento ${esc(s)}</p>
    <label class="field"><span>Nombre y apellido</span><input data-i="${i}" data-k="name" autocomplete="name" maxlength="80" value="${esc(B.people[i]?.name || "")}" /></label>
    <label class="field"><span>DNI o pasaporte</span><input data-i="${i}" data-k="doc" inputmode="numeric" maxlength="20" value="${esc(B.people[i]?.doc || "")}" /></label>`).join("") + `
    <label class="field"><span>Teléfono de contacto</span><input id="b-tel" type="tel" inputmode="tel" autocomplete="tel" maxlength="30" value="${esc(B.tel || "")}" /></label>
    <label class="field"><span>Email (opcional)</span><input id="b-mail" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${esc(B.mail || "")}" /></label>`;
}

// ---- asientos: plano real del coche + ocupación real de esa salida ----
const takenSet = () => {
  const seg = segment(), set = new Set(); if (!seg) return set;
  B.taken.forEach((t) => { if (t.from < seg.to && seg.from < t.to) set.add(String(t.seat)); });
  return set;
};
function renderSeats() {
  const box = $("#b-seats"), msg = $("#b-seats-msg"), wrap = box.closest(".seats-wrap");
  msg.hidden = B.seatState === "ok";
  wrap.classList.toggle("is-off", B.seatState !== "ok");
  if (B.seatState === "loading") { msg.className = "book__note"; msg.textContent = "Cargando los asientos libres…"; box.replaceChildren(); return; }
  if (B.seatState === "closed") { msg.className = "book__note book__note--bad"; msg.textContent = "Esa salida está cerrada. Volvé atrás y elegí otra, o consultá en boletería."; box.replaceChildren(); return; }
  if (B.seatState === "error") {
    msg.className = "book__note book__note--bad"; msg.replaceChildren(document.createTextNode((B.seatErr || "No pudimos cargar los asientos.") + " "));
    const retry = Object.assign(document.createElement("button"), { type: "button", className: "link", textContent: "Reintentar", onclick: () => loadSeats() });
    const wa = Object.assign(document.createElement("a"), { className: "link", target: "_blank", rel: "noopener", textContent: "Reservar por WhatsApp", href: `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Hola Panamericano, quiero reservar ${B.origin} → ${B.dest} el ${B.date}.`)}` });
    msg.append(retry, " · ", wa); box.replaceChildren(); return;
  }
  const taken = takenSet(), cols = Math.max(0, ...layout.map((r) => r.length));
  box.style.gridTemplateColumns = Array.from({ length: cols }, (_, c) => (layout.every((r) => r[c] == null) ? "var(--aisle)" : "var(--seat)")).join(" ");
  box.innerHTML = layout.map((row) => Array.from({ length: cols }, (_, c) => {
    const s = row[c]; if (s == null || String(s).trim() === "") return "<span></span>";
    const n = String(s), isTaken = taken.has(n);
    return `<button type="button" class="seat${B.seats.includes(n) ? " is-mine" : ""}" data-s="${esc(n)}" ${isTaken ? "disabled" : ""} aria-pressed="${B.seats.includes(n)}" aria-label="Asiento ${esc(n)}${isTaken ? " ocupado" : ""}">${esc(n)}</button>`;
  }).join("")).join("");
}
async function loadSeats() {
  const o = current(); if (!o) return;
  B.seatState = "loading"; B.seatErr = ""; layout = busFor(o.route).rows; renderSeats(); validate();
  const key = B.key + B.date;
  try {
    const info = await tripInfo(o.route.id, B.date, o.time);
    if (key !== B.key + B.date) return; // eligió otra salida mientras cargaba
    B.taken = info.taken || []; B.seatState = info.closed ? "closed" : "ok";
    const t = takenSet(); B.seats = B.seats.filter((s) => !t.has(s));
  } catch (e) {
    if (key !== B.key + B.date) return;
    B.seatState = "error"; B.seatErr = e.message;
  }
  renderSeats(); showStepBar();
}

function renderTimes() {
  const list = options();
  $("#b-route-label").textContent = `${short(B.origin)} → ${short(B.dest)} · ${B.date ? fmtDate(B.date) : ""}. Elegí tu horario de salida.`;
  $("#b-times").innerHTML = list.length
    ? list.map((x) => `<button type="button" aria-pressed="${x.key === B.key}" data-k="${esc(x.key)}" ${x.past ? "disabled" : ""}>${esc(x.time)}<small>${esc(x.past ? "ya salió" : x.route.bookable === false ? "consultar en boletería" : x.days || (x.service === "Ruta 9" ? "" : x.service))}</small></button>`).join("")
    : `<p class="empty">No hay salidas para este tramo ese día. Probá con otra fecha.</p>`;
}

function renderAside() {
  const e = (v, ph = "—") => (v ? `<b>${esc(v)}</b>` : `<b class="is-empty">${ph}</b>`);
  const o = current(), seg = segment();
  const route = B.dest ? `<span>${esc(short(B.origin))}</span><i>→</i><span>${esc(short(B.dest))}</span>` : `<span class="is-empty">Elegí tu destino</span>`;
  const fare = o && seg ? fareBetween(o.route, seg.from, seg.to) : null;
  $("#b-aside").innerHTML = `<div class="tk"><div class="tk__stripe"></div><div class="tk__body">
    <p class="tk__label">Tu pasaje</p>
    <div class="tk__route">${route}</div>
    <div class="tk__grid">
      <div><small>Fecha</small>${e(B.date && new Date(B.date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }))}</div>
      <div><small>Salida</small>${e(o && o.time + " h")}</div>
      <div><small>Asientos</small>${e(B.seats.length && [...B.seats].sort(byNum).join(", "))}</div>
      <div><small>Pasajeros</small>${e(String(B.pax))}</div>
    </div>
    <p class="tk__fare">${fare ? `Tarifa: <b>${money(fare)}</b> por persona${B.seats.length > 1 ? ` · <b>${money(fare * B.seats.length)}</b> en total` : ""}. ${payCfg ? "Se paga online al reservar." : "Se paga al confirmar."}` : "Tarifa: se informa al confirmar con la boletería."}</p></div></div>`;
}

function showStepBar() {
  $("#b-summary").innerHTML = summary(); renderAside(); validate();
}
function showStep() {
  document.querySelectorAll(".book__panel").forEach((p) => (p.hidden = +p.dataset.step !== B.step));
  document.querySelectorAll("#b-steps li").forEach((li, i) => li.classList.toggle("is-on", i <= Math.min(B.step, 3)));
  $("#b-back").hidden = B.step === 0 || B.step === 4;
  $("#b-bar").style.display = B.step === 4 ? "none" : "";
  $("#b-next").textContent = B.step === 3 ? "Reservar" : "Continuar";
  $("#book").classList.toggle("is-done", B.step === 4);
  if (B.step !== 3) setErr("");
  showStepBar();
}
function setErr(msg) { const el = $("#b-err"); el.hidden = !msg; el.textContent = msg || ""; }

function validate() {
  const o = current();
  const ok = [
    () => B.origin && B.dest && B.date && B.date >= todayISO(),
    () => !!o && !o.past,
    () => B.seatState === "ok" && B.seats.length === +B.pax,
    () => !B.busy,
  ][B.step]?.() ?? true;
  $("#b-next").disabled = !ok;
  const need = ["Elegí origen, destino y una fecha que no haya pasado", "Elegí un horario para seguir", B.seatState === "ok" ? `Elegí ${Math.max(0, +B.pax - B.seats.length)} asiento${+B.pax - B.seats.length === 1 ? "" : "s"} del mapa` : "Esperá a que carguen los asientos", ""][B.step] || "";
  $("#b-summary").dataset.hint = ok ? "" : need;
}

function fieldError(el, msg) {
  const f = el.closest(".field");
  f.classList.toggle("is-bad", !!msg);
  f.querySelector(".field__err")?.remove();
  if (msg) { f.insertAdjacentHTML("beforeend", `<small class="field__err" role="alert">${esc(msg)}</small>`); el.setAttribute("aria-invalid", "true"); }
  else el.removeAttribute("aria-invalid");
  return !msg;
}

async function confirm() {
  if (B.busy) return;
  const bad = [];
  document.querySelectorAll("#b-people input[data-k]").forEach((el) => {
    const v = el.value.trim();
    const msg = el.dataset.k === "name"
      ? (v.length >= 3 && /\s/.test(v) ? "" : "Escribí nombre y apellido.")
      : (/^[A-Za-z0-9.-]{6,20}$/.test(v) ? "" : "Revisá el documento: entre 6 y 20 letras o números.");
    if (!fieldError(el, msg)) bad.push(el);
  });
  const tel = $("#b-tel"), mail = $("#b-mail");
  if (!fieldError(tel, /^[+\d][\d\s()-]{6,}$/.test(tel.value.trim()) ? "" : "Ingresá un teléfono con característica, solo números.")) bad.push(tel);
  const mv = mail.value.trim();
  if (!fieldError(mail, !mv || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mv) ? "" : "Ese email no parece válido.")) bad.push(mail);
  if (bad.length) {
    bad[0].scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => bad[0].focus({ preventScroll: true }), 350);
    return;
  }
  const inputs = [...document.querySelectorAll("#b-people input[data-k]")];
  B.people = B.seats.map((_, i) => ({ name: inputs.find((e) => e.dataset.i == i && e.dataset.k === "name").value.trim(), doc: inputs.find((e) => e.dataset.i == i && e.dataset.k === "doc").value.trim() }));
  B.tel = tel.value.trim(); B.mail = mv;

  const o = current(), seg = segment(); if (!o || !seg) { setErr("Esa salida ya no está disponible. Volvé atrás y elegí otra."); return; }
  const seats = [...B.seats].sort(byNum);
  const people = seats.map((s) => B.people[B.seats.indexOf(s)]);
  B.busy = true; setErr(""); $("#b-next").disabled = true; $("#b-next").textContent = "Reservando…";
  let res;
  try {
    res = await bookSeats({ route: o.route.id, date: B.date, time: o.time, from: seg.from, to: seg.to, seats, people, phone: B.tel, email: B.mail });
  } catch (e) {
    B.busy = false; $("#b-next").textContent = "Reservar";
    if (e.kind === "SEAT_TAKEN") {
      // alguien reservó ese asiento justo antes: se vuelve al mapa ya actualizado
      B.step = 2; B.seats = B.seats.filter((s) => s !== e.detail); showStep(); await loadSeats();
      setErr(""); const msg = $("#b-seats-msg"); msg.hidden = false; msg.className = "book__note book__note--bad"; msg.textContent = `El asiento ${e.detail} acaba de ser reservado por otra persona. Elegí otro.`;
      return;
    }
    setErr(e.message || "No se pudo reservar. Probá de nuevo."); validate(); return;
  }
  B.busy = false;
  const code = res.code, total = res.total;
  const payOnline = !!(payCfg && total); // con medios de pago activados y tarifa cargada, se paga online
  const msg = [
    `Hola Panamericano, hice la reserva ${code} por la web:`,
    `Viaje: ${B.origin} → ${B.dest}`,
    `Fecha: ${fmtDate(B.date)} · ${o.time} h`,
    `Asientos: ${seats.join(", ")}`,
    ...people.map((p, i) => `Pasajero ${i + 1}: ${p.name}`),
  ].join("\n");
  $("#b-ticket").innerHTML = `
    <div class="ticket__top"><small>Reserva registrada</small><div class="ticket__route">${esc(short(B.origin))} → ${esc(short(B.dest))}</div></div>
    <div class="ticket__grid">
      <div><small>Fecha</small><b>${esc(new Date(B.date + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }))}</b></div>
      <div><small>Salida</small><b>${esc(o.time)} h</b></div>
      <div><small>Asientos</small><b>${esc(seats.join(", "))}</b></div>
    </div>
    <p class="ticket__code">CÓDIGO <strong>${esc(code)}</strong></p>
    ${payOnline
      ? `<div id="b-pay"></div><p class="ticket__note">Guardá tu código. Si tenés algún problema con el pago, escribinos por WhatsApp.</p>`
      : `<p class="ticket__note">${total ? `Total a pagar al confirmar: <b>${esc(money(total))}</b>. ` : ""}${esc(BOOKING.legal || "La boletería te confirma la reserva.")} Guardá tu código.</p>`}
    <div class="ticket__actions">
      <a class="btn${payOnline ? " btn--ghost" : ""}" target="_blank" rel="noopener" href="https://wa.me/${esc(WA_NUMBER)}?text=${encodeURIComponent(msg)}">${payOnline ? "Consultar por WhatsApp" : "Avisar por WhatsApp"}</a>
      <button class="btn btn--ghost" type="button" id="b-again">Nueva reserva</button>
    </div>`;
  B.step = 4; showStep();
  const pay = $("#b-pay");
  if (pay) {
    mountPay(pay, { code, total, expires: res.expires, cfg: payCfg });
    pay.addEventListener("pay:done", (ev) => { const s = $("#b-ticket .ticket__top small"); if (s) s.textContent = ev.detail.kind === "ok" ? "Reserva confirmada" : "Reserva vencida"; const n = $("#b-ticket > .ticket__note"); if (n) n.textContent = "Guardá tu código de reserva."; });
  }
  $("#b-again").onclick = () => { $("#b-pay")?._stop?.(); Object.assign(B, { step: 0, key: "", seats: [], people: [], taken: [], seatState: "idle" }); showStep(); };
}

// Volvés de Mercado Pago (o abrís un link con ?pago=CÓDIGO): se muestra cómo va esa reserva.
async function resumePayment(code) {
  const cfg = await payConfig(); payCfg = cfg;
  B.step = 4; showStep();
  const box = $("#b-ticket"); mountReturn(box, code, cfg);
  const again = Object.assign(document.createElement("div"), { className: "ticket__actions" });
  const btn = Object.assign(document.createElement("button"), { className: "btn btn--ghost", type: "button", textContent: "Nueva reserva", onclick: () => { box.querySelector(".pay")?.parentElement?._stop?.(); history.replaceState(null, "", location.pathname + location.hash); Object.assign(B, { step: 0, key: "", seats: [], people: [], taken: [], seatState: "idle" }); showStep(); } });
  again.append(btn); box.append(again);
  setTimeout(() => document.getElementById("reservar")?.scrollIntoView({ behavior: "smooth", block: "start" }), 500);
}

export function prefill({ origin, dest, time }) {
  B.origin = origin; B.dest = dest; B.key = ""; B.seats = []; B.seatState = "idle";
  fillSelect($("#b-origin"), ORIGINS, origin);
  fillSelect($("#b-dest"), destinationsFor(origin), dest);
  if (!B.date || B.date < todayISO()) B.date = todayISO();
  $("#b-date").value = B.date;
  const list = options(), hit = time ? list.filter((o) => o.time === time && !o.past) : [];
  if (hit.length === 1) B.key = hit[0].key;
  renderTimes(); B.step = 1; showStep();
}

export function initBooking() {
  const o = $("#b-origin"), d = $("#b-dest"), dt = $("#b-date"), pax = $("#b-pax");
  const maxSeats = Math.max(1, Math.min(BOOKING.maxSeats || 6, 10));
  pax.innerHTML = Array.from({ length: maxSeats }, (_, i) => `<option>${i + 1}</option>`).join("");
  fillSelect(o, ORIGINS, B.origin); fillSelect(d, destinationsFor(B.origin), B.dest);
  dt.min = todayISO(); dt.value = B.date = todayISO();
  const lim = new Date(); lim.setDate(lim.getDate() + (BOOKING.daysAhead || 60)); dt.max = new Date(lim.getTime() - lim.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (BOOKING.legal) $(".book__legal").textContent = BOOKING.legal;
  payConfig().then((c) => {
    payCfg = c; if (!c) return; renderAside();
    // con pago online el aviso de abajo no puede seguir diciendo que no se cobra nada por la web
    const legal = $(".book__legal");
    if (legal && /no se cobra nada/i.test(legal.textContent)) legal.textContent = "El pago se hace online al reservar, con Mercado Pago o transferencia." + (BOOKING.holdMinutes > 0 ? " Si no se paga a tiempo, los asientos se liberan solos." : "");
  });
  const back = new URLSearchParams(location.search).get("pago");
  if (/^PB-[A-Z0-9]{6}$/.test(back || "")) resumePayment(back);
  const reset = () => { B.key = ""; B.seats = []; B.seatState = "idle"; };

  o.onchange = () => { B.origin = o.value; fillSelect(d, destinationsFor(B.origin), B.dest); B.dest = d.value; reset(); showStep(); };
  d.onchange = () => { B.dest = d.value; reset(); showStep(); };
  dt.onchange = () => { B.date = dt.value; reset(); showStep(); };
  pax.onchange = (e) => { B.pax = +e.target.value; B.seats = []; showStep(); };

  $("#b-times").onclick = (e) => {
    const b = e.target.closest("[data-k]"); if (!b || b.disabled) return;
    B.key = b.dataset.k; B.seats = []; B.seatState = "idle"; renderTimes(); showStep();
  };
  $("#b-seats").onclick = (e) => {
    const b = e.target.closest("[data-s]"); if (!b || b.disabled) return;
    const n = b.dataset.s;
    if (B.seats.includes(n)) B.seats = B.seats.filter((x) => x !== n);
    else if (B.seats.length < +B.pax) B.seats.push(n);
    else { B.seats.shift(); B.seats.push(n); }
    renderSeats(); showStepBar();
  };
  $("#b-back").onclick = () => { B.step = Math.max(0, B.step - 1); if (B.step === 1) renderTimes(); showStep(); };
  $("#b-next").onclick = () => {
    if (B.step === 0) { renderTimes(); B.step = 1; }
    else if (B.step === 1) { B.step = 2; B.seats = []; showStep(); loadSeats(); return; }
    else if (B.step === 2) { renderPeople(); B.step = 3; }
    else if (B.step === 3) return confirm();
    showStep();
  };
  showStep();
}
