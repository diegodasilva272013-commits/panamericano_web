// Vehículos y equipos: cada coche con su equipo GPS (IMEI), su coche del panel, su estado y los vencimientos de sus documentos.
import { h, icon, chip, kpi, table, input, drawer, put } from "../kit.js";
import { toast, confirmBox, plainErr } from "../../admin/ui.js";
import { pageHead } from "../views-ops.js";
import { fleet } from "./store.js";
import { save } from "./data.js";
import { showError, rowsOf } from "./view-live.js";
import { STATUS, ago, fmtWhen, jujuyDay } from "./status.js";

const DOC_KINDS = ["VTV", "Seguro", "Habilitación", "Licencia de conductor", "Tacógrafo", "Matafuegos", "Otro"];
const daysTo = (iso, today) => Math.round((Date.parse(iso + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 864e5);
export const docChip = (d, today) => { const n = daysTo(d.expires_on, today); return n < 0 ? chip(`Vencido hace ${-n} ${-n === 1 ? "día" : "días"}`, "bad") : n <= 30 ? chip(n === 0 ? "Vence hoy" : `Vence en ${n} ${n === 1 ? "día" : "días"}`, "warn") : chip("Vigente", "ok"); };
const fmtDate = (iso) => iso.split("-").reverse().join("/");

export function vehiculos(ctx) {
  const page = h("div", { class: "page" }, h("p", { class: "boot" }, "Cargando los vehículos…"));
  fleet.ensure().then((F) => mount(page, ctx, F)).catch((e) => showError(page, e, () => ctx.redraw()));
  return page;
}

function mount(page, ctx, F0) {
  let F = F0;
  const buses = () => ctx.data().content.buses || [];
  const busName = (id) => buses().find((b) => b.id === id)?.name || "";
  const body = h("div", { class: "vstack" });
  const today = () => jujuyDay();

  const draw = () => {
    F = fleet.get();
    const rows = rowsOf(F), docs = F.docs, t = today();
    const dueDocs = docs.filter((d) => daysTo(d.expires_on, t) <= 30);
    const docsOf = (id) => docs.filter((d) => d.vehicle_id === id);
    const taken = new Set(F.vehicles.map((v) => v.device_id).filter(Boolean));
    const free = F.vehicles.filter((v) => !v.device_id);
    put(body,
      h("div", { class: "kpis kpis--sm" },
        kpi({ label: "Coches", value: F.vehicles.filter((v) => v.active !== false).length, sub: `${F.vehicles.filter((v) => v.device_id).length} con equipo GPS` }),
        kpi({ label: "Transmitiendo ahora", value: rows.filter((r) => r.status === "moving" || r.status === "idle" || r.status === "parked").length, sub: "con datos de los últimos minutos", tone: "ok" }),
        kpi({ label: "Sin señal", value: rows.filter((r) => r.status === "offline").length, tone: rows.some((r) => r.status === "offline") ? "bad" : "" }),
        kpi({ label: "Documentos por vencer o vencidos", value: dueDocs.length, sub: "en los próximos 30 días", tone: dueDocs.some((d) => daysTo(d.expires_on, t) < 0) ? "bad" : dueDocs.length ? "warn" : "" })),
      F.unknown.filter((u) => !taken.has(u.device_id)).length ? h("section", { class: "panel panel--warn" },
        h("h2", {}, "Equipos nuevos transmitiendo"), h("p", { class: "hint" }, "Estos equipos le están hablando al servidor pero todavía no están asignados a ningún coche. Hasta que los vincules, sus datos no se guardan."),
        h("div", { class: "lines" }, F.unknown.filter((u) => !taken.has(u.device_id)).map((u) => h("div", { class: "line line--static" },
          h("strong", { class: "mono" }, u.device_id), h("span", { class: "line__m" }, `${Number(u.frames).toLocaleString("es-AR")} tramas · visto ${ago(Date.parse(u.last_seen))}`),
          h("span", { class: "chips" }, free.length ? h("button", { type: "button", class: "btn btn--sm", onclick: () => linkUnknown(u, free) }, "Vincular a un coche") : null,
            h("button", { type: "button", class: "btn btn--sm btn--ghost", onclick: () => form({ device_id: u.device_id }) }, "Crear coche nuevo")))))) : null,
      h("section", { class: "panel" }, table({
        label: "Vehículos", rows, empty: "Todavía no cargaste ningún coche. Agregá el primero con el botón de arriba.", onRow: (r) => form(r.v),
        cols: [
          { h: "Coche", c: (r) => h("span", { class: "vcell" }, h("b", {}, r.v.code), r.v.plate ? h("small", { class: "block sub" }, r.v.plate) : null) },
          { h: "Equipo GPS", c: (r) => (r.v.device_id ? h("span", { class: "mono" }, r.v.device_id) : chip("Sin equipo", "off")) },
          { h: "Coche del panel", c: (r) => busName(r.v.bus_id) || h("span", { class: "sub" }, "—") },
          { h: "Estado", c: (r) => chip(STATUS[r.status].label, STATUS[r.status].tone) },
          { h: "Último dato", c: (r) => (r.seen ? `${fmtWhen(new Date(r.seen).toISOString())} · ${ago(r.seen)}` : "—") },
          { h: "Documentos", c: (r) => { const ds = docsOf(r.v.id); if (!ds.length) return h("span", { class: "sub" }, "—"); const worst = ds.slice().sort((a, b) => a.expires_on.localeCompare(b.expires_on))[0]; return h("span", { class: "chips" }, docChip(worst, t), ds.length > 1 ? h("small", { class: "sub" }, `de ${ds.length}`) : null); } },
        ] })));
  };

  function linkUnknown(u, free) {
    const sel = input({ label: "Coche", options: free.map((v) => [v.id, v.code + (v.plate ? ` · ${v.plate}` : "")]), value: free[0].id });
    const ok = h("button", { type: "submit", class: "btn" }, "Vincular");
    const fm = h("form", { class: "payform payform--flat", onsubmit: async (e) => { e.preventDefault(); ok.disabled = true; try { await save.linkUnknown(u.device_id, sel.get()); await fleet.reload(); dr.close(); draw(); toast("Equipo vinculado. Desde ahora se guardan sus recorridos.", "ok", 5000); } catch (x) { toast(plainErr(x), "err", 8000); ok.disabled = false; } } },
      h("p", { class: "hint" }, `El equipo ${u.device_id} pasa a ser de este coche.`), sel.el, h("div", { class: "payform__act" }, ok));
    const dr = drawer({ title: "Vincular un equipo", sub: "Elegí a qué coche pertenece.", body: fm });
  }

  function form(v) {
    const isNew = !v || !v.id;
    const f = {
      code: input({ label: "Nombre del coche", value: v?.code || "", required: true, max: 40, placeholder: "INT 110", hint: "Como lo llama el personal." }),
      plate: input({ label: "Patente", value: v?.plate || "", max: 12, placeholder: "AB123CD" }),
      dev: input({ label: "Equipo GPS (IMEI)", value: v?.device_id || "", max: 32, inputmode: "numeric", placeholder: "860012345678901", hint: "Está en la etiqueta del equipo y en cada trama que manda. Sin esto el coche no aparece en el mapa." }),
      bus: input({ label: "Coche del panel", options: [["", "Ninguno"], ...buses().map((b) => [b.id, b.name])], value: v?.bus_id || "", hint: "El plano de asientos que usa en las reservas." }),
      notes: input({ label: "Notas", value: v?.notes || "", long: true, max: 300 }),
    };
    const active = h("input", { type: "checkbox", id: "vh-act", checked: v?.active === false ? null : true });
    let busy = false;
    const submit = async (ev) => {
      ev.preventDefault(); if (busy) return;
      for (const k of Object.keys(f)) f[k].error?.("");
      if (!f.code.get().trim()) return f.code.error("Escribí el nombre del coche.");
      const imei = f.dev.get().trim();
      if (imei && !/^[A-Za-z0-9-]{4,32}$/.test(imei)) return f.dev.error("El identificador solo puede tener letras, números y guiones.");
      busy = true; sv.disabled = true;
      try {
        const row = await save.vehicle({ id: v?.id, code: f.code.get(), plate: f.plate.get(), device_id: imei, bus_id: f.bus.get(), notes: f.notes.get().trim(), active: active.checked });
        await fleet.reload(); dr.close(); draw(); toast(isNew ? `${row.code} agregado.` : "Cambios guardados.", "ok", 4000);
      } catch (x) { toast(plainErr(x), "err", 9000); busy = false; sv.disabled = false; }
    };
    const sv = h("button", { type: "submit", class: "btn" }, isNew ? "Agregar el coche" : "Guardar los cambios");
    const del = !isNew && h("button", { type: "button", class: "btn btn--ghost", onclick: async () => {
      if (!(await confirmBox(`¿Borrar ${v.code}? Se borra también TODO su historial de recorridos, alertas y documentos. Si solo querés que deje de aparecer, desmarcá «Está en servicio».`, "Borrar el coche y su historial", "No", { focusCancel: true }))) return;
      try { await save.removeVehicle(v.id); await fleet.reload(); dr.close(); draw(); toast("Coche borrado.", "ok", 4000); } catch (x) { toast(plainErr(x), "err", 9000); }
    } }, icon("trash", 18), "Borrar");
    const docsBox = h("div", { class: "docs" });
    const drawDocs = () => {
      const ds = fleet.get().docs.filter((d) => d.vehicle_id === v?.id), t = today();
      put(docsBox, h("h3", {}, "Documentos y vencimientos"), ds.length ? h("div", { class: "lines" }, ds.map((d) => h("div", { class: "line line--static" },
        h("strong", {}, d.kind), h("span", { class: "line__m" }, `${d.number ? d.number + " · " : ""}vence el ${fmtDate(d.expires_on)}`), docChip(d, t),
        h("button", { type: "button", class: "ico", "aria-label": `Borrar ${d.kind}`, onclick: async () => { try { await save.removeDoc(d.id); await fleet.reload(); drawDocs(); draw(); } catch (x) { toast(plainErr(x), "err", 7000); } } }, icon("trash", 17))))) : h("p", { class: "empty" }, "Todavía no cargaste documentos de este coche."), docForm());
    };
    const docForm = () => {
      const k = input({ label: "Documento", options: DOC_KINDS.map((x) => [x, x]), value: "VTV" }), n = input({ label: "Número (opcional)", max: 40 }), e = input({ label: "Vence el", type: "date" });
      return h("form", { class: "docform", onsubmit: async (ev) => { ev.preventDefault(); e.error(""); if (!e.get()) return e.error("Elegí la fecha de vencimiento."); try { await save.doc({ vehicle_id: v.id, kind: k.get(), number: n.get(), expires_on: e.get() }); await fleet.reload(); drawDocs(); draw(); toast("Documento cargado.", "ok", 2500); } catch (x) { toast(plainErr(x), "err", 7000); } } },
        h("div", { class: "grid3" }, k.el, n.el, e.el), h("button", { type: "submit", class: "btn btn--ghost btn--sm" }, icon("plus", 16), "Agregar documento"));
    };
    const fm = h("form", { class: "payform payform--flat", onsubmit: submit, novalidate: true },
      h("div", { class: "grid2" }, f.code.el, f.plate.el), f.dev.el, f.bus.el, f.notes.el,
      h("label", { class: "check", for: "vh-act" }, active, h("span", {}, "Está en servicio")),
      h("div", { class: "payform__act" }, del, sv));
    const dr = drawer({ title: isNew ? "Agregar un coche" : v.code, sub: isNew ? "Cada coche con su equipo GPS." : v.plate || "Datos del coche y su equipo.", body: h("div", {}, fm, isNew ? null : docsBox) });
    if (!isNew) drawDocs();
    f.code.input.focus();
  }

  put(page, pageHead("Vehículos y equipos", "Cada coche con su equipo GPS, su estado y los vencimientos de sus documentos.",
    h("button", { type: "button", class: "btn", onclick: () => form(null) }, icon("plus", 18), "Agregar un coche")), body);
  draw();
  const timer = setInterval(() => { if (!document.hidden && !document.querySelector(".drawer")) { fleet.reload().then(draw).catch(() => {}); } }, 30_000);
  ctx.cleanup(() => clearInterval(timer));
}
