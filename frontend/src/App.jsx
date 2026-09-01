import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { ToastProvider } from "./components/UI";
import { RuntimeConfigurationGate } from "./components/RuntimeConfigurationGate";
import { CloudAuthenticationGate, hasAuthenticatedCloudIdentity, useCloudAuthenticationState } from "./components/CloudAuthenticationGate";
import { MemberContextGate } from "./components/MemberContextGate";
import { DEFAULT_WORKSPACE_ID, getActiveMemberContext, receiveErpCostInboxEnvelope, receiveSelectionCaptureEnvelope } from "./data/database";
import { runSyncOnce } from "./data/syncRunner";
import { runtimeConfig } from "./config/runtimeConfig";
import { parseErpInboxMessage } from "./domain/erpInboxContract";
import { acknowledgeErpInbox, pollErpInbox } from "./lib/erpInboxTransport";
import { receiveAndAcknowledgeInboxRecord } from "./lib/inboxDelivery";
import { acknowledgeSelectionCapture, pollSelectionCaptureInbox, publishSelectionCaptureContext } from "./lib/selectionCaptureTransport";
import { getErpAssistantRouteTarget } from "./lib/desktopRuntime";

const CaptureQueue = lazy(() => import("./pages/CaptureQueue"));
const CostMatching = lazy(() => import("./pages/CostMatching"));
const DataSecurity = lazy(() => import("./pages/DataSecurity"));
const Diagnostics = lazy(() => import("./pages/Diagnostics"));
const ErpAssistantPage = lazy(() => import("./pages/ErpAssistantPage"));
const ImportPreview = lazy(() => import("./pages/ImportPreview"));
const MonthlyLedger = lazy(() => import("./pages/MonthlyLedger"));
const ProductEditor = lazy(() => import("./pages/ProductEditor"));
const ProductLibrary = lazy(() => import("./pages/ProductLibrary"));
const ProfitPanel = lazy(() => import("./pages/ProfitPanel"));
const WorkspacePortal = lazy(() => import("./pages/WorkspacePortal"));

function RouteLoader() {
  return <div className="route-loader" role="status"><LoaderCircle className="spin" size={24} /><span>正在加载工作区...</span></div>;
}

function ErpInboxListener() {
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const context = await getActiveMemberContext();
        const records = await pollErpInbox({ workspaceId: context.workspaceId });
        for (const record of records) {
          if (disposed) break;
          const parsed = parseErpInboxMessage(record.envelope);
          await receiveAndAcknowledgeInboxRecord({
            record,
            receive: () => receiveErpCostInboxEnvelope({ envelope: parsed.envelope, receivedVia: "desktop-inbox" }),
            acknowledge: () => acknowledgeErpInbox(record.deliveryId, { workspaceId: context.workspaceId }),
          });
          window.dispatchEvent(new CustomEvent("shopeers:erp-inbox-received", { detail: parsed.envelope }));
        }
      } catch {
        // The local inbox service is optional; manual import remains available when it is offline.
      }
    };
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
  return null;
}

function SelectionCaptureListener() {
  useEffect(() => {
    let disposed = false;
    let running = false;
    const poll = async () => {
      if (disposed || running) return;
      running = true;
      try {
        const context = await getActiveMemberContext();
        await publishSelectionCaptureContext({
          workspaceId: context.workspaceId,
          memberId: context.memberId,
          visibility: context.canSeeAllSelection ? "workspace" : "private",
        });
        const records = await pollSelectionCaptureInbox({
          workspaceId: context.workspaceId,
          memberId: context.memberId,
          includeAll: context.canSeeAllSelection,
          limit: 50,
        });
        for (const record of records) {
          if (disposed) break;
          const result = await receiveAndAcknowledgeInboxRecord({
            record,
            receive: () => receiveSelectionCaptureEnvelope({
              envelope: record.envelope,
              inboxRecord: record,
              receivedVia: "local-http",
            }),
            acknowledge: () => acknowledgeSelectionCapture(record.deliveryId, { workspaceId: context.workspaceId }),
          });
          window.dispatchEvent(new CustomEvent("shopeers:selection-capture-received", { detail: { ...result, deliveryId: record.deliveryId } }));
        }
      } catch {
        // 本地采集服务未启动时保持静默，手工登记仍可继续使用。
      } finally {
        running = false;
      }
    };
    poll();
    const timer = window.setInterval(poll, 4000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
  return null;
}

function CloudSyncListener() {
  const cloudAuth = useCloudAuthenticationState();

  useEffect(() => {
    const ready = runtimeConfig.autoSync
      && hasAuthenticatedCloudIdentity(runtimeConfig, cloudAuth.user);
    if (!ready) return undefined;
    let disposed = false;
    let running = false;
    const tick = async () => {
      if (disposed || running) return;
      running = true;
      try {
        const context = await getActiveMemberContext();
        const result = await runSyncOnce({ workspaceId: context.workspaceId || DEFAULT_WORKSPACE_ID });
        if (!disposed && result.status !== "idle") {
          window.dispatchEvent(new CustomEvent("shopeers:sync-result", { detail: result }));
        }
      } finally {
        running = false;
      }
    };
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [cloudAuth.user?.id]);
  return null;
}

export default function App() {
  const erpAssistantRouteTarget = getErpAssistantRouteTarget();
  return (
    <BrowserRouter>
      <ToastProvider>
        <RuntimeConfigurationGate>
          <CloudAuthenticationGate>
            <MemberContextGate>
              <ErpInboxListener />
              <SelectionCaptureListener />
              <CloudSyncListener />
              <Suspense fallback={<RouteLoader />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/workspace" replace />} />
                  <Route path="/workspace" element={<WorkspacePortal />} />
                  <Route path="/products" element={<ProductLibrary />} />
                  <Route path="/capture" element={<CaptureQueue />} />
                  <Route path="/products/edit" element={<ProductEditor />} />
                  <Route path="/profit" element={<ProfitPanel />} />
                  <Route path="/cost-matching" element={<CostMatching />} />
                  <Route path="/import-preview" element={<ImportPreview />} />
                  <Route path="/ledger" element={<MonthlyLedger />} />
                  <Route path="/data-security" element={<DataSecurity />} />
                  <Route path="/diagnostics" element={<Diagnostics />} />
                  <Route path="/erp-assistant" element={erpAssistantRouteTarget ? <Navigate to={erpAssistantRouteTarget} replace /> : <ErpAssistantPage />} />
                  <Route path="*" element={<Navigate to="/workspace" replace />} />
                </Routes>
              </Suspense>
            </MemberContextGate>
          </CloudAuthenticationGate>
        </RuntimeConfigurationGate>
      </ToastProvider>
    </BrowserRouter>
  );
}
