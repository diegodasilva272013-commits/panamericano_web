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

// los errores de red se explican en llano (nunca "TypeError: Failed to fetch")
export const plainErr = (e) => (/fetch|network|conexi|tard|abort|load failed|offline/i.test(String(e?.message || e)) ? "No hay conexión con la base de datos. Revisá tu internet y probá de nuevo." : /row-level security|permission denied|42501/i.test(String(e?.message || e)) ? "Tu cuenta no tiene permiso para guardar. Pedile acceso a quien administra la web." : /jwt|session|expired/i.test(String(e?.message || e)) ? "Tu sesión venció. Volvé a entrar: tus cambios quedan guardados en este navegador." : /rate limit|too many/i.test(String(e?.message || e)) ? "Hiciste muchos intentos seguidos. Esperá unos minutos y probá de nuevo." : /not confirmed/i.test(String(e?.message || e)) ? "Esa cuenta todavía no confirmó su email." : String(e?.message || e));

// ---------- iconos (un solo trazo, mismo grosor) ----------
const ICONS = {
  hero: '<rect x="5" y="3.5" width="14" height="14" rx="3.5"/><path d="M5 11h14M9 7h6"/><path d="M8.5 14.5h.01M15.5 14.5h.01M7.5 17.5v2.5M16.5 17.5v2.5"/>',
  textos: '<path d="M5 7V5.5h14V7M12 5.5v13M9 18.5h6"/>',
  horarios: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8.2 6H13a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h4.8"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5M20 9h-9a6 6 0 0 0 0 12h3"/>',
  destinos: '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0c0 5.4 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  galeria: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3"/>',
  abordo: '<rect x="4" y="4" width="16" height="13.5" rx="3"/><path d="M4 11h16M8 20.5v-3M16 20.5v-3"/>',
  contacto: '<path d="M6.5 4h3L11 8l-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"/>',
  preguntas: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.1.9-1.1 1.7M12 16.6v.1"/>',
  resumen: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><path d="M13 16.5h7M16.5 13v7"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13A2.5 2.5 0 0 0 6.5 15.5h2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4.5 21 19H3L12 4.5zM12 10v4M12 16.5v.1"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
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
// los avisos viven siempre en la página: un lector de pantalla anuncia también el primero
let toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(toastBox);
// main.js registra acá el deshacer global, para que los avisos "Deshacer" usen el mismo historial
export const hooks = {};
// Avisa con "Deshacer" y solo deshace si NADA más cambió después (si no, explica y no toca nada)
export function undoToast(msg, mutate) {
  hooks.flush?.();
  const at = hooks.pos ? hooks.pos() : -1;
  mutate();
  toast(msg, "ok", 8000, { label: "Deshacer", run: () => {
    hooks.flush?.();
    if (hooks.pos && hooks.pos() === at + 1) hooks.undo(); else toast("Después de eso hiciste otros cambios. Usá la flecha de arriba para ir paso a paso.", "ok", 6000);
  } });
}
// action: { label, run } agrega un botón (por ejemplo "Deshacer")
export function toast(msg, kind = "ok", ms = 3200, action) {
  if (!toastBox) { toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(toastBox); }
  toastBox.querySelectorAll(".toast").forEach((o) => o.remove()); // un solo aviso a la vez: el nuevo reemplaza al anterior
  const close = () => { t.classList.add("is-out"); setTimeout(() => t.remove(), 300); };
  const t = h("div", { class: `toast toast--${kind}`, title: "Tocá para cerrar", onclick: () => close() }, h("span", {}, msg),
    action && h("button", { type: "button", class: "toast__act", onclick: (e) => { e.stopPropagation(); action.run(); close(); } }, icon(action.icon || "undo", 15), action.label));
  toastBox.append(t);
  setTimeout(close, action ? Math.max(ms, 8000) : ms);
}
export function confirmBox(msg, okLabel = "Aceptar", cancelLabel = "Cancelar") {
  return new Promise((res) => {
    const back = document.activeElement;
    const done = (v) => { document.removeEventListener("keydown", key, true); ov.remove(); back?.focus?.(); res(v); };
    // Esc cierra; Tab queda dentro del cuadro
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      else if (e.key === "Tab") {
        const f = [...ov.querySelectorAll("button, [href], input")]; if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    const cancel = cancelLabel === false ? null : h("button", { class: "btn btn--ghost", type: "button", onclick: () => done(false) }, cancelLabel);
    const ov = h("div", { class: "modal", onclick: (e) => { if (e.target === ov) done(false); } },
      h("div", { class: "modal__box", role: "dialog", "aria-modal": "true", "aria-label": typeof msg === "string" ? msg : (msg.querySelector?.("h3,strong")?.textContent || "Aviso") },
        h("div", { class: "stripe", "aria-hidden": "true" }),
        h("div", { class: "modal__msg" }, msg),
        h("div", { class: "modal__act" }, cancel, h("button", { class: "btn", type: "button", onclick: () => done(true) }, okLabel))));
    document.addEventListener("keydown", key, true);
    document.body.append(ov); ov.querySelector(".btn:last-child").focus();
  });
}

// ---------- campos ----------
let uid = 0;
// validate(valor) -> texto del problema o "": se muestra al salir del campo, no recién al publicar
// help: explicación corta que se abre con un "?" junto a la etiqueta (para los campos que no se entienden solos)
export function field({ label, hint, help, value, onInput, long, type = "text", placeholder, rows = 3, mono, error, list, validate, soft }) {
  const id = `f${++uid}`;
  const input = long
    ? h("textarea", { id, rows, placeholder, class: mono ? "mono" : "" }, value ?? "")
    : h("input", { id, type, placeholder, list, value: value ?? "", class: mono ? "mono" : "" });
  const err = h("small", { class: "err", role: "alert", id: id + "-e" }, error || "");
  const note = help ? h("small", { class: "fhelp", hidden: true, id: id + "-n" }, help) : null;
  const q = help ? h("button", { type: "button", class: "qmark", title: "¿Qué es esto?", "aria-label": `¿Qué es "${label}"?`, "aria-expanded": "false",
    onclick: () => { note.hidden = !note.hidden; q.setAttribute("aria-expanded", String(!note.hidden)); } }, "?") : null;
  const box = h("div", { class: "field" + (error ? " is-bad" : "") }, h("div", { class: "field__lab" }, h("label", { for: id }, label), q), note, input, hint && h("small", { class: "hint", id: id + "-h" }, hint), err);
  input.setAttribute("aria-describedby", [help ? id + "-n" : "", hint ? id + "-h" : "", id + "-e"].filter(Boolean).join(" ") + " " + id + "-w");
  const verify = () => { const m = validate ? validate(input.value) : ""; err.textContent = m || ""; box.classList.toggle("is-bad", !!m); input.setAttribute("aria-invalid", m ? "true" : "false"); };
  const warn = h("small", { class: "warn", id: id + "-w" });
  const verifySoft = () => { warn.textContent = soft ? soft(input.value) || "" : ""; };
  box.append(warn); verifySoft();
  input.addEventListener("input", () => { onInput(input.value, input); if (box.classList.contains("is-bad")) verify(); if (soft) verifySoft(); });
  if (validate) input.addEventListener("blur", verify);
  return box;
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
// igual que group, pero con una vista previa en vivo pegada bajo el título
export function groupAside(title, desc, aside, ...kids) {
  return h("section", { class: "card card--aside" },
    h("header", { class: "card__head" }, h("h3", {}, title), desc && h("p", {}, desc), aside),
    h("div", { class: "card__body" }, ...kids));
}
export const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");

// ---------- lista editable (subir, bajar, quitar, agregar) ----------
export function listEditor({ id, items, render, onChange, addLabel = "Agregar", make, min = 0, max = 99, title, sub, empty = "Todavía no hay nada.", extra }) {
  const box = h("div", { class: "list", "data-list": id || null });
  // después de subir, bajar, duplicar o quitar, el foco del teclado queda en el mismo tipo de botón
  const focusAct = (idx, act) => { const it = box.querySelectorAll(":scope > .item")[idx]; (it?.querySelector(`[data-act="${act}"]:not(:disabled)`) || it?.querySelector("button:not(:disabled)"))?.focus(); };
  const draw = () => {
    box.replaceChildren();
    if (!items.length) box.append(h("p", { class: "empty" }, empty));
    items.forEach((it, i) => {
      const nm = title ? title(it, i) : `elemento ${i + 1}`;
      const move = (d) => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; onChange(); draw(); focusAct(j, d < 0 ? "up" : "down"); };
      box.append(h("div", { class: "item" },
        h("div", { class: "item__bar" },
          h("span", { class: "item__title" }, h("strong", {}, title ? title(it, i) : `#${i + 1}`), sub && sub(it, i) ? h("small", { class: "item__sub" }, sub(it, i)) : null),
          h("span", { class: "item__btns" },
            h("button", { type: "button", class: "ico", title: "Duplicar", "data-act": "dup", "aria-label": `Duplicar ${nm}`, disabled: items.length >= max,
              onclick: () => { const c = structuredClone(it); if (typeof c.id === "string") c.id = "r" + Math.random().toString(36).slice(2, 7); delete c._bad; items.splice(i + 1, 0, c); onChange(); draw(); focusAct(i + 1, "dup"); } }, icon("copy", 17)),
            h("button", { type: "button", class: "ico", title: "Subir", "data-act": "up", "aria-label": `Subir ${nm}`, disabled: i === 0, onclick: () => move(-1) }, icon("up", 17)),
            h("button", { type: "button", class: "ico", title: "Bajar", "data-act": "down", "aria-label": `Bajar ${nm}`, disabled: i === items.length - 1, onclick: () => move(1) }, icon("down", 17)),
            h("button", { type: "button", class: "ico ico--del", title: "Quitar", "data-act": "del", "aria-label": `Quitar ${nm}`, disabled: items.length <= min,
              onclick: () => {
                // sin pregunta: se quita y queda a mano "Deshacer"
                undoToast(`Quitaste "${nm}".`, () => { items.splice(i, 1); onChange(); draw(); focusAct(Math.min(i, items.length - 1), "del"); });
              } }, icon("x", 17)))),
        render(it, i, draw)));
    });
    if (items.length < max) box.append(h("div", { class: "list__add" },
      h("button", { type: "button", class: "btn btn--ghost", onclick: () => { items.push(make()); onChange(); draw(); box.querySelectorAll(":scope > .item")[items.length - 1]?.querySelector("input,textarea")?.focus(); } }, icon("plus", 17), addLabel),
      extra));
  };
  draw();
  return box;
}

// ---------- imagen: elegir, achicar, convertir y subir ----------
export function imageField({ label, url, onChange, maxWidth = 1600, hint }) {
  const img = h("img", { alt: "", class: "imgf__img" });
  const info = h("small", { class: "hint" }, hint || "");
  let set = (u) => { img.src = u || ""; img.hidden = !u; };
  set(url);
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files[0]; if (!f) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = "Subiendo…";
    try {
      const r = await uploadImage(f, { maxWidth });
      set(r.url); onChange(r.url);
      info.textContent = `Listo · se optimizó de ${kb(r.before)} a ${kb(r.after)} (${r.width}×${r.height}).`;
    } catch (e) { toast(plainErr(e), "err", 7000); }
    finally { btn.disabled = false; btn.textContent = old; file.value = ""; }
  });
  const btn = h("button", { type: "button", class: "btn btn--ghost", onclick: () => file.click() }, url ? "Cambiar imagen" : "Elegir imagen");
  // la foto va con marco de boleto: borde fino y la franja del bus abajo
  const ticket = h("div", { class: "ticket" }, img, h("div", { class: "ticket__stripe", "aria-hidden": "true" }));
  ticket.hidden = !url;
  const baseSet = set;
  set = (u) => { baseSet(u); ticket.hidden = !u; };
  return h("div", { class: "imgf" }, label && h("span", { class: "imgf__label" }, label), h("div", { class: "imgf__row" }, ticket, h("div", {}, btn, file, info)));
}
