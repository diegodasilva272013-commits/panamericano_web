// Pantalla de pago de la reserva: Mercado Pago (tarjeta o saldo) o transferencia con CVU/alias exclusivo.
// El monto y el estado salen siempre del servidor; acá solo se muestra y se espera la confirmación.
const money = (n) => "$" + Math.round(n).toLocaleString("es-AR");

async function api(path, init = {}, ms = 15000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(path, { ...init, signal: ctl.signal, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
    let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
    return { ok: res.ok, status: res.status, json };
  } catch { return { ok: false, status: 0, json: null }; } finally { clearTimeout(timer); }
}

// Qué medios de pago están activados. Sin servidor de pagos (o sin ninguno activado) devuelve null y la web sigue como antes.
let cfg = null;
export const payConfig = () => (cfg ||= api("/api/pay/config", {}, 4000).then((r) => (r.ok && r.json && (r.json.mp || r.json.talo) ? r.json : null)));

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

async function copy(text, btn) {
  const old = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = "Copiado"; }
  catch { const t = el("textarea"); t.value = text; document.body.append(t); t.select(); try { document.execCommand("copy"); btn.textContent = "Copiado"; } catch { btn.textContent = "Copiá a mano"; } t.remove(); }
  setTimeout(() => { btn.textContent = old; }, 1800);
}

// Monta el bloque de pago dentro de `box`. opts: { code, total, expires, cfg, showOptions }
// Devuelve una función para detenerlo. Mientras está montado consulta el estado cada pocos segundos.
export function mountPay(box, { code, total, expires, cfg: c, showOptions = true }) {
  box._stop?.();
  const exp = expires ? new Date(expires).getTime() : null;
  const root = el("section", "pay"); root.setAttribute("aria-label", "Pago de la reserva");
  const head = el("p", "pay__head");
  const timer = el("b", "pay__timer");
  const state = el("p", "pay__state"); state.setAttribute("role", "status"); state.setAttribute("aria-live", "polite");
  const opts = el("div", "pay__opts"), bank = el("div", "pay__bank"); bank.hidden = true;
  root.append(head, opts, bank, state); box.replaceChildren(root);

  let alive = true, polling = null, ticking = null, busy = false, finished = false;
  const onVisible = () => { if (!document.hidden) check(); };
  const stop = () => { alive = false; clearInterval(polling); clearInterval(ticking); document.removeEventListener("visibilitychange", onVisible); };
  box._stop = stop;

  const setHead = () => {
    head.replaceChildren();
    if (total != null) head.append(document.createTextNode("Total a pagar: "), el("b", "", money(total)));
    if (exp) { head.append(document.createTextNode(total != null ? " · Tu reserva se mantiene " : "Tu reserva se mantiene "), timer, document.createTextNode(" minutos.")); timer.textContent = mmss(exp - Date.now()); }
  };
  setHead();

  const finish = (kind) => {
    if (finished) return; finished = true; stop();
    opts.hidden = true; bank.hidden = true; head.hidden = true;
    root.classList.add(kind === "ok" ? "pay--ok" : "pay--bad");
    state.setAttribute("role", "alert");
    if (kind === "ok") state.replaceChildren(Object.assign(el("strong", "", "¡Pago confirmado!")), document.createTextNode(` Tu reserva ${code} está confirmada. Guardá el código y presentá tu DNI al subir al coche.`));
    else state.replaceChildren(Object.assign(el("strong", "", "El tiempo para pagar terminó.")), document.createTextNode(` Los asientos de la reserva ${code} se liberaron. Si ya pagaste, escribinos por WhatsApp con tu código. Si no, hacé una reserva nueva.`));
    box.dispatchEvent(new CustomEvent("pay:done", { detail: { code, kind } }));
  };

  async function check() {
    if (!alive || finished) return;
    const r = await api(`/api/pay/status?code=${encodeURIComponent(code)}`, {}, 12000);
    if (!alive || !r.ok) return;
    const s = r.json?.state;
    if (s === "confirmada") finish("ok");
    else if (s === "vencida" || s === "cancelada") finish("bad");
  }
  polling = setInterval(() => { if (!document.hidden) check(); }, 5000);
  if (exp) ticking = setInterval(() => { const left = exp - Date.now(); timer.textContent = mmss(left); if (left <= 0) { clearInterval(ticking); check(); } }, 1000);
  document.addEventListener("visibilitychange", onVisible);

  function showBank(d) {
    bank.hidden = false;
    const row = (label, value) => {
      const r = el("div", "pay__row"), l = el("small", "", label), v = el("b", "", value), b = el("button", "pay__copy", "Copiar");
      b.type = "button"; b.setAttribute("aria-label", `Copiar ${label.toLowerCase()}`); b.onclick = () => copy(value, b);
      r.append(l, v, b); return r;
    };
    bank.replaceChildren(
      el("p", "pay__lead", `Transferí exactamente ${money(d.amount)} desde la app de cualquier banco o billetera a estos datos. Son exclusivos de tu reserva:`),
      row("CVU", d.cvu), ...(d.alias ? [row("Alias", d.alias)] : []), row("Importe", String(Math.round(d.amount))),
      el("p", "pay__hint", "Cuando el dinero llegue, esta pantalla se confirma sola. No hace falta mandar comprobante."));
  }

  async function start(method, btn) {
    if (busy || finished) return; busy = true;
    opts.querySelectorAll("button").forEach((b) => (b.disabled = true));
    state.textContent = method === "mp" ? "Abriendo Mercado Pago…" : "Generando los datos de transferencia…";
    const r = await api("/api/pay/create", { method: "POST", body: JSON.stringify({ code, method }) }, 20000);
    busy = false; opts.querySelectorAll("button").forEach((b) => (b.disabled = false));
    if (!r.ok) {
      state.setAttribute("role", "alert");
      state.textContent = r.json?.message || "No pudimos iniciar el pago. Revisá tu conexión y probá de nuevo.";
      if (r.status === 409 || r.status === 404) check();
      return;
    }
    state.setAttribute("role", "status");
    if (method === "mp") { state.textContent = "Te llevamos a Mercado Pago…"; window.location.assign(r.json.url); return; }
    state.textContent = "Esperando tu transferencia…";
    showBank(r.json); btn?.setAttribute("aria-expanded", "true");
  }

  if (showOptions) {
    if (c?.mp) { const b = el("button", "btn", "Pagar con Mercado Pago"); b.type = "button"; b.onclick = () => start("mp", b); opts.append(b); }
    if (c?.talo) { const b = el("button", "btn btn--ghost", "Pagar por transferencia"); b.type = "button"; b.onclick = () => start("talo", b); opts.append(b); }
  } else { opts.hidden = true; head.hidden = true; state.textContent = "Verificando tu pago…"; }
  check();
  return stop;
}

