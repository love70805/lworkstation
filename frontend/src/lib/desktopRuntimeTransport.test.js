import { afterEach, describe, expect, it, vi } from "vitest";
import { acknowledgeErpInbox, getErpRequestHistory, pollErpInbox, registerErpBridgeRequest } from "./erpInboxTransport";
import { requestInbox, setInboxTransportForTests } from "./inboxTransport";
import { acknowledgeSelectionCapture, pollSelectionCaptureInbox } from "./selectionCaptureTransport";

afterEach(() => {
  setInboxTransportForTests(null);
  delete globalThis.window;
  vi.unstubAllGlobals();
});

describe("desktop runtime inbox transport", () => {
  it("fails closed outside the desktop runtime instead of fetching localhost", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestInbox({ route: "/erp/v1/status" })).rejects.toMatchObject({
      code: "INBOX_TRANSPORT_UNAVAILABLE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only route, method, query, and body through the isolated preload", async () => {
    const requestInboxMock = vi.fn(async () => ({ status: 200, body: { records: [] } }));
    globalThis.window = { shopeersDesktopRuntime: { requestInbox: requestInboxMock } };

    await pollErpInbox({ workspaceId: "workspace-a", ledgerId: "ledger-a", limit: 7 });
    expect(requestInboxMock).toHaveBeenCalledWith({
      route: "/erp/v1/cost-batches",
      method: "GET",
      query: { workspaceId: "workspace-a", ledgerId: "ledger-a", limit: 7 },
      body: null,
    });
    expect(JSON.stringify(requestInboxMock.mock.calls)).not.toMatch(/authorization|bearer|capability|127\.0\.0\.1/i);
  });

  it("supports an explicit test seam for ERP and selection requests", async () => {
    const requests = [];
    setInboxTransportForTests(async (request) => {
      requests.push(request);
      return { status: 200, body: request.route.includes("selection") ? { records: [] } : { accepted: true } };
    });

    await registerErpBridgeRequest({
      request: { id: "request-a", workspaceId: "workspace-a", platformSkcs: [{ platformSkc: "SKC-A" }] },
      expectedSkus: [],
    });
    await getErpRequestHistory({ workspaceId: "workspace-a" });
    await pollSelectionCaptureInbox({ workspaceId: "workspace-a", memberId: "member-a" });

    expect(requests).toEqual([
      {
        route: "/erp/v1/requests",
        method: "POST",
        query: {},
        body: {
          request: { id: "request-a", workspaceId: "workspace-a", platformSkcs: [{ platformSkc: "SKC-A" }] },
          expectedSkus: [],
        },
      },
      {
        route: "/erp/v1/requests",
        method: "GET",
        query: { workspaceId: "workspace-a", includeHistory: true },
        body: null,
      },
      {
        route: "/selection/v1/captures",
        method: "GET",
        query: { workspaceId: "workspace-a", memberId: "member-a", includeAll: null, limit: 50 },
        body: null,
      },
    ]);
  });

  it("binds acknowledgements to the workspace returned by the controlled poll", async () => {
    const requests = [];
    setInboxTransportForTests(async (request) => {
      requests.push(request);
      if (request.route === "/erp/v1/cost-batches" && request.method === "GET") {
        return { status: 200, body: { records: [{ deliveryId: "erp-delivery", workspaceId: "workspace-erp" }] } };
      }
      if (request.route === "/selection/v1/captures" && request.method === "GET") {
        return { status: 200, body: { records: [{ deliveryId: "selection-delivery", workspaceId: "workspace-selection" }] } };
      }
      return { status: 200, body: { acknowledged: true } };
    });

    await pollErpInbox({ workspaceId: "workspace-erp" });
    await acknowledgeErpInbox("erp-delivery");
    await pollSelectionCaptureInbox({ workspaceId: "workspace-selection" });
    await acknowledgeSelectionCapture("selection-delivery");

    expect(requests.at(1).body).toEqual({
      deliveryId: "erp-delivery",
      workspaceId: "workspace-erp",
      status: "acknowledged",
    });
    expect(requests.at(3).body).toEqual({
      deliveryId: "selection-delivery",
      workspaceId: "workspace-selection",
    });
  });

  it("rejects unsupported routes, methods, malformed responses, and authenticated transport errors", async () => {
    setInboxTransportForTests(async () => ({ status: 401, body: { error: "UNAUTHORIZED", message: "denied" } }));
    await expect(requestInbox({ route: "/erp/v1/status" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    setInboxTransportForTests(async () => null);
    await expect(requestInbox({ route: "/erp/v1/status" })).rejects.toMatchObject({
      code: "INVALID_INBOX_RESPONSE",
    });
    setInboxTransportForTests(async () => ({ body: { records: [] } }));
    await expect(requestInbox({ route: "/erp/v1/status" })).rejects.toMatchObject({
      code: "INVALID_INBOX_RESPONSE",
    });
    await expect(requestInbox({ route: "http://127.0.0.1:8790/erp/v1/status" })).rejects.toMatchObject({
      code: "INVALID_INBOX_ROUTE",
    });
    await expect(requestInbox({ route: "/erp/v1/status", method: "DELETE" })).rejects.toMatchObject({
      code: "INVALID_INBOX_METHOD",
    });
  });
});
