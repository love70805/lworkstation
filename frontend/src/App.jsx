import { lazy, Suspense, useEffect } from "react";
import { createBrowserRouter, RouterProvider, Navigate, Route, Routes } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import LegacyCostRedirect from './components/LegacyCostRedirect';
import AppRouteError from './components/AppRouteError';
import { ToastProvider } from "./components/UI";
import { RuntimeConfigurationGate } from "./components/RuntimeConfigurationGate";
import { CloudAuthenticationGate, hasAuthenticatedCloudIdentity, useCloudAuthenticationState } from "./components/CloudAuthenticationGate";
import { MemberContextGate } from "./components/MemberContextGate";
import { DEFAULT_WORKSPACE_ID, getActiveMemberContext, receiveErpCostInboxEnvelope, recoverErpCostInboxAdoptions, receiveSelectionCaptureEnvelope } from "./data/database";
import { runSyncOnce } from "./data/syncRunner";
import { runtimeConfig } from "./config/runtimeConfig";
import { parseErpInboxMessage } from "./domain/erpInboxContract";
import { acknowledgeErpInbox, pollErpInbox } from "./lib/erpInboxTransport";
import { receiveAndAcknowledgeInboxRecord } from "./lib/inboxDelivery";
import { recoverCompleteErpCostDrafts } from "./lib/erpLegacyDraftRecovery";
import { acknowledgeSelectionCapture, pollSelectionCaptureInbox, publishSelectionCaptureContext } from "./lib/selectionCaptureTransport";
import { getErpAssistantRouteTarget } from "./lib/desktopRuntime";

const CaptureQueue = lazy(() => import("./pages/CaptureQueue"));
const DataSecurity = lazy(() => import("./pages/DataSecurity"));
const Diagnostics = lazy(() => import("./pages/Diagnostics"));
const ErpAssistantPage = lazy(() => import("./pages/ErpAssistantPage"));
const ImportPreview = lazy(() => import("./pages/ImportPreview"));
const MonthlyLedger = lazy(() => import("./pages/MonthlyLedger"));
const ProfitWorkspacePage = lazy(() => import("./pages/ProfitWorkspacePage"));
const ProductEditor = lazy(() => import("./pages/ProductEditor"));
const ProductLibrary = lazy(() => import("./pages/ProductLibrary"));

const WorkspacePortal = lazy(() => import("./pages/WorkspacePortal"));

function RouteLoader() {
  return <div className="route-loader" role="status"><LoaderCircle className="spin" size={24} /><span>正在加载工作区...</span></div>;
}

export async function runErpInboxCycle({
  isDisposed = () => false,
  getContext = getActiveMemberContext,
  pollRecords = pollErpInbox,
  parseRecord = parseErpInboxMessage,
  receive = receiveErpCostInboxEnvelope,
  acknowledge = acknowledgeErpInbox,
  recover = recoverErpCostInboxAdoptions,
  recoverDrafts = recoverCompleteErpCostDrafts,
  emit = (envelope) => window.dispatchEvent(new CustomEvent("shopeers:erp-inbox-received", { detail: envelope })),
} = {}) {
  const failures = [];
  let context;
  try { context = await getContext(); }
  catch (error) { return { received: 0, failures: [error], recovered: false }; }
  if (isDisposed()) return { received: 0, failures, recovered: false };

  let received = 0;
  try {
    const records = await pollRecords({ workspaceId: context.workspaceId });
    for (const record of records) {
      if (isDisposed()) break;
      try {
        const parsed = parseRecord(record.envelope);
        await receiveAndAcknowledgeInboxRecord({
          record,
          receive: () => receive({ envelope: parsed.envelope, receivedVia: "desktop-inbox" }),
          acknowledge: () => acknowledge(record.deliveryId, { workspaceId: context.workspaceId }),
        });
        received++;
        emit(parsed.envelope);
      } catch (error) {
        // One invalid or temporarily unavailable delivery must not block the rest.
        failures.push(error);
      }
    }
  } catch (error) {
    // The transport can be offline while previously acknowledged inbox data remains recoverable.
    failures.push(error);
  }

  if (isDisposed()) return { received, failures, recovered: false };
  try { await recoverDrafts({ workspaceId: context.workspaceId }); }
  catch (error) { failures.push(error); }
  try {
    await recover({ workspaceId: context.workspaceId });
    return { received, failures, recovered: true };
  } catch (error) {
    failures.push(error);
    return { received, failures, recovered: false };
  }
}

export function createErpInboxPoller(options = {}) {
  let running = false;
  return async () => {
    if (running || options.isDisposed?.()) return null;
    running = true;
    try { return await runErpInboxCycle(options); }
    finally { running = false; }
  };
}

function ErpInboxListener() {
  useEffect(() => {
    let disposed = false;
    const poll = createErpInboxPoller({ isDisposed: () => disposed });
    void poll();
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

function AppContent() {
  const erpAssistantRouteTarget = getErpAssistantRouteTarget();
  return (
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
                  <Route path="/profit" element={<ProfitWorkspacePage />} />
                  <Route path="/cost-matching" element={<LegacyCostRedirect />} />
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
  );
}

let appRouter;
export default function App() {
  // Construct once, including React StrictMode's repeated initial render.
  appRouter ??= createBrowserRouter([{ path: "*", element: <AppContent />, errorElement: <AppRouteError /> }]);
  return <RouterProvider router={appRouter} />;
}
