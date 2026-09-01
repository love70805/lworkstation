import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildInboxUrl,
  enforceWorkspaceContext,
  normalizeInboxRequest,
  normalizeWorkspaceContext,
} = require("./inbox-ipc.cjs");

assert.deepEqual(normalizeInboxRequest({ route: "/erp/v1/status" }), {
  route: "/erp/v1/status", method: "GET", query: {}, body: null,
});
assert.deepEqual(normalizeInboxRequest({ route: "/selection/v1/context", method: "post", body: { ok: true } }), {
  route: "/selection/v1/context", method: "POST", query: {}, body: { value: { ok: true }, serialized: '{"ok":true}' },
});
assert.equal(buildInboxUrl(29876, normalizeInboxRequest({ route: "/erp/v1/status", query: { workspaceId: "w-1" } })).href,
  "http://127.0.0.1:29876/erp/v1/status?workspaceId=w-1");
for (const route of ["https://127.0.0.1/erp/v1/status", "//127.0.0.1/erp/v1/status", "/erp/v1/../status", "/unknown/status"]) {
  assert.throws(() => normalizeInboxRequest({ route }), /本机收件路由/);
}
assert.throws(() => normalizeInboxRequest({ route: "/erp/v1/status", method: "DELETE" }), /方法/);
assert.throws(() => normalizeInboxRequest({ route: "/erp/v1/status", method: "POST", body: {} }), /路由与方法/);
assert.throws(() => normalizeInboxRequest({ route: "/erp/v1/unknown", method: "GET" }), /路由/);
assert.throws(() => normalizeInboxRequest({ route: "/erp/v1/status", body: { value: "x" } }), /GET/);
assert.throws(() => normalizeInboxRequest({ route: "/erp/v1/status", method: "POST", body: BigInt(1) }), /JSON/);
assert.throws(() => normalizeInboxRequest({ route: "/erp/v1/status", method: "POST", body: { value: "x".repeat(5 * 1024 * 1024) } }), /过大/);
assert.deepEqual(normalizeWorkspaceContext({ workspaceId: "workspace-1", memberId: "member-1", visibility: "workspace" }), {
  workspaceId: "workspace-1", memberId: "member-1", visibility: "workspace",
});
assert.throws(() => normalizeWorkspaceContext({ workspaceId: "", memberId: "m", visibility: "workspace" }), /上下文/);
const committed = { workspaceId: "workspace-a", memberId: "member-a", visibility: "workspace" };
const batchRequest = normalizeInboxRequest({
  route: "/erp/v1/cost-batches",
  method: "POST",
  body: { batch: { workspaceId: "workspace-a", memberId: "attacker", deliveryId: "d1" } },
});
assert.throws(() => enforceWorkspaceContext(batchRequest, committed), /成员/);
const mismatchedBatch = normalizeInboxRequest({
  route: "/erp/v1/cost-batches",
  method: "POST",
  body: { batch: { workspaceId: "workspace-other", deliveryId: "d2" } },
});
assert.throws(() => enforceWorkspaceContext(mismatchedBatch, committed), /工作区/);
const derivedBatch = enforceWorkspaceContext(normalizeInboxRequest({
  route: "/erp/v1/cost-batches",
  method: "POST",
  body: { batch: { deliveryId: "d3" } },
}), committed);
assert.equal(derivedBatch.body.value.workspaceId, "workspace-a");
assert.equal(derivedBatch.body.value.memberId, "member-a");
assert.equal(derivedBatch.body.value.batch.workspaceId, "workspace-a");
assert.equal(derivedBatch.body.value.batch.memberId, "member-a");
assert.throws(() => enforceWorkspaceContext(normalizeInboxRequest({
  route: "/selection/v1/captures",
  method: "POST",
  body: { workspaceId: "workspace-a", ownerId: "attacker", payload: { skc: "SKC-1" } },
}), committed), /成员/);
const derivedCapture = enforceWorkspaceContext(normalizeInboxRequest({
  route: "/selection/v1/captures",
  method: "POST",
  body: { workspaceId: "workspace-a", payload: { skc: "SKC-1" } },
}), committed);
assert.equal(derivedCapture.body.value.ownerId, "member-a");
assert.equal(derivedCapture.body.value.memberId, "member-a");
console.log("desktop inbox IPC contract tests passed");
