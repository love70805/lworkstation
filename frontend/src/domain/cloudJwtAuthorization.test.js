import { describe, expect, it, vi } from "vitest";
import { createClaimsAuthorizer, createPostgresMembershipResolver, createTokenActorResolver, extractBearerToken } from "./cloudJwtAuthorization";

describe("JWT claims authorization", () => {
  it("extracts only Bearer tokens", () => {
    expect(extractBearerToken({ authorization: "Bearer token-1" })).toBe("token-1");
    expect(extractBearerToken({ authorization: "Basic token-1" })).toBe("");
    expect(extractBearerToken({})).toBe("");
  });

  it("derives the audit actor from the verified JWT subject", async () => {
    const resolver = createTokenActorResolver({ verifyToken: async (token) => ({ sub: token === "valid" ? "user-1" : "" }) });
    await expect(resolver("valid")).resolves.toBe("user-1");
    await expect(resolver("")).resolves.toBeNull();
  });

  it("verifies claims and checks active workspace role against event permissions", async () => {
    const verifyToken = vi.fn(async (token) => ({ sub: token === "valid" ? "user-1" : "" }));
    const resolveMembership = vi.fn(async () => ({ role: "finance", status: "active" }));
    const authorize = createClaimsAuthorizer({ verifyToken, resolveMembership });
    await expect(authorize({ workspaceId: "w1", token: "valid", actor: "user-1", operation: "audit_events", events: [{ action: "finalized", actorId: "user-1" }] })).resolves.toBe(true);
    await expect(authorize({ workspaceId: "w1", token: "valid", actor: "user-1", operation: "audit_events", events: [{ action: "product_updated", actorId: "user-1" }] })).resolves.toBe(false);
    expect(resolveMembership).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", workspaceId: "w1" }));
  });

  it("requires every permission declared by a business action", async () => {
    const authorizeFor = (role) => createClaimsAuthorizer({
      verifyToken: vi.fn(async () => ({ sub: "user-1" })),
      resolveMembership: vi.fn(async () => ({ role, status: "active" })),
    });
    const request = (action) => ({
      workspaceId: "w1",
      token: "valid",
      actor: "user-1",
      operation: "audit_events",
      events: [{ action, actorId: "user-1" }],
    });

    await expect(authorizeFor("operations")(request("voided"))).resolves.toBe(false);
    await expect(authorizeFor("operations")(request("reopened_for_cost_recalculation"))).resolves.toBe(false);
    await expect(authorizeFor("finance")(request("voided"))).resolves.toBe(true);
    await expect(authorizeFor("finance")(request("reopened_for_cost_recalculation"))).resolves.toBe(true);
    await expect(authorizeFor("admin")(request("voided"))).resolves.toBe(true);
    await expect(authorizeFor("admin")(request("reopened_for_cost_recalculation"))).resolves.toBe(true);
    await expect(authorizeFor("selection")(request("voided"))).resolves.toBe(false);
  });

  it("requires every event actor to equal the verified JWT subject", async () => {
    const authorize = createClaimsAuthorizer({
      verifyToken: vi.fn(async () => ({ sub: "user-real" })),
      resolveMembership: vi.fn(async () => ({ role: "finance", status: "active" })),
    });
    const request = (events) => ({
      workspaceId: "w1",
      token: "valid",
      actor: "user-real",
      operation: "audit_events",
      events,
    });
    await expect(authorize(request([
      { action: "voided", actorId: "user-real" },
      { action: "reopened_for_cost_recalculation", actorId: "user-real" },
    ]))).resolves.toBe(true);
    await expect(authorize(request([
      { action: "voided", actorId: "user-real" },
      { action: "reopened_for_cost_recalculation", actorId: "user-forged" },
    ]))).resolves.toBe(false);
    await expect(authorize(request([{ action: "voided" }]))).resolves.toBe(false);
  });

  it("rejects invalid, mismatched, and suspended identities", async () => {
    const authorize = createClaimsAuthorizer({
      verifyToken: vi.fn(async () => ({ sub: "user-1" })),
      resolveMembership: vi.fn(async ({ userId }) => userId === "user-1" ? { role: "admin", status: "suspended" } : null),
    });
    await expect(authorize({ workspaceId: "w1", token: "", actor: "user-1" })).resolves.toBe(false);
    await expect(authorize({ workspaceId: "w1", token: "valid", actor: "user-2" })).resolves.toBe(false);
    await expect(authorize({ workspaceId: "w1", token: "valid", actor: "user-1" })).resolves.toBe(false);
  });

  it("queries membership with workspace-scoped parameters", async () => {
    const query = vi.fn(async () => ({ rows: [{ role: "selection", status: "active" }] }));
    const resolve = createPostgresMembershipResolver({ query });
    await expect(resolve({ userId: "u1", workspaceId: "w1" })).resolves.toEqual({ role: "selection", status: "active" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("workspace_id = $1"), ["w1", "u1"]);
  });
});
