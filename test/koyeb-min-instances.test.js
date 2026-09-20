import test from "node:test";
import assert from "node:assert/strict";
import {
  KoyebScalingVerificationError,
  parseKoyebScaling,
  verifyKoyebServicePayload,
} from "../scripts/verifyKoyebMinInstances.js";

function payload({ name = "AIMS", app = "production", min = 1, secondMin = null } = {}) {
  const scalings = [{ scopes: ["region:fra"], min, max: 2 }];
  if (secondMin !== null) scalings.push({ scopes: ["region:was"], min: secondMin, max: 2 });
  return { service: { id: "svc-123", app: { name: app }, definition: { name, scalings } } };
}

test("Koyeb minimum-instance parser accepts compliant scoped scaling", () => {
  const parsed = verifyKoyebServicePayload(payload(), "production/AIMS");
  assert.equal(parsed.minimum, 1);
  assert.equal(parsed.serviceName, "AIMS");
});

test("Koyeb minimum-instance gate fails closed when any scope permits scale to zero", () => {
  assert.throws(
    () => verifyKoyebServicePayload(payload({ min: 1, secondMin: 0 }), "production/AIMS"),
    (error) => error instanceof KoyebScalingVerificationError && error.code === "minimum_instances_non_compliant"
  );
});

test("Koyeb minimum-instance parser rejects missing scaling configuration", () => {
  assert.throws(
    () => parseKoyebScaling({ service: { definition: { name: "AIMS" } } }),
    (error) => error.code === "scaling_configuration_missing"
  );
});

test("Koyeb minimum-instance gate rejects a different service identity", () => {
  assert.throws(
    () => verifyKoyebServicePayload(payload({ name: "other" }), "production/AIMS"),
    (error) => error.code === "service_identity_mismatch"
  );
});

test("Koyeb minimum-instance parser rejects malformed minimum values", () => {
  assert.throws(
    () => parseKoyebScaling({ service: { definition: { name: "AIMS", scalings: [{ min: "unknown" }] } } }),
    (error) => error.code === "scaling_minimum_invalid"
  );
});
