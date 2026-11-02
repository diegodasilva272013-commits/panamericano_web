import { h, icon } from "../admin/ui.js";
import { money, fmtMonthShort } from "./model.js";

export { h, icon };

export const chip = (text, tone = "") => h("span", { class: "chip" + (tone ? " chip--" + tone : "") }, text);
export const STATUS_TONE = { pendiente: "warn", confirmada: "ok", cancelada: "off" };
export const PAY_TONE = { sin_cobrar: "bad", parcial: "warn", pagada: "ok", de_mas: "warn", a_devolver: "bad", sin_tarifa: "off", sin_movimiento: "off" };

export function kpi({ label, value, sub, tone, go }) {
  const body = [h("span", { class: "kpi__l" }, label), h("strong", { class: "kpi__v" }, value), sub != null && h("span", { class: "kpi__s" }, sub)];
  return go ? h("button", { type: "button", class: "kpi kpi--link" + (tone ? " kpi--" + tone : ""), onclick: go }, ...body) : h("div", { class: "kpi" + (tone ? " kpi--" + tone : "") }, ...body);
}

// Tabla que en el celular se vuelve una lista de tarjetas (cada celda lleva su rótulo).
// cols: [{ h: "Título", c: (fila) => nodo|texto, num?: true, cls? }]
export function table({ cols, rows, onRow, empty = "No hay nada para mostrar.", label }) {
  if (!rows.length) return h("p", { class: "empty" }, empty);
  const head = h("tr", {}, cols.map((c) => h("th", { scope: "col", class: c.num ? "num" : "" }, c.h)));
  const body = rows.map((r) => {
    const tr = h("tr", onRow ? { class: "is-click", tabindex: "0", role: "button", onclick: () => onRow(r), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRow(r); } } } : {},
      cols.map((c) => h("td", { "data-l": c.h, class: (c.num ? "num " : "") + (c.cls || "") }, c.c(r))));
    return tr;
  });
  return h("div", { class: "tbl" }, h("table", { "aria-label": label || null }, h("thead", {}, head), h("tbody", {}, body)));
}

// panel que entra por la derecha (en el celular ocupa toda la pantalla). Devuelve { el, body, close }.
export function drawer({ title, sub, body, foot, onClose }) {
  const back = document.activeElement;
  const done = () => { document.removeEventListener("keydown", key, true); ov.remove(); document.body.classList.remove("no-scroll"); back?.focus?.(); onClose?.(); };
  const key = (e) => {
    if (document.querySelector(".modal")) return; // si hay un cuadro de confirmación abierto, Esc es para él
    if (e.key === "Escape") { e.preventDefault(); done(); }
    else if (e.key === "Tab") {
      const f = [...panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]; if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  const bodyEl = h("div", { class: "drawer__body" }, body);
  const footEl = h("div", { class: "drawer__foot" }, foot);
  const panel = h("aside", { class: "drawer__panel", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("header", { class: "drawer__head" }, h("div", {}, h("h2", {}, title), sub && h("p", {}, sub)),
      h("button", { type: "button", class: "ico", "aria-label": "Cerrar", onclick: done }, icon("x", 22))),
    bodyEl, footEl);
  const ov = h("div", { class: "drawer", onclick: (e) => { if (e.target === ov) done(); } }, panel);
  document.addEventListener("keydown", key, true); document.body.append(ov); document.body.classList.add("no-scroll");
  panel.querySelector(".ico").focus();
  return { el: ov, close: done, body: bodyEl, foot: footEl, panel };
}

// campo simple con etiqueta. opts: { label, type, value, options: [[valor, texto]], required, min, step, placeholder, hint, list }
export function input(o) {
  const id = "f" + Math.random().toString(36).slice(2, 8);
  let el;
  if (o.options) el = h("select", { id }, o.options.map(([v, t]) => h("option", { value: v, selected: String(v) === String(o.value ?? "") ? true : null }, t)));
  else if (o.long) el = h("textarea", { id, rows: o.rows || 2, placeholder: o.placeholder || null, maxlength: o.max || 300 }, o.value ?? "");
  else el = h("input", { id, type: o.type || "text", value: o.value ?? "", min: o.min ?? null, max: o.maxv ?? null, step: o.step ?? null, placeholder: o.placeholder || null, inputmode: o.inputmode || null, autocomplete: "off", list: o.list || null, maxlength: o.max || null });
  if (o.required) el.required = true;
  const err = h("small", { class: "ferr", role: "alert" });
  const wrap = h("div", { class: "field" + (o.cls ? " " + o.cls : "") }, h("label", { for: id }, o.label), el, o.hint && h("small", { class: "hint" }, o.hint), err);
  return { el: wrap, input: el, get: () => el.value, set: (v) => { el.value = v; }, error: (m) => { err.textContent = m || ""; el.setAttribute("aria-invalid", m ? "true" : "false"); } };
}

export function download(name, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// reemplaza el contenido de un elemento ignorando huecos (null / false), que de otro modo se escribirían como la palabra "null"
export const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

// barras de cobrado y gastos por mes, hechas con HTML (el texto no se deforma al cambiar de tamaño). series: [{ month, in, out }]
export function barChart(series) {
  const max = Math.max(1, ...series.flatMap((s) => [s.in, s.out]));
  const hh = (v) => (v > 0 ? `${Math.max(2, (v / max) * 100)}%` : "0");
  const bars = h("div", { class: "bars", style: `min-width:${series.length * 56}px`, role: "img", "aria-label": "Cobrado y gastos por mes: " + series.map((s) => `${fmtMonthShort(s.month)}, cobrado ${money(s.in)}, gastos ${money(s.out)}`).join("; ") },
    series.map((s) => h("div", { class: "bars__col", title: `${fmtMonthShort(s.month)}: cobrado ${money(s.in)} · gastos ${money(s.out)}` },
      h("div", { class: "bars__pair" }, h("i", { class: "bars__in", style: `height:${hh(s.in)}` }), h("i", { class: "bars__out", style: `height:${hh(s.out)}` })),
      h("span", { class: "bars__l" }, fmtMonthShort(s.month)),
      h("span", { class: "bars__v" + (s.in - s.out < 0 ? " neg" : "") }, s.in || s.out ? money(s.in - s.out) : ""))));
  return h("div", { class: "chart" }, bars);
}
