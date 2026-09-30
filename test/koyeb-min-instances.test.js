import test from "node:test";
import assert from "node:assert/strict";
import {
  KoyebScalingVerificationError,
  parseKoyebScaling,
  verifyKoyebServicePayload,
} from "../scripts/verifyKoyebMinInstances.js";

const serviceId = "5102061c-a0d2-4195-84d3-0f75b8b8eaa2";
const deploymentId = "93e95d1e-7549-4774-969d-868435ed7594";

function payload({ min = 1, secondMin = null, manual = [], activeId = deploymentId, deploymentServiceId = serviceId } = {}) {
  const scalings = [{ scopes: ["region:fra"], min, max: 2 }];
  if (secondMin !== null) scalings.push({ scopes: ["region:was"], min: secondMin, max: 2 });
  return {
    // The CLI service response contains metadata; scaling lives on the active deployment.
    service: { id: serviceId, name: "aims", active_deployment_id: activeId },
    deployment: { id: deploymentId, service_id: deploymentServiceId, definition: { scalings } },
    manualScaling: { scalings: manual },
  };
}

test("Koyeb gate accepts the active deployment's compliant scoped scaling", () => {
  const parsed = verifyKoyebServicePayload(payload(), serviceId);
  assert.equal(parsed.minimum, 1);
  assert.equal(parsed.deploymentId, deploymentId);
  assert.equal(parsed.serviceName, "aims");
});

test("Koyeb gate rejects any deployment scope that permits scale to zero", () => {
  assert.throws(
    () => verifyKoyebServicePayload(payload({ secondMin: 0 }), serviceId),
    (error) => error instanceof KoyebScalingVerificationError && error.code === "minimum_instances_non_compliant"
  );
});

test("Koyeb gate rejects a manual zero-instance override", () => {
  assert.throws(
    () => verifyKoyebServicePayload(payload({ manual: [{ scopes: ["region:fra"], instances: 0 }] }), serviceId),
    (error) => error.code === "minimum_instances_non_compliant"
  );
});

test("Koyeb gate rejects missing or mismatched active deployments", () => {
  for (const input of [payload({ activeId: "" }), payload({ activeId: "different" }), payload({ deploymentServiceId: "different" })]) {
    assert.throws(
      () => verifyKoyebServicePayload(input, serviceId),
      (error) => ["active_deployment_missing", "deployment_identity_mismatch"].includes(error.code)
    );
  }
});

test("Koyeb gate fails closed when the deployment has no scaling configuration", () => {
  const input = payload();
  delete input.deployment.definition.scalings;
  assert.throws(
    () => parseKoyebScaling(input),
    (error) => error.code === "scaling_configuration_missing"
  );
});

test("Koyeb gate rejects a different service identity", () => {
  assert.throws(
    () => verifyKoyebServicePayload(payload(), "another-service-id"),
    (error) => error.code === "service_identity_mismatch"
  );
});

test("Koyeb gate rejects malformed configured or manual instance counts", () => {
  assert.throws(
    () => parseKoyebScaling(payload({ min: "unknown" })),
    (error) => error.code === "scaling_minimum_invalid"
  );
  assert.throws(
    () => parseKoyebScaling(payload({ manual: [{ instances: "unknown" }] })),
    (error) => error.code === "manual_scaling_invalid"
  );
});
