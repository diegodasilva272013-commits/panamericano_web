import { configured, getSession, signIn, signOut, isAdmin, loadAll } from "./api.js";
import { h, icon, toast, confirmBox, plainErr } from "../admin/ui.js";
import { bookings, todayJ, pending, orphanPayments, addDays, money } from "./model.js";
import { routeName } from "./trips.js";
import { openBooking } from "./detail.js";
import { inicio, reservas, salidas, pasajeros } from "./views-ops.js";
import { cobros, gastos, finanzas } from "./views-money.js";
import { mapa } from "./flota/view-live.js";
import { viajes } from "./flota/view-trips.js";
import { alertas } from "./flota/view-alerts.js";
import { geocercas } from "./flota/view-fences.js";
import { vehiculos } from "./flota/view-vehicles.js";
import { reportes } from "./flota/view-reports.js";
import { ajustesFlota } from "./flota/view-settings.js";
import { fleet, openAlerts } from "./flota/store.js";
import { fetchOpenAlerts } from "./flota/data.js";

const app = document.getElementById("app");
const VIEWS = [
  { id: "inicio", label: "Inicio", icon: "resumen", group: "", render: inicio },
  { id: "reservas", label: "Reservas", icon: "reservas", group: "Operación", render: reservas, badge: "pendientes" },
  { id: "salidas", label: "Salidas", icon: "horarios", group: "Operación", render: salidas },
  { id: "pasajeros", label: "Pasajeros", icon: "users", group: "Operación", render: pasajeros },
  { id: "cobros", label: "Cobros", icon: "coin", group: "Dinero", render: cobros, badge: "porcobrar" },
  { id: "gastos", label: "Gastos", icon: "receipt", group: "Dinero", render: gastos },
  { id: "finanzas", label: "Finanzas", icon: "chart", group: "Dinero", render: finanzas },
  { id: "mapa", label: "Mapa en vivo", icon: "mapa", group: "Flota", render: mapa },
  { id: "viajes", label: "Viajes", icon: "ruta", group: "Flota", render: viajes },
  { id: "alertas", label: "Alertas", icon: "campana", group: "Flota", render: alertas, badge: "alertas" },
  { id: "geocercas", label: "Geocercas y recorridos", icon: "geocerca", group: "Flota", render: geocercas },
  { id: "vehiculos", label: "Vehículos y equipos", icon: "bus", group: "Flota", render: vehiculos },
  { id: "reportes", label: "Reportes", icon: "reporte", group: "Flota", render: reportes },
  { id: "ajustes-flota", label: "Límites y tolerancias", icon: "ajustes", group: "Flota", render: ajustesFlota },
];
const mark = '<svg viewBox="0 0 24 24" width="26" height="26"><rect width="24" height="24" rx="7" fill="#f4b400"/><path d="M2 18c7 1 14-3 20-11v5C16 19 9 22 2 21z" fill="#171200"/><path d="M2 21c7 1 14-3 20-11" stroke="#d8261f" stroke-width="2.2" fill="none"/></svg>';
const brand = () => h("div", { class: "brand", html: mark + "<span>Panamericano</span>" });

let user = null, D = null, BK = [], loadedAt = 0, current = "inicio", pre = {}, main, navEl, sideEl, stampEl, loading = null, timer = null, leave = [], fleetTimer = null;

/* ---------- datos ---------- */
const compute = () => { BK = bookings(D.res, D.pay); };
function reload() {
  if (loading) return loading;
  loading = loadAll().then((d) => { D = d; loadedAt = Date.now(); compute(); badges(); stamp(); if (ctx.viewUpdate) ctx.viewUpdate(); else if (main) draw(); ctx.redrawDrawer?.(); }).finally(() => { loading = null; });
  return loading;
}
const modalOpen = () => !!document.querySelector(".drawer, .modal");
// se actualiza solo cada tanto y al volver a la pestaña, pero nunca mientras hay un formulario abierto
function autoRefresh() {
  if (document.hidden || !user || modalOpen() || Date.now() - loadedAt < 60000) return;
  reload().catch(() => {});
}

