import { getEventListeners } from "node:events";
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

describe("poll cancellation lifetime", () => {
  const request = { route: "/erp/v1/collection-tasks" };
  it("releases every completed response from a controller reused by repeated polls", async () => {
    const controller = new AbortController();
    setInboxTransportForTests(async () => ({ status: 200, body: { tasks: [{ id: "task-a" }] } }));
    for (let index = 0; index < 200; index++) {
      expect(await requestInbox(request, { signal: controller.signal })).toEqual({ tasks: [{ id: "task-a" }] });
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    }
    expect(controller.signal.aborted).toBe(false);
  });

  it.each(["transport rejection", "HTTP rejection", "invalid response"])("releases the listener after %s", async mode => {
    const controller = new AbortController();
    setInboxTransportForTests(async () => {
      if (mode === "transport rejection") throw new Error("offline");
      return mode === "HTTP rejection" ? { status: 503, body: { error: "OFFLINE" } } : null;
    });
    await expect(requestInbox(request, { signal: controller.signal })).rejects.toBeInstanceOf(Error);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("removes only the completed poll and still cancels other requests sharing the signal", async () => {
    const controller = new AbortController();
    let completeFirst, rejectSecond;
    setInboxTransportForTests(() => new Promise(resolve => { completeFirst = resolve; }));
    const first = requestInbox(request, { signal: controller.signal });
    setInboxTransportForTests(() => new Promise((_resolve, reject) => { rejectSecond = reject; }));
    const second = requestInbox(request, { signal: controller.signal });
    const cancelled = expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(2);
    completeFirst({ status: 200, body: { tasks: [] } });
    await expect(first).resolves.toEqual({ tasks: [] });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
    controller.abort(); await cancelled;
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    rejectSecond(new Error("late transport failure"));
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it("does not start a transport for an already cancelled request", async () => {
    const controller = new AbortController(); const reason = new Error("left page");
    controller.abort(reason);
    const transport = vi.fn(); setInboxTransportForTests(transport);
    await expect(requestInbox(request, { signal: controller.signal })).rejects.toBe(reason);
    expect(transport).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("handles a transport that aborts synchronously and then rejects", async () => {
    const controller = new AbortController(); const reason = new Error("scope changed");
    setInboxTransportForTests(() => { controller.abort(reason); return Promise.reject(reason); });
    await expect(requestInbox(request, { signal: controller.signal })).rejects.toBe(reason);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
