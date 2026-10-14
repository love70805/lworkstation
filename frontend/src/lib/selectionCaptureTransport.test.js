import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeSelectionCapture,
  pollSelectionCaptureInbox,
} from "./selectionCaptureTransport";
import { setInboxTransportForTests } from "./inboxTransport";

afterEach(() => {
  setInboxTransportForTests(null);
  delete globalThis.window;
  vi.unstubAllGlobals();
});

describe("selection capture desktop transport", () => {
  it("fails closed without the trusted desktop runtime", async () => {
    await expect(pollSelectionCaptureInbox()).rejects.toMatchObject({ code: "INBOX_TRANSPORT_UNAVAILABLE" });
  });

  it("sends only controlled route data through the isolated preload seam", async () => {
    const requests = [];
    const requestInbox = vi.fn(async (request) => {
      requests.push(request);
      if (request.route === "/selection/v1/captures") {
        return { status: 200, body: { records: [{ deliveryId: "delivery-1", workspaceId: "workspace-a" }] } };
      }
      return { status: 200, body: { ok: true, records: [] } };
    });
    setInboxTransportForTests(requestInbox);

    await pollSelectionCaptureInbox({ workspaceId: "workspace-a", memberId: "member-a", includeAll: true, limit: 7 });
    await acknowledgeSelectionCapture("delivery-1");

    expect(requests).toEqual([
      {
        route: "/selection/v1/captures",
        method: "GET",
        query: { workspaceId: "workspace-a", memberId: "member-a", includeAll: true, limit: 7 },
        body: null,
      },
      { route: "/selection/v1/captures/ack", method: "POST", query: {}, body: { deliveryId: "delivery-1", workspaceId: "workspace-a" } },
    ]);
    expect(JSON.stringify(requests)).not.toMatch(/authorization|bearer|capability|127\.0\.0\.1/i);
  });

  it("binds ACK to the workspace returned by polling when no workspace is supplied", async () => {
    const requests = [];
    const requestInbox = vi.fn(async (request) => {
      requests.push(request);
      if (request.route === "/selection/v1/captures") {
        return { status: 200, body: { records: [{ deliveryId: "delivery-2", workspaceId: "workspace-b" }] } };
      }
      return { status: 204, body: null };
    });
    setInboxTransportForTests(requestInbox);

    await pollSelectionCaptureInbox();
    await acknowledgeSelectionCapture("delivery-2");

    expect(requests.at(-1)).toEqual({
      route: "/selection/v1/captures/ack",
      method: "POST",
      query: {},
      body: { deliveryId: "delivery-2", workspaceId: "workspace-b" },
    });
  });

  it("rejects controlled transport errors without falling back to direct fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setInboxTransportForTests(vi.fn(async () => ({ status: 401, body: { error: "UNAUTHORIZED", message: "denied" } })));

    await expect(pollSelectionCaptureInbox()).rejects.toThrow("denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
