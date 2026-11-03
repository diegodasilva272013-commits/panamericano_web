import test from "node:test";
import assert from "node:assert/strict";
import { compactBatch } from "../batch.js";

test("la llegada y la salida de una parada, en un mismo lote, se funden en una fila con todos los datos", () => {
  const b = compactBatch({ stops: [{ tripId: "t", idx: 1, arrivedAt: "A", status: "pendiente" }, { tripId: "t", idx: 1, departedAt: "D", dwellS: 60, status: "ok" }, { tripId: "t", idx: 2, status: "pendiente" }] });
  assert.equal(b.stops.length, 2);
  assert.deepEqual(b.stops[0], { tripId: "t", idx: 1, arrivedAt: "A", departedAt: "D", dwellS: 60, status: "ok" });
});

test("una alerta actualizada varias veces queda una vez, con lo último y el cierre que ya tenía", () => {
  const b = compactBatch({ alerts: [{ vehicleId: "v", key: "k", detail: "91", endedAt: "X" }, { vehicleId: "v", key: "k", detail: "104" }, { vehicleId: "v", key: "otra", detail: "a" }] });
  assert.equal(b.alerts.length, 2);
  assert.equal(b.alerts[0].detail, "104"); assert.equal(b.alerts[0].endedAt, "X");
});

test("no toca posiciones ni eventos (cada uno es único)", () => {
  const pos = [{ t: 1 }, { t: 1 }], events = [{ a: 1 }, { a: 1 }];
  const b = compactBatch({ positions: pos, events });
  assert.equal(b.positions.length, 2); assert.equal(b.events.length, 2);
});
