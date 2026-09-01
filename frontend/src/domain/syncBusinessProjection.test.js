import { describe, expect, it } from "vitest";
import { listBusinessProjectionGaps, projectSyncEvent } from "./syncBusinessProjection";

describe("business sync projection", () => {
  it("projects a complete snapshot into a typed entity", () => {
    expect(projectSyncEvent({
      eventId: "E-1",
      objectId: "P-1",
      action: "product_updated",
      after: { platformSkuCount: 2, snapshot: { id: "P-1", name: "耳机" } },
    })).toMatchObject({
      kind: "business",
      entityType: "product",
      operation: "upsert",
      entityId: "P-1",
      snapshot: { id: "P-1", name: "耳机" },
      complete: true,
    });
  });

  it("keeps unknown actions as audit-only", () => {
    expect(projectSyncEvent({ action: "backup_exported", objectId: "B-1", after: {} })).toMatchObject({ kind: "audit_only" });
  });

  it("reports legacy summary-only business events as projection gaps", () => {
    expect(listBusinessProjectionGaps([{ eventId: "E-2", action: "product_created", objectId: "P-2", after: { platformSkuCount: 1 } }])).toEqual([
      { eventId: "E-2", action: "product_created", entityType: "product", entityId: "P-2" },
    ]);
  });

  it("treats delete events as complete without requiring a snapshot", () => {
    const event = { eventId: "E-3", action: "deleted", objectId: "LEDGER-1", after: null };
    expect(projectSyncEvent(event)).toMatchObject({ operation: "delete", complete: true });
    expect(listBusinessProjectionGaps([event])).toEqual([]);
  });

  it("projects a confirmed catalog cost as its own auditable business entity", () => {
    expect(projectSyncEvent({
      eventId: "E-COST-1", objectId: "MANUAL-1", action: "catalog_manual_cost_confirmed",
      after: { snapshot: { catalogManualCost: { id: "MANUAL-1", platformSku: "SKU-1", amount: 8.6 } } },
    })).toMatchObject({ kind: "business", entityType: "catalog_manual_cost", operation: "upsert", entityId: "MANUAL-1", complete: true });
  });

  it("projects a saved sales-status configuration as a workspace update", () => {
    expect(projectSyncEvent({
      eventId: "E-STATUS-1", objectId: "workspace-default", action: "selection_status_definitions_updated",
      after: { snapshot: { id: "workspace-default", selectionStatusDefinitions: [{ id: "on_sale", label: "在售" }] } },
    })).toMatchObject({ kind: "business", entityType: "workspace", operation: "upsert", entityId: "workspace-default", complete: true });
  });

  it("projects ERP voiding and finalized-ledger reopening as business updates", () => {
    expect(projectSyncEvent({
      eventId: "E-VOID", objectType: "erp_cost_batch", objectId: "C-1", action: "voided",
      after: { snapshot: { costBatch: { id: "C-1", status: "voided" }, ledger: { id: "L-1", status: "cost_pending" } } },
    })).toMatchObject({ kind: "business", entityType: "erp_cost_batch", operation: "upsert", complete: true });
    expect(projectSyncEvent({
      eventId: "E-REOPEN", objectType: "monthly_ledger", objectId: "L-1", action: "reopened_for_cost_recalculation",
      after: { snapshot: { id: "L-1", status: "cost_pending" } },
    })).toMatchObject({ kind: "business", entityType: "monthly_ledger", operation: "upsert", snapshot: { id: "L-1", status: "cost_pending" }, complete: true });
  });

  it("projects a manual SKC merge into deletes, a composite product upsert, and relinked facts", () => {
    expect(projectSyncEvent({ eventId: "E-DELETE", objectId: "P-SOURCE", action: "product_deleted", after: null }))
      .toMatchObject({ entityType: "product", operation: "delete", complete: true });
    expect(projectSyncEvent({
      eventId: "E-MERGE", objectId: "P-PRIMARY", action: "product_merged",
      after: { snapshot: { product: { id: "P-PRIMARY" }, platformSkus: [], supplierOffers: [] } },
    })).toMatchObject({ entityType: "product", operation: "upsert", complete: true });
    expect(projectSyncEvent({
      eventId: "E-RELINK", objectId: "MC-1", action: "catalog_manual_cost_relinked",
      after: { snapshot: { catalogManualCost: { id: "MC-1", productId: "P-PRIMARY" } } },
    })).toMatchObject({ entityType: "catalog_manual_cost", operation: "upsert", complete: true });
  });
});
