import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SENSOR_SEND_INTERVAL_MS } from "./SendRate.ts";

test("the phone sender uses one timer limiter configured for 60 Hz", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./PhoneMotionController.ts", import.meta.url)),
    "utf8",
  );
  assert.equal(source.includes("lastSentAt"), false, "no second send throttle");
  assert.match(
    source,
    /setInterval\(\s*\(\) => this\.publishLatestOrientation\(\)\s*,\s*SENSOR_SEND_INTERVAL_MS\s*,\s*\)/s,
  );

  const configuredRate = 1_000 / SENSOR_SEND_INTERVAL_MS;
  assert.ok(
    Math.abs(configuredRate - 60) < 0.001,
    `configured ${configuredRate.toFixed(2)} Hz`,
  );

  assert.equal(
    Math.round(1_000 / SENSOR_SEND_INTERVAL_MS),
    60,
    "one configured interval targets 60 ticks/sec",
  );
});
