import { describe, expect, it, vi } from "vitest";
import { buildCloudSeedPayload } from "../domain/cloudSeed";
import { createCloudSeedProvider, createHttpCloudSeedProvider } from "./cloudSeedProvider";

function seed() {
  return buildCloudSeedPayload({
    format: "shopeers-local-backup",
    formatVersion: 1,
    workspaceId: "workspace-default",
    tables: {
      workspaces: [{ id: "workspace-default", defaultCurrency: "CNY" }],
      settings: [],
    },
  });
}

describe("cloud seed provider", () => {
  it("执行预检和确认导入两个独立请求", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          format: "shopeers-cloud-seed-preflight",
          formatVersion: 1,
          workspaceId: "workspace-default",
          preflightId: "PF-1",
          canImport: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          format: "shopeers-cloud-seed-import-ack",
          formatVersion: 1,
          workspaceId: "workspace-default",
          importVersion: "seed-1",
        }),
      });
    const provider = createHttpCloudSeedProvider({ baseUrl: "http://127.0.0.1:8787", fetchImpl });
    const payload = seed();
    const preflight = await provider.preflight(payload);
    await provider.commit(payload, preflight.preflightId);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://127.0.0.1:8787/sync/v1/cloud-seeds/preflight");
    expect(fetchImpl.mock.calls[1][0]).toBe("http://127.0.0.1:8787/sync/v1/cloud-seeds/import");
  });

  it("保留服务端冲突详情并阻止本机模式误上传", async () => {
    const provider = createHttpCloudSeedProvider({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: async () => ({
        ok: false,
        status: 409,
        json: async () => ({ error: { code: "SEED_CONFLICT", message: "存在冲突", conflicts: [{ table: "products" }] } }),
      }),
    });
    await expect(provider.preflight(seed())).rejects.toMatchObject({ code: "SEED_CONFLICT", conflicts: [{ table: "products" }] });
    expect(() => createCloudSeedProvider({ syncProvider: "local", cloudConfigured: false })).toThrow("本机模式");
  });
});
