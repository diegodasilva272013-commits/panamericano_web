import { uploadImage } from "./api.js";

// ---------- DOM ----------
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

// ---------- iconos (un solo trazo, mismo grosor) ----------
const ICONS = {
  hero: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 9.5v5l4-2.5z"/>',
  textos: '<path d="M5 7V5.5h14V7M12 5.5v13M9 18.5h6"/>',
  horarios: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  destinos: '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0c0 5.4 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  galeria: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3"/>',
  abordo: '<rect x="4" y="4" width="16" height="13.5" rx="3"/><path d="M4 11h16M8 20.5v-3M16 20.5v-3"/>',
  contacto: '<path d="M6.5 4h3L11 8l-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"/>',
  preguntas: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.1.9-1.1 1.7M12 16.6v.1"/>',
  historial: '<path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5M4 4v4.5h4.5M12 8v4.2l2.8 1.6"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  down: '<path d="M12 5v14m-6-6 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  external: '<path d="M8 16 16 8M9 8h7v7"/>',
  logout: '<path d="M14 5h4a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 19h-4M10 8l-4 4 4 4M6 12h10"/>',
};
export const icon = (name, size = 20) =>
  h("span", { class: "i", "aria-hidden": "true", html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>` });

// ---------- avisos ----------
let toastBox;
export function toast(msg, kind = "ok", ms = 4200) {
  if (!toastBox) { toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(toastBox); }
  const t = h("div", { class: `toast toast--${kind}` }, msg);
  toastBox.append(t);
  setTimeout(() => { t.classList.add("is-out"); setTimeout(() => t.remove(), 300); }, ms);
}
export function confirmBox(msg, okLabel = "Aceptar") {
  return new Promise((res) => {
    const done = (v) => { ov.remove(); res(v); };
    const ov = h("div", { class: "modal" },
      h("div", { class: "modal__box", role: "dialog", "aria-modal": "true" },
        h("p", {}, msg),
        h("div", { class: "modal__act" },
          h("button", { class: "btn btn--ghost", type: "button", onclick: () => done(false) }, "Cancelar"),
          h("button", { class: "btn", type: "button", onclick: () => done(true) }, okLabel))));
    document.body.append(ov); ov.querySelector(".btn:last-child").focus();
  });
}

// ---------- campos ----------
let uid = 0;
export function field({ label, hint, value, onInput, long, type = "text", placeholder, rows = 3, mono, error, list }) {
  const id = `f${++uid}`;
  const input = long
    ? h("textarea", { id, rows, placeholder, class: mono ? "mono" : "" }, value ?? "")
    : h("input", { id, type, placeholder, list, value: value ?? "", class: mono ? "mono" : "" });
  input.addEventListener("input", () => onInput(input.value, input));
  return h("div", { class: "field" + (error ? " is-bad" : "") },
    h("label", { for: id }, label),
    input,
    hint && h("small", { class: "hint" }, hint),
    error && h("small", { class: "err" }, error));
}
export function check({ label, value, onChange }) {
  const input = h("input", { type: "checkbox" }); input.checked = !!value;
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "check" }, input, h("span", {}, label));
}
export function group(title, desc, ...kids) {
  return h("section", { class: "card" },
    h("header", { class: "card__head" }, h("h3", {}, title), desc && h("p", {}, desc)),
    h("div", { class: "card__body" }, ...kids));
}
export const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");

// ---------- lista editable (subir, bajar, quitar, agregar) ----------
export function listEditor({ items, render, onChange, addLabel = "Agregar", make, min = 0, max = 99, title, empty = "Todavía no hay nada.", extra }) {
  const box = h("div", { class: "list" });
  const draw = () => {
    box.replaceChildren();
    if (!items.length) box.append(h("p", { class: "empty" }, empty));
    items.forEach((it, i) => {
      const move = (d) => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; onChange(); draw(); };
      box.append(h("div", { class: "item" },
        h("div", { class: "item__bar" },
          h("strong", {}, title ? title(it, i) : `#${i + 1}`),
          h("span", { class: "item__btns" },
            h("button", { type: "button", class: "ico", title: "Subir", "aria-label": "Subir", disabled: i === 0, onclick: () => move(-1) }, icon("up", 17)),
            h("button", { type: "button", class: "ico", title: "Bajar", "aria-label": "Bajar", disabled: i === items.length - 1, onclick: () => move(1) }, icon("down", 17)),
            h("button", { type: "button", class: "ico ico--del", title: "Quitar", "aria-label": "Quitar", disabled: items.length <= min,
              onclick: async () => { if (await confirmBox("¿Quitar este elemento?", "Quitar")) { items.splice(i, 1); onChange(); draw(); } } }, icon("x", 17)))),
        render(it, i, draw)));
    });
    if (items.length < max) box.append(h("div", { class: "list__add" },
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => { items.push(make()); onChange(); draw(); box.lastElementChild.previousElementSibling?.querySelector("input,textarea")?.focus(); } }, icon("plus", 17), addLabel),
      extra));
  };
  draw();
  return box;
}

// ---------- imagen: elegir, achicar, convertir y subir ----------
export function imageField({ label, url, onChange, maxWidth = 1600, hint }) {
  const img = h("img", { alt: "", class: "imgf__img" });
  const info = h("small", { class: "hint" }, hint || "");
  const set = (u) => { img.src = u || ""; img.hidden = !u; };
  set(url);
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files[0]; if (!f) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = "Subiendo…";
    try {
      const r = await uploadImage(f, { maxWidth });
      set(r.url); onChange(r.url);
      info.textContent = `Listo · se optimizó de ${kb(r.before)} a ${kb(r.after)} (${r.width}×${r.height}).`;
    } catch (e) { toast(e.message, "err", 7000); }
    finally { btn.disabled = false; btn.textContent = old; file.value = ""; }
  });
  const btn = h("button", { type: "button", class: "btn btn--ghost", onclick: () => file.click() }, url ? "Cambiar imagen" : "Elegir imagen");
  return h("div", { class: "imgf" }, label && h("span", { class: "imgf__label" }, label), h("div", { class: "imgf__row" }, img, h("div", {}, btn, file, info)));
}
