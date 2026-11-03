// Simulador de un equipo GPS para probar el receptor sin tener el aparato: manda un recorrido por la red con el formato real.
// Uso:  node simulate.js --host 127.0.0.1 --port 4031 --device 860012345678901 [--tcp] [--speedup 20] [--limit 120] [--kind CQ]
// El recorrido es de prueba (unos 130 km). Con --speedup 20 va 20 veces más rápido que en la realidad.
import { SimDevice } from "./sim-device.js";
import { drive, TEST_LINE } from "./sim-route.js";

const arg = (name, def) => { const i = process.argv.indexOf("--" + name); if (i < 0) return def; const v = process.argv[i + 1]; return v == null || v.startsWith("--") ? true : v; };
const host = arg("host", "127.0.0.1"), port = Number(arg("port", 4031)), device = String(arg("device", "860012345678901"));
const speedup = Number(arg("speedup", 20)), limit = Number(arg("limit", 0)), tcp = arg("tcp", false) === true, kind = String(arg("kind", "CQ"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const route = drive({ line: TEST_LINE, startMs: Date.now(), dwellAtStart: 60 });
const positions = limit ? route.slice(0, limit) : route;
const dev = await new SimDevice({ deviceId: device, host, port, transport: tcp ? "tcp" : "udp", kind }).connect();
console.log(`Simulando ${positions.length} posiciones de ${device} hacia ${host}:${port} por ${tcp ? "TCP" : "UDP"} (x${speedup})`);

let acked = 0, lost = 0;
const t0 = positions[0].t, begin = Date.now();
for (const p of positions) {
  const wait = (p.t - t0) / speedup - (Date.now() - begin);
  if (wait > 0) await sleep(wait);
  dev.send({ ...p, t: Date.now() }).then((r) => { if (r.acked) acked++; else lost++; });  // el equipo manda la hora actual
  if ((acked + lost) % 50 === 0 && acked + lost > 0) console.log(`confirmadas ${acked} · perdidas ${lost} · reenvíos ${dev.retransmits}`);
}
await sleep(9000);
console.log(`Fin. Confirmadas ${acked}, perdidas ${lost}, reenvíos ${dev.retransmits}`);
await dev.close();
process.exit(lost ? 1 : 0);
