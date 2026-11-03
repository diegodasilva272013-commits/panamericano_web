// Límites y tolerancias de la flota: velocidad, atrasos, falta de señal, radio de las paradas y cuánto historial se guarda.
import { h, icon, input, put } from "../kit.js";
import { toast, plainErr } from "../../admin/ui.js";
import { pageHead } from "../views-ops.js";
import { fleet } from "./store.js";
import { save } from "./data.js";
import { DEFAULTS } from "./status.js";
import { showError } from "./view-live.js";

const FIELDS = [
  { k: "speedLimit", label: "Límite de velocidad general (km/h)", min: 30, max: 160, step: 5, hint: "Si un coche pasa de esta velocidad se genera una alerta. Una zona con su propio límite (en Geocercas) manda sobre éste." },
  { k: "speedGraceS", label: "Segundos por encima del límite antes de avisar", min: 0, max: 120, step: 5, hint: "Evita alertas por un pico de un instante." },
  { k: "delayTolMin", label: "Atraso que se tolera (minutos)", min: 0, max: 120, step: 1, hint: "Se avisa cuando un coche sale o llega con más atraso que esto." },
  { k: "noSignalMin", label: "Minutos sin datos para avisar «sin señal»", min: 2, max: 240, step: 1, hint: "Solo se avisa de un coche en servicio (con motor encendido o en viaje)." },
  { k: "idleStopMin", label: "Minutos detenido fuera de una parada para avisar", min: 3, max: 240, step: 1, hint: "Solo durante un viaje en curso." },
  { k: "stopRadiusM", label: "Radio de una parada nueva (metros)", min: 30, max: 1000, step: 10, hint: "Es el radio que se propone al dibujar una parada; cada una se puede cambiar." },
  { k: "lowVoltage", label: "Batería baja del vehículo (voltios)", min: 8, max: 13, step: 0.1, hint: "Por debajo de este valor, con el motor encendido, se avisa." },
  { k: "retentionDays", label: "Días que se guarda el detalle de las posiciones", min: 7, max: 365, step: 1, hint: "Pasado ese tiempo se borra el detalle punto por punto. Los viajes, paradas, alertas y eventos se conservan siempre." },
];

export function ajustesFlota(ctx) {
  const page = h("div", { class: "page" }, h("p", { class: "boot" }, "Cargando…"));
  fleet.ensure().then((F) => mount(page, ctx, F)).catch((e) => showError(page, e, () => ctx.redraw()));
  return page;
}

function mount(page, ctx, F) {
  const inputs = {};
  const fields = FIELDS.map((d) => { const f = input({ label: d.label, type: "number", value: F.settings[d.k] ?? DEFAULTS[d.k], min: d.min, maxv: d.max, step: d.step, inputmode: "decimal", hint: d.hint }); inputs[d.k] = f; return f.el; });
  let busy = false;
  const sv = h("button", { type: "submit", class: "btn" }, "Guardar los cambios");
  const submit = async (e) => {
    e.preventDefault(); if (busy) return;
    const data = { ...F.settings };
    for (const d of FIELDS) {
      const f = inputs[d.k]; f.error("");
      const v = Number(String(f.get()).replace(",", "."));
      if (!Number.isFinite(v) || v < d.min || v > d.max) return f.error(`Poné un valor entre ${d.min} y ${d.max}.`);
      data[d.k] = d.step < 1 ? Math.round(v * 10) / 10 : Math.round(v);
    }
    busy = true; sv.disabled = true;
    try { await save.settings(data); await fleet.reload(); toast("Ajustes guardados. El receptor los toma en menos de un minuto.", "ok", 5000); }
    catch (x) { toast(plainErr(x), "err", 9000); }
    busy = false; sv.disabled = false;
  };
  put(page, pageHead("Límites y tolerancias", "Cuándo la flota genera una alerta y cuánto historial se guarda."),
    h("section", { class: "panel" }, h("form", { class: "payform payform--flat set__form", onsubmit: submit, novalidate: true }, h("div", { class: "grid2" }, fields), h("div", { class: "payform__act" }, h("button", { type: "button", class: "btn btn--ghost", onclick: () => { for (const d of FIELDS) inputs[d.k].set(DEFAULTS[d.k]); } }, "Volver a los valores iniciales"), sv))));
}
