import { describe, it, expect, vi } from "vitest";
import { ensureAutoErpRequest, cancelAutoErpRequest } from "./autoErpRequest";

const input = () => ({ ledger: { id: crypto.randomUUID(), workspaceId: "W" }, platformSkcs: ["A", "B"], expectedSkus: [{ platformSku: "SKU", platformSkc: "A" }] });
function dependencies() {
  let saved;
  return { latest: vi.fn(async () => saved), save: vi.fn(async (request) => { saved = request; }), register: vi.fn(async () => ({ accepted: true, status: "registered" })) };
}
describe("automatic ERP request lifecycle", () => {
  it("serializes duplicate mounts and reuses one request", async () => {
    const scope = input(); const deps = dependencies();
    const [a, b] = await Promise.all([ensureAutoErpRequest(scope, deps), ensureAutoErpRequest(scope, deps)]);
    expect(a.id).toBe(b.id);
  });
  it("supersedes a changed scope and renews terminal requests", async () => {
    const scope = input(); const deps = dependencies();
    const a = await ensureAutoErpRequest(scope, deps);
    const b = await ensureAutoErpRequest({ ...scope, platformSkcs: ["A"] }, deps);
    expect(b.supersedesRequestId).toBe(a.id);
    deps.register.mockResolvedValueOnce({ accepted: true, status: "expired" });
    const c = await ensureAutoErpRequest({ ...scope, platformSkcs: ["A"] }, deps);
    expect(c.id).not.toBe(b.id);
  });
  it("cancels an in-flight stale acknowledgement before allowing the next scope", async () => {
    const scope = input(); const deps = dependencies(); let current = true;
    deps.register.mockImplementationOnce(async () => { current = false; return { accepted: true }; });
    expect(await ensureAutoErpRequest(scope, { ...deps, isCurrent: () => current })).toBeNull();
    expect(deps.register.mock.calls.at(-1)[0].request.cancel).toBe(true);
  });
  it("cancels the previous ledger association explicitly", async () => {
    const scope = input(); const deps = dependencies();
    const a = await ensureAutoErpRequest(scope, deps);
    await cancelAutoErpRequest(scope.ledger, deps);
    expect(deps.register.mock.calls.at(-1)[0].request).toMatchObject({ id: a.id, workspaceId: "W", cancel: true });
  });
  it("never reports an unacknowledged registration as ready", async () => {
    const deps = dependencies(); deps.register.mockResolvedValue({ accepted: false });
    await expect(ensureAutoErpRequest(input(), deps)).rejects.toThrow("尚未确认");
  });
  it("replaces the remote ledger scope after an intermediate offline local request", async () => {
    const scope = input(); const deps = dependencies();
    const r1 = await ensureAutoErpRequest({ ...scope, platformSkcs: ["A", "B", "C"] }, deps);
    deps.register.mockRejectedValueOnce(new Error("offline"));
    await expect(ensureAutoErpRequest(scope, deps)).rejects.toThrow("offline");
    const r3 = await ensureAutoErpRequest({ ...scope, platformSkcs: ["A"] }, deps);
    expect(r3.supersedesRequestId).not.toBe(r1.id);
    expect(deps.register.mock.calls.at(-1)[0].request).toMatchObject({ id: r3.id, replaceLedgerScope: true, workspaceId: "W", ledgerId: scope.ledger.id });
    await cancelAutoErpRequest(scope.ledger, deps);
    expect(deps.register.mock.calls.at(-1)[0].request).toMatchObject({ cancel: true, replaceLedgerScope: true });
  });
});
