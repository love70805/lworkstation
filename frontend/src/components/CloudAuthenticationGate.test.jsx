// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudAuthenticationGateView, hasAuthenticatedCloudIdentity } from "./CloudAuthenticationGate";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
  container = null;
});

function cloudConfig(syncProvider) {
  return { syncProvider, runtimeMode: "cloud-ready", cloudConfigured: true, valid: true };
}

describe("cloud authentication startup gate", () => {
  it.each(["api", "supabase"])("blocks the %s business subtree until a verified user exists", async (syncProvider) => {
    const mounted = vi.fn();
    const signIn = vi.fn(async () => ({ user: { id: "finance-current" } }));
    function BusinessSubtree() {
      mounted();
      return <div>业务工作区</div>;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <CloudAuthenticationGateView
          auth={{ loading: false, user: null, error: null }}
          config={cloudConfig(syncProvider)}
          signIn={signIn}
        >
          <BusinessSubtree />
        </CloudAuthenticationGateView>,
      );
    });
    expect(mounted).not.toHaveBeenCalled();
    expect(container.textContent).toContain("登录云端工作区");
    expect(hasAuthenticatedCloudIdentity(cloudConfig(syncProvider), null)).toBe(false);

    const [email, password] = container.querySelectorAll("input");
    await act(async () => {
      setInputValue(email, "finance@example.com");
      setInputValue(password, "secret");
    });
    await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(signIn).toHaveBeenCalledWith({ email: "finance@example.com", password: "secret" });

    await act(async () => {
      root.render(
        <CloudAuthenticationGateView
          auth={{ loading: false, user: { id: "finance-current" }, error: null }}
          config={cloudConfig(syncProvider)}
          signIn={signIn}
        >
          <BusinessSubtree />
        </CloudAuthenticationGateView>,
      );
    });
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("业务工作区");
    expect(hasAuthenticatedCloudIdentity(cloudConfig(syncProvider), { id: "finance-current" })).toBe(true);
  });

  it("keeps explicit local mode available without a cloud user", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <CloudAuthenticationGateView
          auth={{ loading: false, user: null, error: null }}
          config={{ syncProvider: "local", runtimeMode: "local", cloudConfigured: false, valid: true }}
        >
          <div>本机业务工作区</div>
        </CloudAuthenticationGateView>,
      );
    });
    expect(container.textContent).toContain("本机业务工作区");
  });
});
