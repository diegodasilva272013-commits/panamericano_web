// Coches (planos de asientos), reglas de reserva y la pantalla de Reservas del panel.
// "Coches y reglas" se guarda con "Guardar y publicar" como el resto. "Reservas" son datos vivos: se guardan al instante.
import { h, field, check, group, listEditor, confirmBox, toast, icon, plainErr, undoToast } from "./ui.js";
import { listReservations, searchReservations, setReservationStatus, setReservationNote, deleteReservations, addReservation, listClosed, closeTrip, openTrip } from "./api.js";
import { runsOn, stopsOf, seatsOf, fareBetween } from "../scripts/data.js";

const TZ = "America/Argentina/Jujuy";
const todayJ = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = (iso) => new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
const fmtDayShort = (iso) => new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
const money = (n) => "$" + Math.round(n).toLocaleString("es-AR");
const byNum = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });
const uid = () => "c" + Math.random().toString(36).slice(2, 8);
const label = (r) => `${r.from} → ${String(r.to).replace(/\*$/, "")}`;

/* ============ planos de asientos ============ */
// cols = columnas en total; aisle = después de qué columna va el pasillo (0 = sin pasillo)
export function buildRows(filas, cols, aisle) {
  let n = 0;
  return Array.from({ length: filas }, () => Array.from({ length: cols + (aisle ? 1 : 0) }, (_, c) => (aisle && c === aisle ? null : String(++n))));
}
export const countSeats = (bus) => seatsOf(bus).length;
const nextFree = (rows) => { const used = new Set(rows.flat().filter((x) => x != null).map(String)); let n = 1; while (used.has(String(n))) n++; return String(n); };

function planEditor(bus, dirty) {
  const count = h("strong", {});
  const grid = h("div", { class: "plan__grid", role: "group", "aria-label": "Asientos del coche. Tocá un lugar para poner o sacar un asiento." });
  const filas = h("input", { type: "number", min: 1, max: 30, value: Math.max(1, bus.rows.length), "aria-label": "Filas" });
  const cols = h("input", { type: "number", min: 1, max: 6, value: 4, "aria-label": "Asientos por fila (sin contar el pasillo)" });
  const aisle = h("select", { "aria-label": "Dónde va el pasillo" });
  const draw = () => {
    const width = Math.max(1, ...bus.rows.map((r) => r.length));
    grid.style.gridTemplateColumns = `repeat(${width}, minmax(34px, 44px))`;
    grid.replaceChildren(...bus.rows.flatMap((row, ri) => Array.from({ length: width }, (_, ci) => {
      const v = row[ci];
      return h("button", { type: "button", class: "plan__c" + (v != null && v !== "" ? " is-on" : ""), "aria-pressed": String(v != null && v !== ""), "aria-label": v != null && v !== "" ? `Asiento ${v}: tocá para sacarlo` : `Lugar vacío, fila ${ri + 1}: tocá para poner un asiento`,
        onclick: () => { row[ci] = v != null && v !== "" ? null : nextFree(bus.rows); dirty(); draw(); } }, v != null && v !== "" ? v : "");
    })));
    count.textContent = `${countSeats(bus)} asientos`;
  };
  const fillAisle = () => { const c = Math.max(1, Math.min(6, +cols.value || 4)); aisle.replaceChildren(h("option", { value: 0 }, "Sin pasillo"), ...Array.from({ length: c - 1 }, (_, i) => h("option", { value: i + 1, selected: i + 1 === Math.floor(c / 2) }, `Después del asiento ${i + 1} de cada fila`))); };
  fillAisle(); cols.addEventListener("change", fillAisle);
  const armar = () => {
    const f = Math.max(1, Math.min(30, +filas.value || 1)), c = Math.max(1, Math.min(6, +cols.value || 4));
    bus.rows = buildRows(f, c, +aisle.value || 0); dirty(); draw();
  };
  draw();
  return h("div", { class: "plan" },
    h("div", { class: "plan__gen" },
      h("label", {}, "Filas", filas), h("label", {}, "Asientos por fila", cols), h("label", {}, "Pasillo", aisle),
      h("button", { type: "button", class: "btn btn--ghost", onclick: async () => { if (!(await confirmBox("Se arma el plano de nuevo y los asientos se numeran otra vez desde el 1. Si ya hay reservas con los números viejos, revisalas después. ¿Armarlo?", "Armar de nuevo", "Cancelar", { focusCancel: true }))) return; armar(); } }, "Armar plano nuevo")),
    h("p", { class: "plan__hint" }, "Tocá un lugar para sacar un asiento (por ejemplo donde está el baño o la escalera) o para ponerlo. ", count),
    h("div", { class: "plan__wrap" }, h("div", { class: "plan__front", "aria-hidden": "true" }, "Adelante"), grid),
    h("div", { class: "plan__row" },
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => {
        const last = bus.rows[bus.rows.length - 1] || [], w = Math.max(1, ...bus.rows.map((r) => r.length)), row = [];
        for (let i = 0; i < w; i++) row.push(last[i] == null ? null : nextFree([...bus.rows, row]));
        bus.rows.push(row); dirty(); draw(); } }, icon("plus", 16), "Agregar fila"),
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => { if (bus.rows.length <= 1) return; const gone = bus.rows.pop(); dirty(); draw(); toast(`Quitaste la última fila.`, "ok", 6000, { label: "Deshacer", run: () => { bus.rows.push(gone); dirty(); draw(); } }); } }, "Quitar la última fila")));
}

