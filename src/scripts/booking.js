import { ORIGINS, destinationsFor, search, short, WA_NUMBER, esc } from "./data.js";
import { fillSelect } from "./schedule.js";

const $ = (s) => document.querySelector(s);
const B = { step: 0, origin: ORIGINS[0], dest: "Tilcara", date: "", pax: 1, time: "", seats: [], people: [] };
let seatMap = [];

const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// Demo: ocupación determinística por viaje (no es disponibilidad real)
function buildSeats() {
  const seed = hash(`${B.origin}${B.dest}${B.date}${B.time}`);
  const total = 44;
  seatMap = Array.from({ length: total }, (_, i) => ({ n: i + 1, taken: (hash(seed + ":" + i) % 100) < 38 }));
}

function summary() {
  const parts = [];
  if (B.origin && B.dest) parts.push(`<b>${esc(short(B.origin))} → ${esc(short(B.dest))}</b>`);
  if (B.date) parts.push(fmtDate(B.date));
  if (B.time) parts.push(`${B.time} h`);
  if (B.seats.length) parts.push(`asiento${B.seats.length > 1 ? "s" : ""} ${B.seats.sort((a, b) => a - b).join(", ")}`);
  return parts.join(" · ") || "Elegí origen, destino y fecha.";
}

function renderPeople() {
  $("#b-people").innerHTML = B.seats.map((s, i) => `
    <p class="pax">Pasajero ${i + 1} · asiento ${s}</p>
    <label class="field"><span>Nombre y apellido</span><input data-i="${i}" data-k="name" autocomplete="name" value="${B.people[i]?.name || ""}" /></label>
    <label class="field"><span>DNI o pasaporte</span><input data-i="${i}" data-k="doc" inputmode="numeric" value="${B.people[i]?.doc || ""}" /></label>`).join("") + `
    <label class="field"><span>Teléfono de contacto</span><input id="b-tel" type="tel" inputmode="tel" autocomplete="tel" value="${B.tel || ""}" /></label>
    <label class="field"><span>Email (opcional)</span><input id="b-mail" type="email" inputmode="email" autocomplete="email" value="${B.mail || ""}" /></label>`;
}

function renderSeats() {
  const rows = [];
  for (let i = 0; i < seatMap.length; i += 4) {
    const r = seatMap.slice(i, i + 4);
    const btn = (s) => s ? `<button type="button" class="seat${B.seats.includes(s.n) ? " is-mine" : ""}" data-s="${s.n}" ${s.taken ? "disabled" : ""} aria-label="Asiento ${s.n}${s.taken ? " ocupado" : ""}">${s.n}</button>` : "<span></span>";
    rows.push(btn(r[0]) + btn(r[1]) + "<span></span>" + btn(r[2]) + btn(r[3]));
  }
  $("#b-seats").innerHTML = rows.join("");
}

function renderTimes() {
  const list = search(B.origin, B.dest);
  $("#b-route-label").textContent = `${short(B.origin)} → ${short(B.dest)} · ${B.date ? fmtDate(B.date) : ""}. Elegí tu horario de salida.`;
  $("#b-times").innerHTML = list.length
    ? list.map((x) => `<button type="button" aria-pressed="${x.time === B.time}" data-t="${x.time}">${x.time}<small>${esc(x.days || (x.service === "Ruta 9" ? "" : x.service))}</small></button>`).join("")
    : `<p class="empty">No hay servicios cargados para este tramo.</p>`;
}

function renderAside() {
  const e = (v, ph = "—") => (v ? `<b>${v}</b>` : `<b class="is-empty">${ph}</b>`);
  const route = B.dest
    ? `<span>${short(B.origin)}</span><i>→</i><span>${short(B.dest)}</span>`
    : `<span class="is-empty">Elegí tu destino</span>`;
  $("#b-aside").innerHTML = `<div class="tk"><div class="tk__stripe"></div><div class="tk__body">
    <p class="tk__label">Tu pasaje</p>
    <div class="tk__route">${route}</div>
    <div class="tk__grid">
      <div><small>Fecha</small>${e(B.date && new Date(B.date + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }))}</div>
      <div><small>Salida</small>${e(B.time && B.time + " h")}</div>
      <div><small>Asientos</small>${e(B.seats.length && [...B.seats].sort((a, b) => a - b).join(", "))}</div>
      <div><small>Pasajeros</small>${e(String(B.pax))}</div>
    </div>
    <p class="tk__fare">Tarifa: se informa al confirmar con la boletería.</p></div></div>`;
}

function showStep() {
  document.querySelectorAll(".book__panel").forEach((p) => (p.hidden = +p.dataset.step !== B.step));
  document.querySelectorAll("#b-steps li").forEach((li, i) => li.classList.toggle("is-on", i <= Math.min(B.step, 3)));
  $("#b-back").hidden = B.step === 0 || B.step === 4;
  $("#b-bar").style.display = B.step === 4 ? "none" : "";
  const next = $("#b-next");
  next.textContent = B.step === 3 ? "Confirmar solicitud" : "Continuar";
  $("#b-summary").innerHTML = summary();
  $("#book").classList.toggle("is-done", B.step === 4);
  renderAside();
  validate();
}

function validate() {
  const ok = [
    () => B.origin && B.dest && B.date,
    () => !!B.time,
    () => B.seats.length === +B.pax,
    () => true,
  ][B.step]?.() ?? true;
  $("#b-next").disabled = !ok;
  const need = ["Elegí origen, destino y fecha", "Elegí un horario para seguir", `Elegí ${Math.max(0, +B.pax - B.seats.length)} asiento${+B.pax - B.seats.length === 1 ? "" : "s"} del mapa`, ""][B.step] || "";
  $("#b-summary").dataset.hint = ok ? "" : need;
}

