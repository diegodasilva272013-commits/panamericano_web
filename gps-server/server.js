// Servidor receptor de los GPS Rinho: escucha UDP y TCP, valida cada trama, la guarda y RECIÉN DESPUÉS confirma (ACK).
// Si guardar falla no se confirma: el equipo reintenta y no se pierde nada.
//
// Dos etapas:
//  1) Recepción: cada reporte se guarda y se confirma enseguida (rápido y a prueba de caídas).
//  2) Motor de eventos (viajes, paradas, alertas): procesa los reportes EN ORDEN, con una pequeña demora (LAG_MS) para que los que llegan
//     desordenados (reintentos, memoria del equipo) se acomoden. Si igual llega algo más viejo de lo ya procesado, el viaje se rehace
//     desde el historial guardado: el resultado no depende del orden en que llegaron los datos.
import dgram from "node:dgram";
import net from "node:net";
import http from "node:http";
import { extractFrames, parseFrame, ack } from "./taip.js";
import { createEngine, mergeOut } from "./engine.js";
import { compactBatch } from "./batch.js";

const defaultLog = (level, msg, extra = {}) => console[level === "error" ? "error" : "log"](JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));
const MAX_TCP_BUFFER = 16 * 1024;
const noOut = () => ({ events: [], alerts: [], trips: [], stops: [] });
const toPos = (r) => ({ t: Date.parse(r.t), lat: r.lat, lng: r.lng, speed: r.speed, course: r.course, ign: r.ign, voltage: r.voltage, odometerM: r.odometerM, sats: r.sats, csq: r.csq });