export function busesSection({ draft, dirty }) {
  const bk = draft.booking;
  const usedBy = (b) => draft.routes.filter((r) => (r.busId || draft.buses[0]?.id) === b.id).map(label);
  return h("div", { class: "stack" },
    group("Reglas de las reservas", "Valen para todos los servicios. Los cambios se aplican cuando publicás.",
      h("div", { class: "grid2" }, check({ label: "Se puede reservar por la web", value: bk.enabled !== false, onChange: (v) => { bk.enabled = v; dirty(); } })),
      h("div", { class: "grid3" },
        field({ label: "Asientos por reserva (máximo)", type: "number", value: bk.maxSeats, help: "Cuántos asientos puede reservar una persona en una sola vez. Entre 1 y 10.", onInput: (v) => { bk.maxSeats = Math.max(1, Math.min(10, Math.round(+v) || 1)); dirty(); } }),
        field({ label: "Hasta cuántos días antes se reserva", type: "number", value: bk.daysAhead, help: "Por ejemplo 60: no se puede reservar un viaje que sale dentro de más de 60 días.", onInput: (v) => { bk.daysAhead = Math.max(1, Math.min(365, Math.round(+v) || 1)); dirty(); } }),
        field({ label: "Se cierra minutos antes de salir", type: "number", value: bk.cutoffMinutes, help: "Por ejemplo 30: media hora antes de la salida ya no se puede reservar por la web.", onInput: (v) => { bk.cutoffMinutes = Math.max(0, Math.min(1440, Math.round(+v) || 0)); dirty(); } })),
      field({ label: "Aviso debajo del formulario y en el pasaje", long: true, rows: 3, value: bk.legal, help: "Se lee al terminar la reserva. Contá cómo se confirma y cómo se paga.", onInput: (v) => { bk.legal = v; dirty(); } })),
    group("Coches", "El plano de asientos de cada tipo de coche. Después elegís cuál usa cada servicio en Horarios de salida.",
      listEditor({ id: "buses", items: draft.buses, onChange: dirty, addLabel: "Agregar un coche", min: 1, max: 12, title: (b) => b.name || "Coche", sub: (b) => `${countSeats(b)} asientos`,
        make: () => ({ id: uid(), name: "", rows: buildRows(11, 4, 2) }),
        render: (b) => h("div", { class: "stack stack--tight" },
          field({ label: "Nombre del coche", value: b.name, placeholder: "Ej. Doble piso · 60 asientos", onInput: (v) => { b.name = v; dirty(); } }),
          planEditor(b, dirty),
          h("p", { class: "hint" }, (() => { const u = usedBy(b); return u.length ? `Lo usan: ${u.slice(0, 6).join(" · ")}${u.length > 6 ? ` y ${u.length - 6} más` : ""}.` : "Todavía ningún servicio usa este coche."; })())) })));
}

