// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CostMatchingDeleteBatchDialog, CostMatchingInboxQueueDialog, CostMatchingVoidBatchDialog } from "./CostMatchingInboxDialogs";

const queueItems = [
  {
    inbox: {
      id: "INBOX-PENDING",
      batchId: "B-PENDING",
      requestId: "REQ-1",
      status: "pending",
      envelope: { sentAt: "2026-08-27T08:00:00.000Z", batch: { query: { platformSkcs: ["SKC-1"] } } },
    },
    scopeMatched: true,
    reason: "matched",
  },
  {
    inbox: {
      id: "INBOX-LOADED",
      batchId: "B-LOADED",
      requestId: "REQ-1",
      status: "loaded",
      envelope: { sentAt: "2026-08-27T09:00:00.000Z", batch: { query: { platformSkcs: ["SKC-1"] } } },
    },
    scopeMatched: true,
    reason: "matched",
  },
];

const history = [{
  id: "INBOX-APPLIED",
  batchId: "B-APPLIED",
  status: "applied",
  statusLabel: "已发布",
  appliedBatchId: "COST-1",
  historyAt: "2026-08-27T10:00:00.000Z",
  sourceLabel: "manual-v2-import",
}];

function Harness() {
  const [queueOpen, setQueueOpen] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [deleteIds, setDeleteIds] = useState([]);
  const [voidDraft, setVoidDraft] = useState(null);
  const openDelete = (ids) => { setQueueOpen(false); setDeleteIds(ids); };
  const cancelDelete = () => { setDeleteIds([]); setQueueOpen(true); };
  const openVoid = (inbox) => { setQueueOpen(false); setVoidDraft({ inbox, reason: "" }); };
  const cancelVoid = () => { setVoidDraft(null); setQueueOpen(true); };
  return <>
    <CostMatchingInboxQueueDialog
      open={queueOpen && deleteIds.length === 0 && !voidDraft}
      inboxQueue={{ items: queueItems, pendingCount: 1 }}
      processedInboxRecords={history}
      selectedPendingInboxIds={selected}
      loadedInboxId="INBOX-LOADED"
      accountingReadOnly={false}
      ledgerLocked={false}
      onClose={() => setQueueOpen(false)}
      onManualImport={() => setQueueOpen(false)}
      onTogglePending={(id, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; })}
      onDeleteSelected={openDelete}
      onLoadInbox={() => {}}
      onDeleteOne={(id) => openDelete([id])}
      onVoid={openVoid}
    />
    <CostMatchingDeleteBatchDialog ids={deleteIds} deleting={false} onCancel={cancelDelete} onConfirm={() => {}} />
    <CostMatchingVoidBatchDialog
      draft={voidDraft}
      voiding={false}
      ledgerStatus="finalized"
      onCancel={cancelVoid}
      onReasonChange={(reason) => setVoidDraft((current) => ({ ...current, reason }))}
      onConfirm={() => {}}
    />
  </>;
}

function findButton(container, text) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent.includes(text));
}

describe("CostMatching ERP inbox dialogs", () => {
  let container;
  let root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<Harness />); });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("keeps one modal owner across folded history, bulk delete, loaded delete, void reason and Escape", async () => {
    expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    const historyDetails = container.querySelector(".cost-inbox-history");
    expect(historyDetails.open).toBe(false);

    const pendingCheckbox = container.querySelector('input[aria-label="选择批次 B-PENDING"]');
    await act(async () => { pendingCheckbox.click(); });
    expect(findButton(container, "删除所选 1 个")).toBeTruthy();
    await act(async () => { findButton(container, "删除所选 1 个").click(); });
    expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(container.textContent).toContain("确认删除所选 1 个批次");

    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(container.textContent).toContain("ERP 回传待处理（1）");

    const loadedRow = [...container.querySelectorAll(".cost-inbox-item")].find((row) => row.textContent.includes("B-LOADED"));
    await act(async () => { findButton(loadedRow, "删除批次").click(); });
    expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(container.textContent).toContain("确认删除所选 1 个批次");
    await act(async () => { findButton(container, "取消").click(); });

    const summary = container.querySelector(".cost-inbox-history > summary");
    await act(async () => { summary.click(); });
    expect(container.querySelector(".cost-inbox-history").open).toBe(true);
    await act(async () => { findButton(container, "作废发布").click(); });
    expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(container.textContent).toContain("该账本已定稿");
    const confirmVoid = findButton(container, "确认作废并重新核算");
    expect(confirmVoid.disabled).toBe(true);
    const reason = container.querySelector("textarea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(reason, "月末复核发现成本错误");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
      reason.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(findButton(container, "确认作废并重新核算").disabled).toBe(false);

    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(container.textContent).toContain("ERP 回传待处理（1）");
  });
});
