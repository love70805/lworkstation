// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import tls from "node:tls";
import pg from "pg";
import { buildSyncDatabaseConfig } from "../../../tools/sync-database-config.mjs";

const fixture = (name) => new URL(`./__fixtures__/tls/localhost-test-${name}.pem`, import.meta.url);
const certificate = readFileSync(fixture("cert"), "utf8");
const databaseEnv = { NODE_ENV: "production", SHOPEERS_DATABASE_URL: "postgres://test:test@localhost/test" };
let server;

function handshake(ssl, servername = "localhost") {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: "127.0.0.1", port: server.address().port, servername, ...ssl });
    socket.once("secureConnect", () => { const authorized = socket.authorized; socket.end(); resolve(authorized); });
    socket.once("error", (error) => { socket.destroy(); reject(error); });
  });
}

describe("database TLS configuration", () => {
  beforeAll(async () => {
    server = tls.createServer({ key: readFileSync(fixture("key")), cert: certificate }, (socket) => socket.end());
    server.on("tlsClientError", () => {});
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

  it("rejects an untrusted certificate and accepts the explicitly trusted CA during a real TLS handshake", async () => {
    const strict = new pg.Client(buildSyncDatabaseConfig(databaseEnv)).connectionParameters.ssl;
    await expect(handshake(strict)).rejects.toMatchObject({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    const config = buildSyncDatabaseConfig({ ...databaseEnv, SHOPEERS_DATABASE_CA_FILE: "synthetic-ca" }, {
      readCertificate: () => certificate,
    });
    const trusted = new pg.Client(config).connectionParameters.ssl;
    expect(trusted.rejectUnauthorized).toBe(true);
    await expect(handshake(trusted)).resolves.toBe(true);
    await expect(handshake(trusted, "wrong-host.invalid")).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  });

  it("prevents URL SSL options from replacing node-postgres certificate verification", () => {
    for (const mode of ["require", "verify-ca", "verify-full"]) {
      const config = buildSyncDatabaseConfig({ ...databaseEnv, SHOPEERS_DATABASE_URL: `${databaseEnv.SHOPEERS_DATABASE_URL}?sslmode=${mode}`,
        SHOPEERS_DATABASE_CA_FILE: "synthetic-ca" }, { readCertificate: () => certificate });
      expect(config.connectionString).not.toContain("sslmode");
      expect(new pg.Client(config).connectionParameters.ssl).toEqual({ rejectUnauthorized: true, ca: certificate });
    }
    for (const suffix of ["sslmode=disable", "sslmode=no-verify", "sslmode=prefer", "ssl=false", "sslrootcert=other", "sslcert=other",
      "sslkey=other", "uselibpqcompat=true", "sslmode=require&sslmode=disable", "host=remote.example"]) {
      expect(() => buildSyncDatabaseConfig({ ...databaseEnv, SHOPEERS_DATABASE_URL: `${databaseEnv.SHOPEERS_DATABASE_URL}?${suffix}` })).toThrow();
    }
  });

  it("allows plaintext only for local development and refuses global verification bypasses", () => {
    expect(buildSyncDatabaseConfig({ SHOPEERS_DATABASE_URL: databaseEnv.SHOPEERS_DATABASE_URL }).ssl).toBe(false);
    expect(buildSyncDatabaseConfig({ SHOPEERS_DATABASE_URL: "postgres://test:test@database.example/test" }).ssl).toEqual({ rejectUnauthorized: true });
    expect(() => buildSyncDatabaseConfig({ ...databaseEnv, SHOPEERS_DATABASE_SSL: "disable" })).toThrow();
    expect(() => buildSyncDatabaseConfig({ ...databaseEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" })).toThrow();
    expect(() => buildSyncDatabaseConfig({ ...databaseEnv, SHOPEERS_DATABASE_SSL: "typo" })).toThrow();
  });

  it("keeps Docker production packaging and local Compose aligned with the secure config", () => {
    const docker = readFileSync(new URL("../../../Dockerfile.sync", import.meta.url), "utf8");
    expect(docker).toContain("COPY tools/sync-database-config.mjs /app/tools/sync-database-config.mjs");
    const compose = readFileSync(new URL("../../../docker-compose.postgres.yml", import.meta.url), "utf8");
    expect(compose).toContain('"127.0.0.1:55432:5432"');
    expect(compose).toContain("${SHOPEERS_POSTGRES_PASSWORD:?");
    expect(compose).not.toContain("shopeers-dev-only");
  });
});
