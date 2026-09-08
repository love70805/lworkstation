// @vitest-environment node
import http from "node:http";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClaimsAuthorizer, createTokenActorResolver } from "./cloudJwtAuthorization.js";

// Match the production entrypoint's dependency loading and real JWKS transport.
const requireFrontendDependency = createRequire(new URL("../../package.json", import.meta.url));
const { createRemoteJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } = requireFrontendDependency("jose");
const issuer = "https://shopeers.example.test/auth/v1";
const audience = "authenticated";
const keyPairs = new Map();
let server;
let verifyToken;

async function signToken({ algorithm = "ES256", tokenIssuer = issuer, tokenAudience = audience, expires = "2m" } = {}) {
  return new SignJWT({})
    .setProtectedHeader({ alg: algorithm, kid: `qa-${algorithm}` })
    .setSubject("user-1")
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(keyPairs.get(algorithm).privateKey);
}

beforeAll(async () => {
  const keys = [];
  for (const algorithm of ["ES256", "RS256"]) {
    const pair = await generateKeyPair(algorithm);
    keyPairs.set(algorithm, pair);
    keys.push({ ...await exportJWK(pair.publicKey), kid: `qa-${algorithm}`, alg: algorithm, use: "sig" });
  }
  server = http.createServer((request, response) => {
    if (request.url !== "/jwks.json") return response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const jwks = createRemoteJWKSet(new URL(`http://127.0.0.1:${server.address().port}/jwks.json`));
  verifyToken = async (token) => (await jwtVerify(token, jwks, { issuer, audience })).payload;
});

afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("real JWT signatures and remote JWKS", () => {
  it.each(["ES256", "RS256"])("verifies %s and derives the authorized actor", async (algorithm) => {
    const token = await signToken({ algorithm });
    const resolveMembership = vi.fn(async () => ({ role: "admin", status: "active" }));
    const authorize = createClaimsAuthorizer({ verifyToken, resolveMembership });
    const actor = await createTokenActorResolver({ verifyToken })(token);
    expect(actor).toBe("user-1");
    await expect(authorize({ workspaceId: "w1", token, actor, operation: "audit_events", events: [{ action: "product_updated", actorId: actor }] })).resolves.toBe(true);
    expect(resolveMembership).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", workspaceId: "w1" }));
  });

  it.each(["expired", "wrong issuer", "wrong audience", "invalid signature"])("rejects %s before membership lookup", async (scenario) => {
    let token = await signToken({
      ...(scenario === "expired" ? { expires: Math.floor(Date.now() / 1000) - 60 } : {}),
      ...(scenario === "wrong issuer" ? { tokenIssuer: "https://wrong.example.test" } : {}),
      ...(scenario === "wrong audience" ? { tokenAudience: "another-application" } : {}),
    });
    if (scenario === "invalid signature") {
      const parts = token.split(".");
      parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
      token = parts.join(".");
    }
    const resolveMembership = vi.fn(async () => ({ role: "admin", status: "active" }));
    const authorize = createClaimsAuthorizer({ verifyToken, resolveMembership });
    await expect(authorize({ workspaceId: "w1", token, actor: "user-1", operation: "audit_events", events: [{ action: "product_updated", actorId: "user-1" }] })).resolves.toBe(false);
    expect(resolveMembership).not.toHaveBeenCalled();
  });
});