// campos extra de cada servicio en Horarios: coche, si se reserva y tarifas
export function routeBookingFields(r, draft, dirty) {
  const sel = h("select", { "aria-label": "Coche de este servicio" }, ...draft.buses.map((b) => h("option", { value: b.id, selected: b.id === (r.busId || draft.buses[0]?.id) }, `${b.name || "Coche"} · ${countSeats(b)} asientos`)));
  sel.addEventListener("change", () => { r.busId = sel.value; dirty(); });
  const fares = h("div", { class: "fares" });
  const draw = () => {
    r.fares = r.fares || {};
    fares.replaceChildren(h("p", { class: "hint" }, `Precio desde ${r.from || "el origen"} hasta cada parada. Dejá vacío si querés que se consulte en boletería.`),
      ...(r.stops || []).map((p) => {
        const inp = h("input", { type: "number", min: 0, step: 50, inputmode: "numeric", value: r.fares[p] ?? "", placeholder: "—", "aria-label": `Precio hasta ${p}` });
        inp.addEventListener("input", () => { const n = inp.value === "" ? null : Math.max(0, Math.round(+inp.value)); if (n == null || Number.isNaN(n)) delete r.fares[p]; else r.fares[p] = n; dirty(); });
        return h("label", { class: "fares__row" }, h("span", {}, p), h("span", { class: "fares__in" }, "$", inp));
      }));
  };
  const det = h("details", { class: "adv" }, h("summary", {}, "Tarifas por parada"), fares);
  det.addEventListener("toggle", () => { if (det.open) draw(); });
  return h("div", { class: "stack stack--tight" },
    h("div", { class: "grid2" },
      h("div", { class: "field" }, h("div", { class: "field__lab" }, h("label", {}, "Coche de este servicio")), sel),
      h("div", { class: "field" }, h("div", { class: "field__lab" }, h("label", {}, "Reservas")), check({ label: "Se puede reservar por la web", value: r.bookable !== false, onChange: (v) => { if (v) delete r.bookable; else r.bookable = false; dirty(); } }))),
    det);
}

