// Alertas de la flota: exceso de velocidad, sentido contrario, parada omitida, atraso, sin señal, zona prohibida, batería, detenido.
import { h, icon, chip, kpi, table, input, put } from "../kit.js";
import { toast, plainErr } from "../../admin/ui.js";
import { pageHead } from "../views-ops.js";
import { fleet } from "./store.js";
import { fetchAlertsRange, ackAlert } from "./data.js";
import { showError } from "./view-live.js";
import { ALERTS, SEVERITY, fmtWhen, dur, jujuyDay, dayStart, dayEnd } from "./status.js";

const PERIODS = { hoy: "Hoy", sem: "Últimos 7 días", mes: "Últimos 30 días" };
const AS = { state: "open", kind: "", vehicle: "", period: "sem", sev: "" };

export function alertas(ctx, pre = {}) {
  Object.assign(AS, pre);
  const page = h("div", { class: "page" }, h("p", { class: "boot" }, "Cargando las alertas…"));
  fleet.ensure().then((F) => mount(page, ctx, F)).catch((e) => showError(page, e, () => ctx.redraw()));
  return page;
}

function mount(page, ctx, F0) {
  const F = F0; let rows = [], loadSeq = 0;
  const state = input({ label: "Estado", options: [["open", "Sin atender"], ["done", "Atendidas"], ["", "Todas"]], value: AS.state });
  const sev = input({ label: "Gravedad", options: [["", "Todas"], ...Object.entries(SEVERITY).map(([k, v]) => [k, v.label])], value: AS.sev });
  const kind = input({ label: "Tipo", options: [["", "Todos"], ...Object.entries(ALERTS).map(([k, v]) => [k, v.label])], value: AS.kind });
  const veh = input({ label: "Coche", options: [["", "Todos"], ...F.vehicles.map((v) => [v.id, v.code])], value: AS.vehicle });
  const period = input({ label: "Período", options: Object.entries(PERIODS), value: AS.period });
  const kp = h("div", { class: "kpis kpis--sm" }), body = h("div"), foot = h("p", { class: "hint" });

  async function load(quiet = false) {
    const seq = ++loadSeq, today = jujuyDay();
    const from = AS.period === "hoy" ? dayStart(today) : new Date(Date.now() - (AS.period === "mes" ? 30 : 7) * 864e5).toISOString();
    if (!quiet) put(body, h("p", { class: "boot" }, "Cargando…"));
    try { const r = await fetchAlertsRange(from, dayEnd(today)); if (seq !== loadSeq) return; rows = r; draw(); }
    catch (e) { if (seq === loadSeq && !quiet) put(body, h("p", { class: "err", role: "alert" }, plainErr(e))); }
  }

  const keep = (a) => (!AS.state || (AS.state === "open" ? !a.ack_at : !!a.ack_at)) && (!AS.kind || a.kind === AS.kind) && (!AS.vehicle || a.vehicle_id === AS.vehicle) && (!AS.sev || a.severity === AS.sev);

  function draw() {
    const shown = rows.filter(keep);
    const open = rows.filter((a) => !a.ack_at);
    put(kp, kpi({ label: "Sin atender", value: open.length, tone: open.length ? "warn" : "ok", sub: open.length ? "esperan que alguien las revise" : "todo al día" }),
      kpi({ label: "Críticas sin atender", value: open.filter((a) => a.severity === "critica").length, tone: open.some((a) => a.severity === "critica") ? "bad" : "" }),
      kpi({ label: "En el período", value: rows.length, sub: PERIODS[AS.period].toLowerCase() }));
    put(body, table({
      label: "Alertas de la flota", rows: shown, empty: AS.state === "open" ? "No hay alertas sin atender." : "No hay alertas con esos filtros.",
      cols: [
        { h: "Gravedad", c: (a) => chip(SEVERITY[a.severity]?.label || a.severity, SEVERITY[a.severity]?.tone) },
        { h: "Cuándo", c: (a) => fmtWhen(a.started_at), cls: "nowrap" },
        { h: "Coche", c: (a) => h("b", {}, F.vehicleById.get(a.vehicle_id)?.code || "—") },
        { h: "Alerta", c: (a) => h("span", { class: "al" }, icon(ALERTS[a.kind]?.icon || "alert", 16), h("span", {}, a.title, a.detail ? h("small", { class: "block sub" }, a.detail) : null)) },
        { h: "Duración", c: (a) => (a.ended_at ? dur((Date.parse(a.ended_at) - Date.parse(a.started_at)) / 1000) : chip("en curso", "warn")), num: true },
        { h: "Estado", c: (a) => (a.ack_at ? chip("Atendida", "ok") : chip("Sin atender", "bad")) },
        { h: "", c: (a) => h("span", { class: "chips" },
          h("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: (e) => { e.stopPropagation(); ctx.go("mapa", { vehicle: a.vehicle_id }); } }, "Ver coche"),
          a.ack_at ? null : h("button", { type: "button", class: "btn btn--sm", onclick: async (e) => { e.stopPropagation(); e.currentTarget.disabled = true; try { await ackAlert(a.id); a.ack_at = new Date().toISOString(); fleet.patchAlert(a.id, { ack_at: a.ack_at }); draw(); toast("Alerta atendida.", "ok", 1800); } catch (x) { toast(plainErr(x), "err", 6000); e.currentTarget.disabled = false; } } }, "Atendida")) },
      ],
    }));
    foot.textContent = shown.length ? `${shown.length} ${shown.length === 1 ? "alerta" : "alertas"}` : "";
  }

  const bind = (f, k) => f.input.addEventListener("change", () => { AS[k] = f.get(); k === "period" ? load() : draw(); });
  bind(state, "state"); bind(sev, "sev"); bind(kind, "kind"); bind(veh, "vehicle"); bind(period, "period");
  put(page, pageHead("Alertas", "Lo que el sistema detecta solo: velocidad, sentido, paradas, atrasos, falta de señal y zonas prohibidas.",
    h("button", { class: "btn btn--ghost", type: "button", onclick: () => ctx.go("ajustes-flota", {}) }, icon("ajustes", 18), "Límites y tolerancias")),
    kp, h("section", { class: "panel" }, h("div", { class: "filters" }, state.el, sev.el, kind.el, veh.el, period.el), body, foot));
  // se actualiza sola cada tanto (y al volver a la pestaña) para ver las alertas nuevas
  const timer = setInterval(() => { if (!document.hidden && !document.querySelector(".drawer, .modal") && !/^(SELECT|INPUT)$/.test(document.activeElement?.tagName || "")) load(true); }, 20_000);
  ctx.cleanup(() => clearInterval(timer));
  load();
}
