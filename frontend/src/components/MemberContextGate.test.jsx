// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberContextGateController } from "./MemberContextGate";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cloudAuth(memberId) {
  return {
    loading: false,
    user: memberId ? { id: memberId, app_metadata: { role: "finance" } } : null,
  };
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("active member context startup gate", () => {
  it("blocks listeners until context write succeeds and blocks again during account switch", async () => {
    const firstWrite = deferred();
    const secondWrite = deferred();
    const setContext = vi.fn()
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <MemberContextGateController
          auth={cloudAuth("finance-new")}
          config={{ runtimeMode: "cloud-ready", cloudConfigured: true }}
          setContext={setContext}
        >
          <div data-listener="mounted">listeners mounted</div>
        </MemberContextGateController>,
      );
    });
    expect(setContext).toHaveBeenCalledWith({ memberId: "finance-new", role: "finance", workspaceId: "workspace-default" });
    expect(container.querySelector('[data-listener="mounted"]')).toBeNull();

    await act(async () => firstWrite.resolve());
    expect(container.querySelector('[data-listener="mounted"]')).not.toBeNull();

    await act(async () => {
      root.render(
        <MemberContextGateController
          auth={cloudAuth("finance-second")}
          config={{ runtimeMode: "cloud-ready", cloudConfigured: true }}
          setContext={setContext}
        >
          <div data-listener="mounted">listeners mounted</div>
        </MemberContextGateController>,
      );
    });
    expect(container.querySelector('[data-listener="mounted"]')).toBeNull();
    expect(setContext).toHaveBeenLastCalledWith({ memberId: "finance-second", role: "finance", workspaceId: "workspace-default" });

    await act(async () => secondWrite.resolve());
    expect(container.querySelector('[data-listener="mounted"]')).not.toBeNull();
  });

  it("keeps the subtree blocked when the context write fails", async () => {
    const setContext = vi.fn(async () => { throw new Error("IndexedDB write failed"); });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemberContextGateController
          auth={cloudAuth("finance-new")}
          config={{ runtimeMode: "cloud-ready", cloudConfigured: true }}
          setContext={setContext}
        >
          <div data-listener="mounted">listeners mounted</div>
        </MemberContextGateController>,
      );
    });
    expect(container.querySelector('[data-listener="mounted"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("成员上下文初始化失败");
  });

  it("initializes local-user before mounting local listeners", async () => {
    const write = deferred();
    const setContext = vi.fn(() => write.promise);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MemberContextGateController
          auth={{ loading: false, user: null }}
          config={{ runtimeMode: "local", cloudConfigured: false }}
          setContext={setContext}
        >
          <div data-listener="mounted">listeners mounted</div>
        </MemberContextGateController>,
      );
    });
    expect(setContext).toHaveBeenCalledWith({ memberId: "local-user", role: "admin", workspaceId: "workspace-default" });
    expect(container.querySelector('[data-listener="mounted"]')).toBeNull();
    await act(async () => write.resolve());
    expect(container.querySelector('[data-listener="mounted"]')).not.toBeNull();
  });
});
