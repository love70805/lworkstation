import { describe, expect, it } from "vitest";
import {
  buildCloudSeedPayload,
  CLOUD_SEED_FORMAT,
  validateCloudSeedPayload,
} from "./cloudSeed";

const backup = {
  format: "shopeers-local-backup",
  formatVersion: 1,
  applicationVersion: "0.1.0",
  workspaceId: "workspace-default",
  databaseVersion: 6,
  generatedAt: "2026-08-07T00:00:00.000Z",
  tables: {
    workspaces: [{ id: "workspace-default", workspaceId: "workspace-default", defaultCurrency: "CNY" }],
    platformSkus: [{ id: "S-1", workspaceId: "workspace-default", platformSku: "SKU-A" }],
    auditEvents: [{ id: 1, workspaceId: "workspace-default", action: "created", syncState: "pending", syncAttempts: 2 }],
    settings: [{ key: "lastBackupExport", value: { fileName: "secret-local.json" } }],
  },
};

describe("cloud seed", () => {
  it("只保留业务表并清理本机同步字段", () => {
    const seed = buildCloudSeedPayload(backup, { generatedAt: "2026-08-08T00:00:00.000Z" });
    expect(seed.format).toBe(CLOUD_SEED_FORMAT);
    expect(seed.tables.settings).toBeUndefined();
    expect(seed.tables.auditEvents[0]).not.toHaveProperty("syncState");
    expect(seed.tables.auditEvents[0]).not.toHaveProperty("syncAttempts");
    expect(seed.excludedTables).toContain("settings");
  });

  it("拒绝跨工作区记录和非人民币种子包", () => {
    expect(() => buildCloudSeedPayload({ ...backup, tables: { ...backup.tables, products: [{ workspaceId: "other" }] } })).toThrow("跨工作区");
    const seed = buildCloudSeedPayload(backup);
    expect(() => validateCloudSeedPayload({ ...seed, currency: "USD" })).toThrow("人民币");
  });
});
