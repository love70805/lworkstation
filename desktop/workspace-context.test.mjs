import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createWorkspaceContextCoordinator,
  configurationHttpResult,
  extensionLoadFailureState,
  normalizeConfigurationResult,
} = require("./workspace-context.cjs");

const contextA = { workspaceId: "workspace-a", memberId: "member-a", visibility: "workspace" };
const contextB = { workspaceId: "workspace-b", memberId: "member-b", visibility: "workspace" };
const targets = [
  { tabId: "erp", extensionId: "erp-id", session: {} },
  { tabId: "1688", extensionId: "selection-id", session: {} },
];

const zeroTargetCoordinator = createWorkspaceContextCoordinator();
const zeroTargetResult = await zeroTargetCoordinator.apply(contextA, [], async () => {
  throw new Error("zero targets must not configure");
});
assert.equal(zeroTargetResult.ok, false);
assert.equal(zeroTargetResult.committedContext, null);
assert.deepEqual(zeroTargetCoordinator.getCommittedContext(), null);
assert.deepEqual(zeroTargetCoordinator.getPendingContext(), contextA);
assert.deepEqual(normalizeConfigurationResult(zeroTargetResult), {
  ok: false,
  failures: [],
  committedContext: null,
});
assert.deepEqual(configurationHttpResult({ ok: false, failures: [] }), {
  ok: false,
  status: 503,
  body: {
    error: "INBOX_EXTENSION_CONFIGURATION_FAILED",
    message: "桌面扩展安全收件配置失败，请重试工作区上下文同步。",
  },
  failures: [],
});
assert.deepEqual(configurationHttpResult({ ok: true }), {
  ok: true,
  status: 200,
  body: null,
  failures: [],
});
let zeroTargetRetryCalls = 0;
const zeroTargetRetry = await zeroTargetCoordinator.apply(contextA, targets, async () => {
  zeroTargetRetryCalls += 1;
});
assert.equal(zeroTargetRetry.ok, true);
assert.equal(zeroTargetRetryCalls, 2);
assert.deepEqual(zeroTargetCoordinator.getCommittedContext(), contextA);

const calls = [];
let failSelection = true;
const coordinator = createWorkspaceContextCoordinator();
const configure = async (target, targetContext) => {
  calls.push(`${target.tabId}:${target.extensionId}`);
  if (target.tabId === "1688" && targetContext?.workspaceId === contextB.workspaceId && failSelection) throw new Error("selection unavailable");
};

failSelection = false;
assert.equal((await coordinator.apply(contextA, targets, configure)).ok, true);
assert.deepEqual(coordinator.getCommittedContext(), contextA);
const callsAfterA = calls.length;
assert.equal((await coordinator.apply(contextA, targets, configure)).shortCircuited, true);
assert.equal(calls.length, callsAfterA);

failSelection = true;
const failedB = await coordinator.apply(contextB, targets, configure);
assert.equal(failedB.ok, false);
assert.equal(coordinator.getState(targets).storageConfigured, true);
assert.deepEqual(coordinator.getCommittedContext(), contextA);
assert.deepEqual(coordinator.getPendingContext(), contextB);
assert.deepEqual(calls.slice(-2), ["erp:erp-id", "1688:selection-id"]);

failSelection = false;
const retryB = await coordinator.apply(contextB, targets, configure);
assert.equal(retryB.ok, true);
assert.deepEqual(coordinator.getCommittedContext(), contextB);
assert.ok(calls.filter((call) => call === "erp:erp-id").length >= 4);
assert.ok(calls.filter((call) => call === "1688:selection-id").length >= 4);

const firstFailure = createWorkspaceContextCoordinator();
let firstAttempt = true;
const firstTarget = [{ tabId: "erp", extensionId: "erp-id", session: {} }];
assert.equal((await firstFailure.apply(contextA, firstTarget, async () => {
  if (firstAttempt) { firstAttempt = false; throw new Error("first failure"); }
})).ok, false);
assert.deepEqual(firstFailure.getPendingContext(), contextA);
assert.equal((await firstFailure.apply(contextA, firstTarget, async () => {})).ok, true);
const rollbackFailure = createWorkspaceContextCoordinator();
assert.equal((await rollbackFailure.apply(contextA, firstTarget, async () => {})).ok, true);
const rollbackResult = await rollbackFailure.apply(contextB, firstTarget, async (_target, targetContext) => {
  if (targetContext?.workspaceId === contextB.workspaceId || targetContext?.workspaceId === contextA.workspaceId) throw new Error("rollback unavailable");
});
assert.equal(rollbackResult.ok, false);
assert.equal(rollbackResult.committedContext, null);
assert.ok(rollbackResult.failures.some((failure) => failure.phase === "rollback"));

coordinator.invalidate("erp");
assert.equal(coordinator.getState(targets).storageConfigured, false);
const failedExtension = extensionLoadFailureState(
  { status: "loading", path: "source" },
  { status: "loaded", id: "erp-id", name: "ERP", path: "runtime" },
  new Error("storage write failed"),
);
assert.equal(failedExtension.id, "erp-id");
assert.equal(failedExtension.path, "runtime");
assert.equal(failedExtension.status, "failed");
assert.deepEqual(normalizeConfigurationResult({ ok: false, failures: [] }), {
  ok: false,
  failures: [],
  committedContext: null,
});
console.log("desktop workspace context coordination tests passed");
