// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeConfigurationGate } from "./RuntimeConfigurationGate";

let container;
let root;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("App runtime configuration gate", () => {
  it("blocks invalid cloud intent before the business subtree can mount", async () => {
    const mounted = vi.fn();
    function BusinessSubtree() {
      mounted();
      return <div>业务工作区</div>;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <RuntimeConfigurationGate config={{ syncProvider: "api", runtimeMode: "cloud-invalid", valid: false }}>
          <BusinessSubtree />
        </RuntimeConfigurationGate>,
      );
    });
    expect(mounted).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("云端同步配置不完整");
    expect(container.textContent).not.toContain("业务工作区");
  });

  it("keeps an explicit local runtime available", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <RuntimeConfigurationGate config={{ syncProvider: "local", runtimeMode: "local", valid: true }}>
          <div>本机业务工作区</div>
        </RuntimeConfigurationGate>,
      );
    });
    expect(container.textContent).toContain("本机业务工作区");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