function fieldError(el, msg) {
  const f = el.closest(".field");
  f.classList.toggle("is-bad", !!msg);
  f.querySelector(".field__err")?.remove();
  if (msg) { f.insertAdjacentHTML("beforeend", `<small class="field__err" role="alert">${msg}</small>`); el.setAttribute("aria-invalid", "true"); }
  else el.removeAttribute("aria-invalid");
  return !msg;
}

function confirm() {
  const bad = [];
  document.querySelectorAll("#b-people input[data-k]").forEach((el) => {
    const v = el.value.trim();
    const msg = el.dataset.k === "name"
      ? (v.length >= 3 && /\s/.test(v) ? "" : "Escribí nombre y apellido.")
      : (/^[\w.-]{6,}$/.test(v) ? "" : "Revisá el documento: mínimo 6 caracteres.");
    if (!fieldError(el, msg)) bad.push(el);
  });
  const tel = $("#b-tel"), mail = $("#b-mail");
  if (!fieldError(tel, /^[+\d][\d\s()-]{7,}$/.test(tel.value.trim()) ? "" : "Ingresá un teléfono con característica, solo números.")) bad.push(tel);
  const mv = mail.value.trim();
  if (!fieldError(mail, !mv || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mv) ? "" : "Ese email no parece válido.")) bad.push(mail);
  if (bad.length) {
    bad[0].scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => bad[0].focus({ preventScroll: true }), 350);
    return;
  }
  const inputs = [...document.querySelectorAll("#b-people input[data-k]")];
  const tv = tel.value.trim();
  B.people = B.seats.map((_, i) => ({ name: inputs.find((e) => e.dataset.i == i && e.dataset.k === "name").value.trim(), doc: inputs.find((e) => e.dataset.i == i && e.dataset.k === "doc").value.trim() }));
  B.tel = tv; B.mail = $("#b-mail").value.trim();

  const code = "PB-" + hash(JSON.stringify(B) + Date.now()).toString(36).toUpperCase().slice(0, 6);
  const msg = [
    `Hola Panamericano, quiero confirmar esta reserva (${code}):`,
    `Viaje: ${B.origin} → ${B.dest}`,
    `Fecha: ${fmtDate(B.date)} · ${B.time} h`,
    `Asientos: ${B.seats.join(", ")}`,
    ...B.people.map((p, i) => `Pasajero ${i + 1}: ${p.name} (${p.doc})`),
    `Teléfono: ${B.tel}`,
  ].join("\n");

  $("#b-ticket").innerHTML = `
    <div class="ticket__top"><small>Solicitud de reserva</small><div class="ticket__route">${short(B.origin)} → ${short(B.dest)}</div></div>
    <div class="ticket__grid">
      <div><small>Fecha</small><b>${new Date(B.date + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</b></div>
      <div><small>Salida</small><b>${B.time} h</b></div>
      <div><small>Asientos</small><b>${B.seats.join(", ")}</b></div>
    </div>
    <p class="ticket__code">CÓDIGO <strong>${code}</strong></p>
    <div class="ticket__actions">
      <a class="btn" target="_blank" rel="noopener" href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}">Confirmar por WhatsApp</a>
      <button class="btn btn--ghost" type="button" id="b-again">Nueva reserva</button>
    </div>`;
  B.step = 4; showStep();
  $("#b-again").onclick = () => { Object.assign(B, { step: 0, time: "", seats: [], people: [] }); showStep(); };
}

export function prefill({ origin, dest, time }) {
  B.origin = origin; B.dest = dest; B.time = time || "";
  fillSelect($("#b-origin"), ORIGINS, origin);
  fillSelect($("#b-dest"), destinationsFor(origin), dest);
  B.seats = [];
  if (!B.date) { B.date = todayISO(); $("#b-date").value = B.date; }
  if (time) { buildSeats(); B.step = 2; renderSeats(); } else B.step = 1;
  if (!time) renderTimes();
  showStep();
}

export function initBooking() {
  const o = $("#b-origin"), d = $("#b-dest"), dt = $("#b-date");
  fillSelect(o, ORIGINS, B.origin); fillSelect(d, destinationsFor(B.origin), B.dest);
  dt.min = todayISO(); dt.value = B.date = todayISO();

  o.onchange = () => { B.origin = o.value; fillSelect(d, destinationsFor(B.origin), B.dest); B.dest = d.value; B.time = ""; B.seats = []; showStep(); };
  d.onchange = () => { B.dest = d.value; B.time = ""; B.seats = []; showStep(); };
  dt.onchange = () => { B.date = dt.value; B.seats = []; showStep(); };
  $("#b-pax").onchange = (e) => { B.pax = +e.target.value; B.seats = []; showStep(); };

  $("#b-times").onclick = (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    B.time = b.dataset.t; B.seats = []; renderTimes(); showStep();
  };
  $("#b-seats").onclick = (e) => {
    const b = e.target.closest("[data-s]"); if (!b || b.disabled) return;
    const n = +b.dataset.s;
    if (B.seats.includes(n)) B.seats = B.seats.filter((x) => x !== n);
    else if (B.seats.length < +B.pax) B.seats.push(n);
    else { B.seats.shift(); B.seats.push(n); }
    renderSeats(); showStep();
  };
  $("#b-back").onclick = () => { B.step = Math.max(0, B.step - 1); if (B.step === 1) renderTimes(); showStep(); };
  $("#b-next").onclick = () => {
    if (B.step === 0) { renderTimes(); B.step = 1; }
    else if (B.step === 1) { buildSeats(); renderSeats(); B.step = 2; }
    else if (B.step === 2) { renderPeople(); B.step = 3; }
    else if (B.step === 3) return confirm();
    showStep();
  };
  showStep();
}
