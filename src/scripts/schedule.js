import { ROUTES, ORIGINS, destinationsFor, search, short, TZ, esc } from "./data.js";

const $ = (s) => document.querySelector(s);
const norm = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
const WD = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

const parts = () => {
  const p = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(new Date());
  return {
    min: (+p.find((x) => x.type === "hour").value % 24) * 60 + +p.find((x) => x.type === "minute").value,
    wd: Math.max(0, WD.indexOf(norm(p.find((x) => x.type === "weekday").value.toLowerCase().replace(".", "")))),
  };
};
export const nowInJujuy = () => parts().min;

const toMin = (t) => { const [h, m] = t.split(":"); return +h * 60 + +m; };
const fmtClock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fmtEta = (d) => (d <= 0 ? "ahora" : d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ""}`);
const slotLabel = (x) => x.days || (x.service === "Ruta 9" ? "" : x.service);
const daysOk = (days, wd) => {
  if (!days) return true;
  const t = norm(days.toLowerCase());
  if (t.includes("domingo")) return wd === 0;
  return t.split(/[·,\s]+/).filter(Boolean).some((x) => WD[wd].startsWith(x.slice(0, 3)));
};

export const state = { origin: ORIGINS[0], dest: "Tilcara" };

export function fillSelect(sel, items, value) {
  sel.innerHTML = items.map((i) => `<option value="${esc(i)}">${esc(short(i))}</option>`).join("");
  if (items.includes(value)) sel.value = value;
}

export function setRoute(origin, dest) {
  state.origin = origin;
  const ds = destinationsFor(origin);
  state.dest = ds.includes(dest) ? dest : ds[0];
  render(true);
}

/* ---------- Tablero de salidas ---------- */
let prevTimes = [];
function renderBoard(animate) {
  const { min, wd } = parts();
  $("#board-clock").textContent = fmtClock(min);

  const rows = [];
  ROUTES.filter((r) => r.from === state.origin).forEach((r) =>
    r.times.forEach((t) => {
      const delta = toMin(t) - min;
      const day = delta < 0 ? (wd + 1) % 7 : wd;
      if (!daysOk(r.days?.[t], day)) return;
      rows.push({ time: t, tomorrow: delta < 0, delta: delta < 0 ? delta + 1440 : delta, to: r.to, via: r.via, days: r.days?.[t], dest: r.stops[r.stops.length - 1] });
    })
  );
  rows.sort((a, b) => a.delta - b.delta);
  const list = rows.slice(0, 6);

  $("#board-rows").innerHTML = list.map((x, i) => {
    const changed = animate || prevTimes[i] !== x.time;
    const digits = x.time.split("").map((c, k) => `<span class="d${changed ? " flip" : ""}" style="--k:${k + i * 2}">${c}</span>`).join("");
    return `<li><button type="button" class="brow${i === 0 ? " is-first" : ""}" data-book="${x.time}" data-dest="${esc(x.dest)}" aria-label="Reservar salida de las ${x.time} hacia ${esc(x.to)}">
      <span class="brow__time">${digits}</span>
      <span class="brow__to"><b>${esc(x.to)}</b><small>${esc([x.via, x.days].filter(Boolean).join(" · "))}</small></span>
      <span class="brow__eta">${i === 0 && x.delta <= 1 ? "Saliendo" : "En " + fmtEta(x.delta)}${x.tomorrow ? " · mañana" : ""}</span>
      <span class="brow__go" aria-hidden="true">Reservar</span>
    </button></li>`;
  }).join("") || `<li class="empty">No hay salidas cargadas desde este origen.</li>`;
  prevTimes = list.map((x) => x.time);

  $("#board-note").textContent = list.some((x) => x.to.endsWith("*"))
    ? "* Algunas salidas continúan hasta La Quiaca: confirmalo en boletería. Horarios relevados en jul-2026; pueden variar en feriados y Carnaval."
    : "Horarios relevados en jul-2026; pueden variar en feriados y Carnaval.";
}

/* ---------- Todas las salidas hacia un destino ---------- */
function renderPicker() {
  const { origin, dest } = state;
  $("#s-origins").innerHTML = ORIGINS.map((o) => `<button type="button" aria-pressed="${o === origin}" data-o="${esc(o)}">${esc(short(o))}</button>`).join("");
  $("#s-dests").innerHTML = destinationsFor(origin).map((d) => `<button type="button" aria-pressed="${d === dest}" data-d="${esc(d)}">${esc(d)}</button>`).join("");

  const list = search(origin, dest);
  const now = nowInJujuy();
  const next = list.find((x) => toMin(x.time) >= now) || list[0];
  $("#s-grid").innerHTML = list.map((x) => {
    const past = toMin(x.time) < now && next && toMin(next.time) >= now;
    return `<button type="button" class="slot${past ? " is-past" : ""}${x === next ? " is-next" : ""}" data-book="${x.time}" aria-label="Reservar salida de las ${x.time}">
      <b>${x.time}</b><small>${esc(slotLabel(x))}</small></button>`;
  }).join("") || `<p class="empty">No hay servicios cargados para este tramo.</p>`;
  $("#s-count").textContent = list.length ? `${short(origin)} → ${dest} · ${list.length} salidas por día` : "";
  const notes = [...new Set(list.map((x) => x.note))];
  $("#s-note").textContent = notes.join(" ");
}

function render(animate = false) { renderPicker(); renderBoard(animate); }

export function initSchedule({ onBook }) {
  $("#s-origins").addEventListener("click", (e) => { const b = e.target.closest("[data-o]"); if (b) setRoute(b.dataset.o, state.dest); });
  $("#s-dests").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b) { state.dest = b.dataset.d; renderPicker(); } });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-book]");
    if (!b || !b.closest("#horarios")) return;
    const fromBoard = b.classList.contains("brow");
    onBook({ origin: state.origin, dest: fromBoard ? b.dataset.dest : state.dest, time: b.dataset.book });
  });
  render(true);
  setInterval(() => renderBoard(false), 15000);
}
