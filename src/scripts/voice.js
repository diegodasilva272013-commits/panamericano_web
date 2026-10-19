import { Conversation } from "@elevenlabs/client";
import { AGENT_ID } from "./data.js";

const $ = (s) => document.querySelector(s);
const root = $("#call");
const statusEl = $("#call-status");
const hintEl = $("#call-hint");
const mainBtn = $("#call-main");
const muteBtn = $("#call-mute");
const orb = $("#orb");
const canvas = $("#orb-canvas");
const ctx = canvas.getContext("2d");

let convo = null;
let phase = "idle"; // idle | ringing | live
let mode = "listening";
let muted = false;
let t0 = 0, tick = 0, raf = 0, lvl = 0;
let audio = null, ringTimer = 0, attemptId = 0;

const setLabel = (btn, txt) => (btn.querySelector(".ctl__txt").textContent = txt);
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/* tono de llamada sintetizado (sin archivos) */
function ringOnce() {
  if (!audio) return;
  const now = audio.currentTime;
  [0, 0.55].forEach((off) => {
    [440, 480].forEach((f) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + off);
      g.gain.linearRampToValueAtTime(0.05, now + off + 0.03);
      g.gain.setValueAtTime(0.05, now + off + 0.38);
      g.gain.linearRampToValueAtTime(0, now + off + 0.42);
      o.connect(g).connect(audio.destination);
      o.start(now + off); o.stop(now + off + 0.45);
    });
  });
}
function startRing() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { return; }
  ringOnce(); ringTimer = setInterval(ringOnce, 2200);
}
const stopRing = () => clearInterval(ringTimer);

/* orbe reactivo */
function draw() {
  raf = requestAnimationFrame(draw);
  const w = canvas.width, c = w / 2, time = performance.now() / 1000;
  let target = 0.08 + 0.04 * Math.sin(time * 1.6);
  if (convo && phase === "live") {
    try { target = Math.max(target, mode === "speaking" ? convo.getOutputVolume() : (muted ? 0 : convo.getInputVolume())); } catch {}
  } else if (phase === "ringing") target = 0.18 + 0.12 * Math.sin(time * 5);
  lvl += (target - lvl) * 0.18;

  ctx.clearRect(0, 0, w, w);
  const N = 96, base = w * 0.2;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const wob = 0.5 + 0.5 * Math.sin(a * 5 + time * 2.4) * Math.cos(a * 3 - time * 1.7);
    const len = w * (0.02 + lvl * 0.16 * (0.35 + wob));
    const r1 = base + w * 0.06, r2 = r1 + len;
    ctx.strokeStyle = `rgba(244,180,0,${0.35 + 0.65 * Math.min(1, lvl * 3) * (0.5 + wob / 2)})`;
    ctx.lineWidth = 3.2; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
    ctx.stroke();
  }
  orb.firstElementChild.nextElementSibling.style.transform = `scale(${1 + lvl * 0.28})`;
}

function setPhase(p) {
  phase = p;
  root.classList.toggle("is-ringing", p === "ringing");
  root.classList.toggle("is-live", p === "live");
  muteBtn.disabled = p !== "live";
  setLabel(mainBtn, p === "idle" ? "Llamar" : p === "ringing" ? "Cancelar" : "Colgar");
}

async function startCall() {
  setPhase("ringing");
  statusEl.textContent = "Llamando…";
  hintEl.textContent = "Conectando con el asistente de Panamericano.";
  startRing();

  try { await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch {
    stopRing(); setPhase("idle");
    statusEl.textContent = "Sin acceso al micrófono";
    hintEl.textContent = "Habilitá el micrófono en tu navegador o escribinos por WhatsApp.";
    return;
  }

  await new Promise((r) => setTimeout(r, 1700));
  if (phase !== "ringing") return;

  const attempt = ++attemptId;
  const callbacks = {
    onConnect: () => {
      if (attempt !== attemptId) return;
      stopRing(); setPhase("live");
      t0 = Date.now(); muted = false; muteBtn.setAttribute("aria-pressed", "false"); setLabel(muteBtn, "Silenciar");
      hintEl.textContent = "Hablá con naturalidad: consultá horarios, destinos o reservas.";
      tick = setInterval(() => { if (mode !== "speaking") statusEl.textContent = `En llamada · ${fmt(Math.round((Date.now() - t0) / 1000))}`; }, 500);
    },
    onModeChange: ({ mode: m }) => {
      if (attempt !== attemptId) return;
      mode = m;
      statusEl.textContent = m === "speaking" ? "Hablando…" : `En llamada · ${fmt(Math.round((Date.now() - t0) / 1000))}`;
    },
    onDisconnect: () => { if (attempt === attemptId) endCall(true); },
    onError: () => { if (attempt === attemptId) hintEl.textContent = "Se cortó la conexión. Probá de nuevo o escribinos por WhatsApp."; },
  };
  const tryConnect = (connectionType) => {
    let timer;
    const timeout = new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("timeout")), 12000)));
    const session = Conversation.startSession({ agentId: AGENT_ID, connectionType, ...callbacks });
    // si la sesión llega tarde (después del timeout), se descarta
    session.then((c) => { if (attempt !== attemptId || phase === "idle") c.endSession().catch(() => {}); }).catch(() => {});
    return Promise.race([session, timeout]).finally(() => clearTimeout(timer));
  };

  try {
    try { convo = await tryConnect("webrtc"); }
    catch { if (attempt !== attemptId || phase !== "ringing") return; convo = await tryConnect("websocket"); }
  } catch (e) {
    if (attempt !== attemptId) return;
    stopRing(); setPhase("idle"); convo = null;
    statusEl.textContent = "No se pudo conectar";
    hintEl.textContent = "Probá de nuevo en unos segundos o escribinos por WhatsApp.";
  }
}

async function endCall(remote = false) {
  attemptId++; stopRing(); clearInterval(tick);
  const c = convo; convo = null;
  if (c) { try { await c.endSession(); } catch {} }
  if (phase !== "idle") {
    const was = phase;
    setPhase("idle");
    statusEl.textContent = was === "live" ? "Llamada finalizada" : "Llamada cancelada";
    hintEl.textContent = remote ? "Gracias por comunicarte con Panamericano." : "Cuando quieras, volvé a llamar.";
  }
}

export function openCall() {
  root.classList.add("is-open"); root.setAttribute("aria-hidden", "false");
  document.getElementById("dock").classList.add("is-hidden");
  cancelAnimationFrame(raf); draw();
  mainBtn.focus({ preventScroll: true });
}
export function closeCall() {
  endCall();
  root.classList.remove("is-open"); root.setAttribute("aria-hidden", "true");
  document.getElementById("dock").classList.remove("is-hidden");
  cancelAnimationFrame(raf);
}

export function initVoice() {
  mainBtn.addEventListener("click", () => (phase === "idle" ? startCall() : endCall()));
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    try { convo?.setMicMuted(muted); } catch {}
    muteBtn.setAttribute("aria-pressed", String(muted));
    setLabel(muteBtn, muted ? "Activar" : "Silenciar");
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-call]")) openCall();
    if (e.target.closest("[data-close-call]")) closeCall();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("is-open")) closeCall(); });
  window.addEventListener("pagehide", () => { try { convo?.endSession(); } catch {} });
}