/* ============ pantalla de Reservas (datos vivos) ============ */
const STATUS = { pendiente: "Pendiente", confirmada: "Confirmada", cancelada: "Cancelada" };
export function reservationsSection({ draft }) {
  const S = { date: todayJ(), all: false, trip: "", rows: [], closed: [], q: "", found: null, pick: [], busy: false, err: "" };
  const root = h("div", { class: "stack rv" });
  const busOf = (route) => draft.buses.find((b) => b.id === route.busId) || draft.buses[0];
  const routeOf = (id) => draft.routes.find((r) => r.id === id);
  const guard = async (fn) => { if (S.busy) return; S.busy = true; try { await fn(); } catch (e) { toast(plainErr(e), "err", 9000); } finally { S.busy = false; } };

  // las salidas del día: las del horario que corren ese día + cualquiera que ya tenga reservas
  const trips = () => {
    const list = [];
    draft.routes.forEach((r) => (r.times || []).forEach((t) => { if (runsOn(r.days?.[t], S.date)) list.push({ key: `${r.id}|${t}`, route: r, time: t }); }));
    S.rows.forEach((x) => { const key = `${x.route_id}|${x.trip_time}`, r = routeOf(x.route_id); if (r && !list.some((l) => l.key === key)) list.push({ key, route: r, time: x.trip_time, extra: true }); });
    return list.sort((a, b) => a.time.localeCompare(b.time) || a.route.id.localeCompare(b.route.id));
  };
  const tripRows = (t) => S.rows.filter((x) => x.route_id === t.route.id && x.trip_time === t.time);
  const groupsOf = (rows) => { const m = new Map(); rows.forEach((x) => { (m.get(x.code) || m.set(x.code, []).get(x.code)).push(x); }); return [...m.values()]; };
  const liveRows = (rows) => rows.filter((x) => x.status !== "cancelada");

  const load = async () => {
    try { [S.rows, S.closed] = await Promise.all([listReservations({ date: S.date }), listClosed(S.date)]); S.err = ""; }
    catch (e) { S.err = plainErr(e); S.rows = []; S.closed = []; }
    draw();
  };
  const goDate = (d) => { S.date = d; S.trip = ""; S.pick = []; S.found = null; load(); };

  const act = (rows, fn, okMsg) => guard(async () => { await fn(rows.map((x) => x.id)); toast(okMsg, "ok", 3500); await load(); });
  const bookingCard = (g, bus) => {
    const f = g[0], seats = g.map((x) => x.seat).sort(byNum), st = f.status;
    const ghost = bus && g.some((x) => !seatsOf(bus).includes(String(x.seat)));
    const wa = f.phone && `https://wa.me/${f.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola ${f.passenger_name.split(" ")[0]}, te escribimos de Panamericano por tu reserva ${f.code}.`)}`;
    const note = h("input", { type: "text", class: "rv__note", value: f.note || "", maxlength: 300, placeholder: "Nota (por ejemplo: pagó seña)", "aria-label": `Nota de la reserva ${f.code}` });
    note.addEventListener("change", () => guard(async () => { await Promise.all(g.map((x) => setReservationNote(x.id, note.value))); toast("Nota guardada.", "ok", 2500); }));
    return h("article", { class: `rv__card rv__card--${st}` },
      h("header", { class: "rv__head" },
        h("strong", { class: "rv__code" }, f.code), h("span", { class: `rv__st rv__st--${st}` }, STATUS[st]), f.source === "admin" && h("span", { class: "rv__tag" }, "Cargada a mano"),
        ghost && h("span", { class: "rv__tag rv__tag--bad" }, "Un asiento ya no existe en el coche")),
      h("p", { class: "rv__seats" }, `Asiento${seats.length > 1 ? "s" : ""} ${seats.join(", ")} · ${f.from_name} → ${f.to_name}`),
      h("ul", { class: "rv__people" }, ...g.sort((a, b) => byNum(a.seat, b.seat)).map((x) => h("li", {}, h("b", {}, x.passenger_name), x.passenger_doc && ` · ${x.passenger_doc}`, ` · asiento ${x.seat}`))),
      h("p", { class: "rv__contact" }, f.phone && h("a", { href: `tel:${f.phone}` }, f.phone), f.email && ` · ${f.email}`, f.fare ? ` · ${money(f.fare * g.length)}` : "", ` · pedida ${new Date(f.created_at).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ })}`),
      note,
      h("div", { class: "rv__acts" },
        st === "pendiente" && h("button", { type: "button", class: "btn btn--primary", onclick: () => act(g, (ids) => setReservationStatus(ids, "confirmada"), "Reserva confirmada.") }, "Confirmar"),
        st === "cancelada" && h("button", { type: "button", class: "btn btn--ghost", onclick: () => act(g, (ids) => setReservationStatus(ids, "pendiente"), "Reserva reabierta.") }, "Reabrir"),
        st !== "cancelada" && h("button", { type: "button", class: "btn btn--ghost", onclick: async () => { if (await confirmBox(`¿Cancelar la reserva ${f.code}? Los asientos quedan libres para otra persona.`, "Cancelar reserva", "Volver", { focusCancel: true })) act(g, (ids) => setReservationStatus(ids, "cancelada"), "Reserva cancelada. Los asientos quedaron libres."); } }, "Cancelar"),
        wa && h("a", { class: "btn btn--ghost", href: wa, target: "_blank", rel: "noopener" }, "WhatsApp"),
        h("button", { type: "button", class: "ico ico--del", "aria-label": `Borrar la reserva ${f.code} para siempre`, title: "Borrar para siempre", onclick: async () => { if (await confirmBox(`¿Borrar la reserva ${f.code} para siempre? No se puede deshacer. Si solo querés liberar los asientos, usá Cancelar.`, "Borrar", "Volver", { focusCancel: true })) act(g, (ids) => deleteReservations(ids), "Reserva borrada."); } }, icon("trash", 17))));
  };

  const seatMap = (t) => {
    const bus = busOf(t.route), rows = tripRows(t).filter((x) => x.status !== "cancelada");
    const stat = new Map(rows.map((x) => [String(x.seat), x.status]));
    const width = Math.max(1, ...bus.rows.map((r) => r.length));
    const grid = h("div", { class: "plan__grid plan__grid--live", style: `grid-template-columns:repeat(${width},minmax(34px,44px))` });
    bus.rows.forEach((row) => Array.from({ length: width }, (_, i) => row[i]).forEach((v) => {
      if (v == null || v === "") { grid.append(h("span", {})); return; }
      const n = String(v), s = stat.get(n), picked = S.pick.includes(n);
      grid.append(h("button", { type: "button", class: `plan__c is-on${s ? " is-" + s : ""}${picked ? " is-pick" : ""}`, "aria-label": s ? `Asiento ${n}: ${STATUS[s]}` : `Asiento ${n}: libre${picked ? ", elegido" : ""}`, "aria-pressed": String(picked), disabled: !!s,
        onclick: () => { S.pick = picked ? S.pick.filter((x) => x !== n) : [...S.pick, n]; draw(); } }, n));
    }));
    return h("div", { class: "plan__wrap" }, h("div", { class: "plan__front", "aria-hidden": "true" }, "Adelante"), grid,
      h("ul", { class: "plan__legend" }, h("li", {}, h("i", { class: "k k--free" }), "Libre"), h("li", {}, h("i", { class: "k k--pendiente" }), "Pendiente"), h("li", {}, h("i", { class: "k k--confirmada" }), "Confirmada"), h("li", {}, h("i", { class: "k k--pick" }), "Elegido")));
  };

  const manualForm = (t) => {
    const st = stopsOf(t.route), seats = [...S.pick].sort(byNum);
    const fromSel = h("select", { "aria-label": "Sube en" }, ...st.slice(0, -1).map((p, i) => h("option", { value: i }, p)));
    const toSel = h("select", { "aria-label": "Baja en" }, ...st.map((p, i) => (i > 0 ? h("option", { value: i, selected: i === st.length - 1 }, p) : null)));
    const names = seats.map((s) => ({ s, name: h("input", { type: "text", maxlength: 80, placeholder: "Nombre y apellido", "aria-label": `Nombre del pasajero del asiento ${s}` }), doc: h("input", { type: "text", maxlength: 20, placeholder: "DNI", inputmode: "numeric", "aria-label": `DNI del pasajero del asiento ${s}` }) }));
    const phone = h("input", { type: "tel", maxlength: 30, placeholder: "Teléfono", "aria-label": "Teléfono" });
    const note = h("input", { type: "text", maxlength: 300, placeholder: "Nota (opcional)", "aria-label": "Nota" });
    const status = h("select", { "aria-label": "Estado" }, h("option", { value: "confirmada" }, "Confirmada (ya pagó o está acordado)"), h("option", { value: "pendiente" }, "Pendiente"));
    const err = h("small", { class: "err", role: "alert" });
    const go = () => guard(async () => {
      err.textContent = "";
      const bad = names.find((x) => x.name.value.trim().length < 3); if (bad) { err.textContent = `Falta el nombre del pasajero del asiento ${bad.s}.`; bad.name.focus(); return; }
      const fi = +fromSel.value, ti = +toSel.value; if (fi >= ti) { err.textContent = "El lugar donde baja tiene que estar después de donde sube."; return; }
      try {
        const code = await addReservation({ route: t.route.id, date: S.date, time: t.time, from: fi, to: ti, fromName: st[fi], toName: st[ti], seats, people: names.map((x) => ({ name: x.name.value.trim(), doc: x.doc.value.trim() })), phone: phone.value.trim(), fare: fareBetween(t.route, fi, ti), status: status.value, note: note.value.trim() });
        S.pick = []; toast(`Reserva ${code} cargada.`, "ok", 5000); await load();
      } catch (e) {
        if (e.code !== "SEAT_TAKEN") throw e;
        toast(e.message + " Elegí otro asiento.", "err", 8000);
        await load(); // se vuelve a leer el plano y se sacan de la selección los asientos que ya no están libres
        const taken = new Set(tripRows(t).filter((x) => x.status !== "cancelada").map((x) => String(x.seat)));
        S.pick = S.pick.filter((x) => !taken.has(x)); draw();
      }
    });
    return h("section", { class: "rv__manual" },
      h("h4", {}, `Cargar una reserva a mano · asiento${seats.length > 1 ? "s" : ""} ${seats.join(", ")}`),
      h("div", { class: "grid2" }, h("label", {}, "Sube en", fromSel), h("label", {}, "Baja en", toSel)),
      ...names.map((x) => h("div", { class: "grid2" }, x.name, x.doc)),
      h("div", { class: "grid2" }, phone, status), note, err,
      h("div", { class: "rv__acts" }, h("button", { type: "button", class: "btn btn--primary", onclick: go }, "Cargar reserva"), h("button", { type: "button", class: "btn btn--ghost", onclick: () => { S.pick = []; draw(); } }, "Cancelar")));
  };

  const dateBar = () => {
    const inp = h("input", { type: "date", value: S.date, "aria-label": "Fecha del viaje" });
    inp.addEventListener("change", () => { if (inp.value) goDate(inp.value); });
    return h("div", { class: "rv__bar" },
      h("button", { type: "button", class: "btn btn--ghost", "aria-label": "Día anterior", onclick: () => goDate(addDays(S.date, -1)) }, h("span", { class: "flip" }, icon("arrow", 16))),
      inp, h("button", { type: "button", class: "btn btn--ghost", "aria-label": "Día siguiente", onclick: () => goDate(addDays(S.date, 1)) }, icon("arrow", 16)),
      S.date !== todayJ() && h("button", { type: "button", class: "btn btn--ghost", onclick: () => goDate(todayJ()) }, "Hoy"),
      h("strong", { class: "rv__day" }, fmtDay(S.date).replace(/^./, (c) => c.toUpperCase())));
  };
  const searchBox = () => {
    const inp = h("input", { type: "search", class: "svc__find", value: S.q, placeholder: "Buscar una reserva por código, nombre, teléfono o DNI", "aria-label": "Buscar una reserva" });
    const run = () => guard(async () => { S.q = inp.value; S.found = S.q.trim().length >= 2 ? await searchReservations(S.q) : null; draw(); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
    inp.addEventListener("search", run);
    return h("div", { class: "rv__search" }, inp, h("button", { type: "button", class: "btn btn--ghost", onclick: run }, icon("search", 16), "Buscar"));
  };

  function draw() {
    const kids = [h("p", { class: "rv__live" }, icon("bolt", 16), "Los cambios de esta pantalla se guardan al instante: no hace falta publicar."), searchBox()];
    if (S.found) {
      kids.push(group(`Resultados (${groupsOf(S.found).length})`, "Tocá una fecha para ver ese viaje completo.",
        S.found.length ? h("div", { class: "rv__list" }, ...groupsOf(S.found).map((g) => h("div", {}, h("button", { type: "button", class: "link", onclick: () => { S.found = null; S.q = ""; goDate(g[0].trip_date); } }, `${fmtDayShort(g[0].trip_date)} · ${g[0].trip_time} · ${g[0].from_name} → ${g[0].to_name}`), bookingCard(g, busOf(routeOf(g[0].route_id) || draft.routes[0]))))) : h("p", { class: "empty" }, "No se encontró ninguna reserva con eso.")));
      root.replaceChildren(...kids); return;
    }
    kids.push(dateBar());
    if (S.err) { kids.push(h("p", { class: "book__err rv__err", role: "alert" }, S.err + " ", h("button", { type: "button", class: "link", onclick: load }, "Reintentar"))); root.replaceChildren(...kids); return; }
    const list = trips(); const t = list.find((x) => x.key === S.trip) || null;
    const totalLive = new Set(liveRows(S.rows).map((x) => x.code)).size, pend = new Set(S.rows.filter((x) => x.status === "pendiente").map((x) => x.code)).size;
    kids.push(h("p", { class: "rv__sum" }, `${totalLive} ${totalLive === 1 ? "reserva" : "reservas"} para este día`, pend ? ` · ${pend} por confirmar` : ""));
    // por defecto solo las salidas que ya tienen reservas (hay decenas por día); "Ver todas" muestra el resto
    const withRows = list.filter((x) => tripRows(x).length || x.key === S.trip);
    const shown = S.all ? list : withRows;
    kids.push(h("div", { class: "rv__trips" }, ...(shown.length ? shown.map((x) => {
      const rows = liveRows(tripRows(x)), bus = busOf(x.route), closed = S.closed.some((c) => c.route_id === x.route.id && (!c.trip_time || c.trip_time === x.time));
      const pendin = rows.some((r) => r.status === "pendiente");
      return h("button", { type: "button", class: "rv__trip" + (x.key === S.trip ? " is-on" : "") + (closed ? " is-closed" : ""), "aria-pressed": String(x.key === S.trip), onclick: () => { S.trip = x.key; S.pick = []; draw(); } },
        h("b", {}, x.time), h("span", {}, label(x.route)), h("small", {}, `${rows.length}/${countSeats(bus)} asientos${closed ? " · cerrada" : ""}${pendin ? " · por confirmar" : ""}`));
    }) : [h("p", { class: "empty" }, list.length ? "Todavía no hay reservas para este día." : "Ese día no hay salidas en los horarios.")])));
    if (list.length > withRows.length || S.all) kids.push(h("button", { type: "button", class: "btn btn--ghost rv__more", onclick: () => { S.all = !S.all; draw(); } }, S.all ? "Ver solo las salidas con reservas" : `Ver todas las salidas del día (${list.length}) · para cargar una reserva a mano`));
    if (t) {
      const bus = busOf(t.route), rows = tripRows(t), cl = S.closed.find((c) => c.route_id === t.route.id && (!c.trip_time || c.trip_time === t.time));
      kids.push(group(`${t.time} · ${label(t.route)}`, `${bus.name || "Coche"} · ${countSeats(bus)} asientos`,
        h("div", { class: "rv__tripbar" },
          cl ? h("button", { type: "button", class: "btn btn--ghost", onclick: () => guard(async () => { await openTrip(cl.id); toast("Salida reabierta: se puede volver a reservar.", "ok", 4000); await load(); }) }, "Reabrir la salida") : h("button", { type: "button", class: "btn btn--ghost", onclick: async () => { if (await confirmBox(`¿Cerrar la salida de las ${t.time} del ${fmtDayShort(S.date)}? La web no va a dejar reservarla. Las reservas que ya tiene se mantienen.`, "Cerrar salida", "Volver", { focusCancel: true })) guard(async () => { await closeTrip({ route: t.route.id, date: S.date, time: t.time, reason: "" }); toast("Salida cerrada.", "ok", 4000); await load(); }); } }, "Cerrar esta salida"),
          cl && h("span", { class: "rv__tag rv__tag--bad" }, "Cerrada: no se puede reservar por la web")),
        h("div", { class: "rv__split" }, h("div", {}, seatMap(t), S.pick.length ? manualForm(t) : h("p", { class: "hint" }, "Para cargar una reserva a mano (por teléfono o en boletería) tocá los asientos libres.")),
          h("div", { class: "rv__list" }, rows.length ? groupsOf(rows).map((g) => bookingCard(g, bus)) : [h("p", { class: "empty" }, "Todavía no hay reservas para esta salida.")]))));
    }
    root.replaceChildren(...kids);
  }
  draw(); load();
  return root;
}
