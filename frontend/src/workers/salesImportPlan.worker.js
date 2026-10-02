import { materializeImportPlan } from "../lib/salesImportMaterialize";
import { prepareSalesImportItems } from "../domain/batchSalesImport";

self.onmessage = async ({ data }) => {
  try {
    const result = data.task === "prepare" ? prepareSalesImportItems(data.items, { period: data.period }) : await materializeImportPlan(data.input);
    self.postMessage({ result });
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "导入概览计算失败。" }); }
};