export function createServer({ store, env = process.env, log = defaultLog, now = () => Date.now() } = {}) {
  const opt = {
    udpPort: Number(env.UDP_PORT ?? 4031), tcpPort: Number(env.TCP_PORT ?? env.UDP_PORT ?? 4031), healthPort: env.HEALTH_PORT === "off" ? null : Number(env.HEALTH_PORT ?? 8081),
    checksum: env.CHECKSUM || "warn",            // warn: avisa pero acepta · strict: descarta las que no coinciden · off: no controla
    flushMs: Number(env.FLUSH_MS ?? 500), configEveryMs: Number(env.CONFIG_REFRESH_S ?? 30) * 1000, sweepEveryMs: Number(env.SWEEP_S ?? 30) * 1000,
    lagMs: Number(env.LAG_MS ?? 45_000), drainMs: Number(env.DRAIN_MS ?? 2000),
    maxFramesPerSec: Number(env.MAX_FRAMES_PER_SEC ?? 200), tcpIdleMs: 10 * 60_000, maxTcp: 300, host: env.BIND_HOST || "0.0.0.0",
  };
  const engine = createEngine();
  const stats = { startedAt: now(), frames: 0, positions: 0, saved: 0, acked: 0, rejected: {}, badChecksum: 0, unknownDevice: 0, noFix: 0, dropped: 0, saveErrors: 0, engineErrors: 0, replays: 0, configErrors: 0, lastSaveAt: null, lastConfigAt: null, tcpConnections: 0 };
  let ready = false, pending = [], flushing = false, flushTimer = null, stopped = false, draining = false;
  const buf = new Map();       // vehicleId -> reportes ya guardados que esperan su turno en el motor
  const unknown = new Map();   // equipos que transmiten pero no están cargados en el ERP
  const nat = new Map();       // deviceId -> última dirección (para mandarle comandos por UDP, en una etapa posterior)
  const bucket = new Map();    // freno de ráfagas por dirección de origen
  const timers = [];
  let udp = null, tcp = null, health = null;
  const sockets = new Set();
  let samplesLogged = 0;

  // ---------------------------------------------------------------- recepción
  // Freno de abusos: se cuentan por segundo y por origen las tramas dañadas o de equipos que no están cargados. Un equipo legítimo que vuelca
  // su memoria manda ráfagas largas y no entra en esta cuenta; quien manda basura sí, y pasado el límite se lo ignora sin gastar proceso.
  const bad = (addr) => {
    const sec = Math.floor(now() / 1000), b = bucket.get(addr);
    if (!b || b.sec !== sec) { bucket.set(addr, { sec, n: 1 }); return; }
    b.n++;
  };
  const abusive = (addr) => { const b = bucket.get(addr); return !!b && b.sec === Math.floor(now() / 1000) && b.n > opt.maxFramesPerSec; };

  function handleFrame(raw, remote, send) {
    stats.frames++;
    if (abusive(remote.address)) { stats.dropped++; return; }
    const f = parseFrame(raw, { strictChecksum: opt.checksum === "strict" });
    if (!f.ok) {
      bad(remote.address);
      stats.rejected[f.reason] = (stats.rejected[f.reason] || 0) + 1;
      if (samplesLogged++ < 20 || samplesLogged % 500 === 0) log("warn", "trama descartada", { reason: f.reason, from: remote.address, raw: raw.slice(0, 200) });
      return;
    }
    if (!f.checksumOk && opt.checksum !== "off") {
      stats.badChecksum++;
      if (samplesLogged++ < 20 || samplesLogged % 500 === 0) log("warn", "el checksum no coincide con el algoritmo de la guía", { from: remote.address, raw: raw.slice(0, 200) });
    }
    const v = engine.vehicleForDevice(f.deviceId);
    if (!v) {
      bad(remote.address);
      stats.unknownDevice++;
      const u = unknown.get(f.deviceId) || { deviceId: f.deviceId, frames: 0, sample: "" };
      u.frames++; u.sample = raw.slice(0, 250); unknown.set(f.deviceId, u);
      return; // sin ACK: no se acepta nada de equipos que no están cargados
    }
    nat.set(f.deviceId, { remote, at: now() });
    if (f.type === "keepalive") return;
    if (!ready) return; // todavía sin configuración: no se confirma, el equipo reintenta
    if (f.type !== "position") { if (f.needsAck) { send(ack(f.msgNum, f.deviceId)); stats.acked++; } log("info", "mensaje del equipo", { type: f.type, deviceId: f.deviceId, version: f.version, value: f.value }); return; }

    stats.positions++;
    const t = Date.parse(f.eventTime);
    const sinFix = (f.lat === 0 && f.lng === 0) || f.gpsMode === 1 || (f.reportType === "CP" && f.sats < 4);
    const fechaRara = !Number.isFinite(t) || t > now() + 24 * 3600_000 || t < now() - 10 * 365 * 864e5;
    if (sinFix || fechaRara) { // se confirma (reenviarlo no lo arregla) pero no se guarda
      stats.noFix++;
      if (f.needsAck) { send(ack(f.msgNum, f.deviceId)); stats.acked++; }
      return;
    }
    pending.push({ f, v, t, send, rx: now(), pos: { t, lat: f.lat, lng: f.lng, speed: f.speed, course: f.course, ign: f.ignition, voltage: f.voltage, odometerM: f.odometerM, sats: f.sats, csq: f.csq } });
    if (pending.length >= 200) flush(); else schedule();
  }

  const handleText = (text, remote, send) => { for (const raw of extractFrames(text).frames) handleFrame(raw, remote, send); };

  // ---------------------------------------------------------------- etapa 1: guardar y confirmar
  function schedule() { if (!flushTimer && !stopped) flushTimer = setTimeout(() => { flushTimer = null; flush(); }, opt.flushMs); }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try { while (pending.length) await persist(pending.splice(0, 500)); } finally { flushing = false; }
  }

  const row = (it) => {
    const f = it.f, extra = {};
    for (const k of ["backupV", "engineS", "temp0", "temp1", "ibutton", "session", "sessionCode", "params", "can", "text"]) if (f[k] !== undefined) extra[k] = f[k];
    return { vehicleId: it.v.id, deviceId: f.deviceId, t: f.eventTime, reportId: f.reportId, lat: f.lat, lng: f.lng, speed: f.speed, course: f.course, ign: f.ignition, voltage: f.voltage, odometerM: f.odometerM, sats: f.sats, pdop: f.pdop, csq: f.csq, gsm: f.gsm, rtype: f.reportType, extra: Object.keys(extra).length ? extra : null };
  };

  async function persist(items) {
    try { await store.save({ positions: items.map(row) }); }
    catch (e) {
      stats.saveErrors++;
      log("error", "no se pudo guardar el lote: no se confirma, los equipos reintentan", { error: e.message, items: items.length });
      return;
    }
    stats.saved += items.length; stats.lastSaveAt = now();
    for (const it of items) {
      if (it.f.needsAck) { try { it.send(ack(it.f.msgNum, it.f.deviceId)); stats.acked++; } catch { /* el equipo se desconectó: reintentará */ } }
      (buf.get(it.v.id) || buf.set(it.v.id, []).get(it.v.id)).push({ t: it.t, pos: it.pos, rx: it.rx });
    }
  }

  // ---------------------------------------------------------------- etapa 2: motor de eventos, en orden
  /** Procesa los reportes de un coche. Si alguno es más viejo que lo ya procesado, rehace el coche desde el historial guardado. */
  async function processVehicle(vid, items) {
    items.sort((a, b) => a.t - b.t);
    let out = noOut(), state = null, lateMin = null;
    for (const it of items) {
      const r = engine.ingest(vid, it.pos, it.rx);
      if (r.out.late) lateMin = lateMin == null ? it.t : Math.min(lateMin, it.t);
      else { mergeOut(out, r.out); state = r.state; }
    }
    if (lateMin != null) {
      stats.replays++;
      const from = engine.replayStart(vid, lateMin);
      const rows = await store.positionsSince(vid, new Date(from).toISOString());
      engine.resetVehicle(vid, from);
      out = noOut(); state = null;
      rows.map(toPos).forEach((p) => { const r = engine.ingest(vid, p, p.t); if (!r.out.late) { mergeOut(out, r.out); state = r.state; } });
      log("info", "viaje rehecho desde el historial porque llegaron posiciones atrasadas", { vehicleId: vid, desde: new Date(from).toISOString(), posiciones: rows.length });
      return { out, state, rebuild: { vehicleId: vid, from: new Date(from).toISOString(), tripIds: engine.tripIds(vid, from) } };
    }
    return { out, state };
  }

  /** Procesa lo que ya esperó su turno (o todo, con force). */
  async function drain(force = false) {
    if (draining || !ready) return;
    draining = true;
    try {
      const cutoff = now() - opt.lagMs, work = [];
      for (const [vid, list] of buf) {
        const readyItems = force ? list.splice(0) : list.filter((i) => i.rx <= cutoff);
        if (!force) buf.set(vid, list.filter((i) => i.rx > cutoff));
        if (readyItems.length) work.push([vid, readyItems]);
        if (!buf.get(vid)?.length) buf.delete(vid);
      }
      if (!work.length) return;
      const restore = engine.checkpoint(work.map(([vid]) => vid));
      const batch = { ...noOut(), state: [], rebuild: [] };
      try {
        for (const [vid, items] of work) { const { out, state, rebuild } = await processVehicle(vid, items); mergeOut(batch, out); if (state) batch.state.push(state); if (rebuild) batch.rebuild.push(rebuild); }
        await store.save(compactBatch(batch));
      } catch (e) {
        // no se pudo guardar lo derivado: el motor vuelve a como estaba y los reportes (ya guardados) vuelven a la fila para el próximo intento
        restore(); stats.engineErrors++;
        for (const [vid, items] of work) buf.set(vid, [...items, ...(buf.get(vid) || [])]);
        log("error", "no se pudieron guardar los viajes y alertas: se reintenta", { error: e.message });
      }
    } finally { draining = false; }
  }

  /** Espera a que todo lo recibido esté guardado y procesado (lo usan las pruebas y el apagado ordenado). */
  async function settle() {
    for (let i = 0; i < 50; i++) {
      while (flushing) await new Promise((r) => setTimeout(r, 5));
      await flush();
      while (draining) await new Promise((r) => setTimeout(r, 5));
      await drain(true);
      if (!pending.length && ![...buf.values()].some((l) => l.length)) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** Tras un reinicio: procesa lo guardado después de lo último que el motor había visto. */
  async function catchUp() {
    const work = [];
    for (const vid of engine.vehicleIds()) {
      const s = engine.state(vid);
      if (s && s.t != null && now() - s.t > 24 * 3600_000) continue;
      const from = s && s.t != null ? s.t : now() - 12 * 3600_000; // sin estado guardado: las últimas 12 horas (alcanza para un viaje largo)
      try { const rows = await store.positionsSince(vid, new Date(from).toISOString()); if (rows.length) work.push([vid, rows.map(toPos).map((p) => ({ t: p.t, pos: p, rx: p.t }))]); }
      catch (e) { log("error", "no se pudo retomar un coche tras el reinicio", { vehicleId: vid, error: e.message }); }
    }
    for (const [vid, items] of work) buf.set(vid, [...(buf.get(vid) || []), ...items]);
    if (work.length) { await drain(true); log("info", "retomado tras el reinicio", { coches: work.length }); }
  }

  // ---------------------------------------------------------------- tareas periódicas
  async function refreshConfig() {
    try { engine.setConfig(await store.config()); ready = true; stats.lastConfigAt = now(); }
    catch (e) { stats.configErrors++; log("error", "no se pudo leer la configuración", { error: e.message }); }
  }
  async function sweep() {
    if (!ready) return;
    const restore = engine.checkpoint(engine.knownVehicles());
    const out = engine.sweep(now());
    if (!out.alerts.length) return;
    try { await store.save(compactBatch({ alerts: out.alerts })); } catch (e) { restore(); log("error", "no se pudieron guardar las alertas de falta de señal", { error: e.message }); }
  }
  async function flushUnknown() {
    if (!unknown.size) return;
    const list = [...unknown.values()]; unknown.clear();
    try { await store.unknown(list); } catch (e) { for (const u of list) { const c = unknown.get(u.deviceId); unknown.set(u.deviceId, c ? { ...c, frames: c.frames + u.frames } : u); } log("error", "no se pudieron registrar equipos desconocidos", { error: e.message }); }
  }
  let purgedDay = "";
  async function purgeDaily() {
    const jujuy = new Date(now() - 3 * 3600_000), day = jujuy.toISOString().slice(0, 10);
    if (jujuy.getUTCHours() !== 3 || purgedDay === day || !ready) return;
    purgedDay = day;
    try { const n = await store.purge(); log("info", "limpieza de posiciones viejas", { borradas: Number(n) }); } catch (e) { log("error", "falló la limpieza", { error: e.message }); }
  }

  // ---------------------------------------------------------------- arranque / parada
  async function start() {
    await refreshConfig();
    if (!ready) log("warn", "arranca sin configuración: no se confirmará nada hasta poder leer la base");
    else await catchUp();
    udp = dgram.createSocket("udp4");
    udp.on("error", (e) => log("error", "UDP", { error: e.message }));
    udp.on("message", (msg, r) => handleText(msg.toString("latin1"), { address: r.address, port: r.port }, (s) => udp.send(Buffer.from(s, "latin1"), r.port, r.address)));
    await new Promise((res, rej) => { udp.once("error", rej); udp.bind(opt.udpPort, opt.host, res); });

    tcp = net.createServer((sock) => {
      if (sockets.size >= opt.maxTcp) { sock.destroy(); return; }
      sockets.add(sock); stats.tcpConnections++;
      const remote = { address: sock.remoteAddress || "?", port: sock.remotePort };
      let b = "";
      sock.setTimeout(opt.tcpIdleMs, () => sock.destroy());
      sock.on("data", (d) => {
        b += d.toString("latin1");
        const { frames, rest } = extractFrames(b);
        b = rest.length > MAX_TCP_BUFFER ? "" : rest;
        for (const raw of frames) handleFrame(raw, remote, (s) => { if (sock.writable) sock.write(Buffer.from(s, "latin1")); });
      });
      sock.on("error", () => {}); sock.on("close", () => sockets.delete(sock));
    });
    await new Promise((res, rej) => { tcp.once("error", rej); tcp.listen(opt.tcpPort, opt.host, res); });

    if (opt.healthPort != null) {
      health = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: ready && !stopped, ready, uptimeS: Math.round((now() - stats.startedAt) / 1000), pending: pending.length, buffered: [...buf.values()].reduce((a, l) => a + l.length, 0), ...stats }));
      });
      await new Promise((res, rej) => { health.once("error", rej); health.listen(opt.healthPort, "127.0.0.1", res); });
    }
    timers.push(setInterval(refreshConfig, opt.configEveryMs), setInterval(sweep, opt.sweepEveryMs), setInterval(flushUnknown, 30_000), setInterval(purgeDaily, 10 * 60_000), setInterval(() => drain(false).catch(() => {}), opt.drainMs));
    for (const t of timers) t.unref?.();
    log("info", "receptor GPS en marcha", { udp: ports().udp, tcp: ports().tcp, checksum: opt.checksum, lagMs: opt.lagMs });
  }

  const ports = () => ({ udp: udp?.address().port, tcp: tcp?.address().port, health: health?.address().port });

  let closed = false;
  async function stop({ graceful = true } = {}) {
    if (closed) return;
    closed = true; stopped = true;
    timers.forEach(clearInterval); clearTimeout(flushTimer);
    if (graceful) await settle().catch(() => {});
    await flushUnknown().catch(() => {});
    for (const s of sockets) s.destroy();
    await Promise.all([udp && new Promise((r) => udp.close(r)), tcp && new Promise((r) => tcp.close(r)), health && new Promise((r) => health.close(r))]);
  }

  return { start, stop, ports, stats, engine, flush, drain, settle, refreshConfig, sweep, flushUnknown, handleText, nat };
}
