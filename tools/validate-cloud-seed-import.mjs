import { buildCloudSeedPayload } from "../frontend/src/domain/cloudSeed.js";
import { createCloudSeedImportStore } from "../frontend/src/domain/cloudSeedImportContract.js";

function makeSeed(name = "验证商品") {
  return buildCloudSeedPayload({
    format: "shopeers-local-backup",
    formatVersion: 1,
    applicationVersion: "0.1.0",
    workspaceId: "workspace-default",
    databaseVersion: 6,
    generatedAt: "2026-08-07T00:00:00.000Z",
    tables: {
      workspaces: [{ id: "workspace-default", name: "默认工作区", defaultCurrency: "CNY" }],
      products: [{ id: "P-CHECK", workspaceId: "workspace-default", name, currency: "CNY" }],
      platformSkus: [], supplierOffers: [], captures: [], ledgers: [], importBatches: [], salesRows: [],
      erpCostRequests: [], erpCostBatches: [], erpCostRows: [], costApprovals: [], profitLines: [], auditEvents: [], settings: [],
    },
  });
}

const store = createCloudSeedImportStore();
const seed = makeSeed();
const preflight = store.preflight(seed);
if (!preflight.canImport) throw new Error("种子包预检未通过。");
const receipt = await store.commit(seed, { preflightId: preflight.preflightId });
if (receipt.insertedCount !== 2) throw new Error(`预期写入 2 条记录，实际为 ${receipt.insertedCount}。`);

const repeated = store.preflight(makeSeed());
if (!repeated.canImport || !repeated.idempotent) throw new Error("相同工作区种子包幂等检查失败。");

const conflict = store.preflight(makeSeed("冲突验证商品"));
if (conflict.conflictCount !== 1 || conflict.canImport) throw new Error("主键冲突检查失败。");

console.log(JSON.stringify({
  status: "ok",
  insertedCount: receipt.insertedCount,
  repeatedIdempotent: repeated.idempotent,
  conflictCount: conflict.conflictCount,
}, null, 2));