const ctx = {
  data: () => D, bks: () => BK, routeName: (id) => routeName(D.content, id),
  go: (id, params = {}) => { pre = params; if (location.hash === "#/" + id) draw(); else location.hash = "#/" + id; },
  open: (code, opts) => openBooking(ctx, code, opts), reload, redraw: () => draw(),
  viewUpdate: null, redrawDrawer: null, onDrawerClose: () => { ctx.redrawDrawer = null; },
  // lo que una pantalla necesita soltar al irse (temporizadores, mapas, conexiones en vivo)
  cleanup: (fn) => { leave.push(fn); },
  // cobros que apuntan a una reserva que ya no existe (alguien la borró a mano): se avisan, no se pierden
  alerts: () => {
    const o = orphanPayments(D.res, D.pay).filter((p) => p.paid_at >= addDays(D.since, 62));
    // pagos online que no coinciden con lo pedido (por ejemplo una transferencia por otro monto): hay que mirarlos en la cuenta del proveedor
    const rev = (D.review || []).map((r) => h("button", { type: "button", class: "warn warn--btn", onclick: () => ctx.open(r.code) },
      `Pago online para revisar: reserva ${r.code} (${r.provider === "talo" ? "transferencia" : "Mercado Pago"}, se esperaban ${money(+r.amount)}). Mirá lo que llegó en tu cuenta de ${r.provider === "talo" ? "Talo" : "Mercado Pago"} y registralo en la reserva.`));
    return h("div", {}, ...rev, o.length ? h("button", { type: "button", class: "warn warn--btn", onclick: () => ctx.go("cobros", {}) }, `${o.length} ${o.length === 1 ? "cobro apunta" : "cobros apuntan"} a reservas que ya no existen (${money(o.reduce((a, p) => a + (p.kind === "devolucion" ? -p.amount : p.amount), 0))}). Revisalos en Cobros.`) : null);
  },
};

/* ---------- pantallas de entrada ---------- */
const entry = (kids) => h("div", { class: "entry" },
  h("aside", { class: "entry__art" }, brand(), h("div"), h("div", { class: "entry__copy" },
    h("p", { class: "entry__big" }, "Reservas, cobros y finanzas en un solo lugar."), h("p", {}, "La gestión de la empresa, sin tocar la web."))),
  h("main", { class: "entry__form" }, ...kids));

function loginScreen(error) {
  const email = h("input", { type: "email", id: "em", autocomplete: "username", required: true });
  const pass = h("input", { type: "password", id: "pw", autocomplete: "current-password", required: true });
  const err = h("p", { class: "err", role: "alert" }, error || "");
  const btn = h("button", { class: "btn", type: "submit" }, "Entrar");
  app.replaceChildren(entry([h("h1", {}, "Gestión de Panamericano"), h("p", { class: "lead" }, "Ingresá con tu usuario de administración."),
    h("form", { class: "login", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ""; btn.disabled = true; btn.textContent = "Entrando…";
      try { await signIn(email.value.trim(), pass.value); await boot(); } catch (x) { err.textContent = plainErr(x); btn.disabled = false; btn.textContent = "Entrar"; }
    } }, h("div", { class: "field" }, h("label", { for: "em" }, "Email"), email), h("div", { class: "field" }, h("label", { for: "pw" }, "Contraseña"), pass), err, btn)]));
  email.focus();
}
const messageScreen = (title, text, ...btns) => app.replaceChildren(entry([h("h1", {}, title), h("p", { class: "lead" }, text), ...btns]));
const retry = () => h("button", { class: "btn btn--primary", type: "button", onclick: () => boot() }, "Reintentar");