// Al volver de Mercado Pago (o desde un link con ?pago=CÓDIGO): muestra cómo va esa reserva.
export function mountReturn(box, code, cfg) {
  box.replaceChildren();
  const wrap = el("div", "ticket__top"), t = el("small", "", "Tu pago"), h = el("div", "ticket__route", code);
  wrap.append(t, h);
  const slot = el("div", "pay-slot"); box.append(wrap, slot);
  api(`/api/pay/status?code=${encodeURIComponent(code)}`, {}, 12000).then((r) => {
    const s = r.json?.state;
    if (!r.ok) { slot.append(el("p", "ticket__note", "No pudimos consultar el estado. Probá de nuevo en un momento.")); return; }
    if (s === "inexistente") { slot.append(el("p", "ticket__note", "No encontramos una reserva con ese código.")); return; }
    if (s === "pendiente") {
      const p = el("p", "ticket__note", "Todavía no recibimos la confirmación del pago. Si ya pagaste, puede tardar unos segundos: esta pantalla se actualiza sola. Si no pagaste, podés pagar ahora.");
      slot.append(p); const dock = el("div", "pay-dock"); slot.append(dock);
      mountPay(dock, { code, total: null, expires: r.json.expires, cfg, showOptions: !!cfg });
      return;
    }
    mountPay(slot, { code, total: null, expires: null, cfg, showOptions: false });
  });
}
