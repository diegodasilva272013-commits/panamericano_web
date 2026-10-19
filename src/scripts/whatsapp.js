import { WA_NUMBER } from "./data.js";

const $ = (s) => document.querySelector(s);
const panel = $("#wa"), body = $("#wa-body"), input = $("#wa-input");

const QUICK = [
  "Quiero consultar horarios",
  "Quiero reservar un pasaje",
  "Consulta sobre equipaje",
  "Viaja un menor de edad",
  "Otra consulta",
];

const link = (text) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;

function send(text) {
  const clean = text.trim();
  if (!clean) return;
  const out = document.createElement("div");
  out.className = "wa__msg wa__msg--out";
  out.textContent = clean;
  body.appendChild(out);
  const reply = document.createElement("div");
  reply.className = "wa__msg wa__msg--in";
  reply.textContent = "Perfecto, te abrimos WhatsApp para continuar con la boletería.";
  setTimeout(() => { body.appendChild(reply); body.scrollTop = body.scrollHeight; }, 450);
  body.scrollTop = body.scrollHeight;
  setTimeout(() => window.open(link(`Hola Panamericano, ${clean.charAt(0).toLowerCase()}${clean.slice(1)}`), "_blank", "noopener"), 1100);
  input.value = "";
}

export function openWa() {
  panel.classList.add("is-open"); panel.setAttribute("aria-hidden", "false");
  if (matchMedia("(max-width:700px)").matches) document.getElementById("dock").classList.add("is-hidden");
  setTimeout(() => input.focus({ preventScroll: true }), 350);
}
export function closeWa() { panel.classList.remove("is-open"); panel.setAttribute("aria-hidden", "true"); if (!document.querySelector("#call.is-open")) document.getElementById("dock").classList.remove("is-hidden"); }

export function initWhatsapp() {
  $("#wa-quick").innerHTML = QUICK.map((q) => `<button type="button">${q}</button>`).join("");
  $("#wa-quick").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) send(b.textContent); });
  $("#wa-form").addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-wa]")) openWa();
    if (e.target.closest("[data-close-wa]")) closeWa();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWa(); });
}