/* ---------- armazón ---------- */
function badges() {
  if (!navEl) return;
  const n = { pendientes: BK.filter((b) => b.status === "pendiente" && b.date >= todayJ()).length, porcobrar: pending(BK).length, alertas: openAlerts().length };
  VIEWS.forEach((v) => { const b = navEl.querySelector(`[data-id="${v.id}"] .nav__n`); if (!b) return; const c = n[v.badge] || 0; b.textContent = c > 99 ? "99+" : String(c); b.hidden = !c; b.title = v.badge === "pendientes" ? "Reservas por confirmar" : v.badge === "alertas" ? "Alertas de la flota sin atender" : "Reservas con saldo por cobrar"; });
}
const stamp = () => { if (stampEl) stampEl.textContent = "Actualizado " + new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Jujuy" }).format(loadedAt); };

function shell() {
  main = h("main", { class: "main main--erp", id: "main", tabindex: "-1" });
  navEl = h("nav", { class: "side__nav", "aria-label": "Secciones" });
  let last = null;
  VIEWS.forEach((v) => {
    if (v.group !== last) { last = v.group; if (v.group) navEl.append(h("p", { class: "side__group" }, v.group)); }
    navEl.append(h("button", { type: "button", "data-id": v.id, onclick: () => ctx.go(v.id) }, icon(v.icon), h("span", {}, v.label), v.badge && h("span", { class: "nav__n", hidden: true })));
  });
  stampEl = h("span", { class: "stamp", role: "status" });
  const refreshBtn = h("button", { type: "button", class: "ico", "aria-label": "Actualizar los datos", title: "Actualizar los datos", onclick: async () => { refreshBtn.disabled = true; try { await reload(); toast("Datos actualizados.", "ok", 2000); } catch (e) { toast(plainErr(e), "err", 7000); } finally { refreshBtn.disabled = false; } } }, icon("refresh", 20));
  sideEl = h("aside", { class: "side" }, h("div", { class: "livery", "aria-hidden": "true" }),
    h("div", { class: "side__bar" }, brand(), h("button", { type: "button", class: "side__toggle", "aria-label": "Abrir el menú", "aria-expanded": "false", onclick: (e) => { const o = sideEl.classList.toggle("is-open"); e.currentTarget.setAttribute("aria-expanded", String(o)); } }, icon("menu", 22), h("span", { class: "side__toggle__t" }, "Menú"))),
    h("div", { class: "side__body" }, navEl,
      h("div", { class: "side__foot" }, h("small", {}, user.email),
        h("a", { class: "link", href: "/admin" }, icon("external", 16), "Editar la web"),
        h("button", { type: "button", class: "link", onclick: async () => { await signOut(); user = null; clearInterval(timer); clearInterval(fleetTimer); fleet.clear(); await boot(); } }, icon("logout", 17), "Cerrar sesión"))));
  app.replaceChildren(h("div", { class: "layout erp" }, h("a", { class: "skip", href: "#main" }, "Saltar al contenido"), sideEl,
    h("div", { class: "content" }, h("header", { class: "top top--erp" }, stampEl, refreshBtn), main)));
  badges(); stamp();
}

function draw() {
  const v = VIEWS.find((x) => x.id === current) || VIEWS[0];
  navEl.querySelectorAll("button[data-id]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === v.id)));
  document.title = `${v.label} · Gestión de Panamericano`;
  ctx.viewUpdate = null;
  for (const fn of leave.splice(0)) { try { fn(); } catch (e) { console.warn("[erp] al salir de la pantalla", e); } }
  const params = pre; pre = {};
  let node;
  try { node = v.render(ctx, params); }
  catch (e) { console.error(e); node = h("div", { class: "page" }, h("p", { class: "err", role: "alert" }, "No se pudo mostrar esta pantalla. Probá actualizar los datos."), retryBtn()); }
  main.replaceChildren(node);
  sideEl.classList.remove("is-open"); sideEl.querySelector(".side__toggle")?.setAttribute("aria-expanded", "false");
}
const retryBtn = () => h("button", { class: "btn", type: "button", onclick: () => reload().then(draw).catch((e) => toast(plainErr(e), "err", 7000)) }, "Actualizar");

function route() {
  const id = location.hash.replace(/^#\//, "").split(/[?/]/)[0];
  const changed = id && VIEWS.some((v) => v.id === id) ? id : "inicio";
  if (!main) return;
  current = changed; draw();
  scrollTo(0, 0); main.querySelector(".title")?.setAttribute("tabindex", "-1");
}

/* ---------- arranque ---------- */
export async function boot() {
  if (!configured) return messageScreen("Falta conectar la base de datos", "Este sistema usa la misma base de datos que la web. Seguí los pasos del README, sección «Panel de administración».");
  let session;
  try { session = await getSession(); } catch (e) { return messageScreen("No pudimos cargar", plainErr(e), retry()); }
  if (!session) return loginScreen();
  user = session.user;
  try { if (!(await isAdmin(user.id))) return messageScreen("Sin permiso", `La cuenta ${user.email} no es administradora. Pedile acceso a quien administra la web.`, h("button", { class: "btn", type: "button", onclick: async () => { await signOut(); await boot(); } }, "Salir")); }
  catch (e) { return messageScreen("No pudimos cargar", plainErr(e), retry()); }
  try { D = await loadAll(); loadedAt = Date.now(); compute(); }
  catch (e) {
    if (e.setup) return messageScreen("Falta un paso en la base de datos", "Para llevar cobros y gastos hay que crear dos tablas nuevas. Se hace una sola vez, y no toca nada de lo que ya hay: en Supabase → SQL Editor → New query, pegá todo el archivo supabase/erp.sql del repositorio y tocá Run. Después volvé acá.", retry());
    return messageScreen("No pudimos cargar", plainErr(e), retry());
  }
  shell();
  route();
  clearInterval(timer); timer = setInterval(autoRefresh, 30000);
  watchFleetBadge();
}

// La insignia de alertas del menú: se carga en segundo plano y se actualiza sola. Si la flota todavía no está activada en la base, no aparece y no molesta.
function watchFleetBadge() {
  clearInterval(fleetTimer);
  const refresh = async () => { try { if (!fleet.get()) await fleet.ensure(); else fleet.patchAlerts(await fetchOpenAlerts(2)); badges(); } catch { /* flota sin activar o sin conexión */ } };
  refresh(); fleetTimer = setInterval(() => { if (!document.hidden && user) refresh(); }, 45000);
}
fleet.on((w) => { if (w === "alerts" || w === "load") badges(); }); // la insignia de alertas sigue a los datos de la flota
addEventListener("hashchange", () => { if (user && main && document.body.contains(main)) route(); });
document.addEventListener("visibilitychange", autoRefresh);
addEventListener("online", autoRefresh);
boot();
