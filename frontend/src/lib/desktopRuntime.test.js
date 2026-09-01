import { describe, expect, it } from "vitest";
import { getErpAssistantRouteTarget, getRuntimeEnvironmentCopy, isDesktopRuntime } from "./desktopRuntime";

describe("desktop runtime UI routing", () => {
  it("redirects the standalone ERP assistant page inside the desktop workstation", () => {
    const runtime = { desktop: true, version: "0.2.3" };

    expect(isDesktopRuntime(runtime)).toBe(true);
    expect(getErpAssistantRouteTarget(runtime)).toBe("/profit");
    expect(getRuntimeEnvironmentCopy(runtime)).toEqual({
      application: "v0.2.3",
      environment: "桌面工作站",
      storage: "桌面本机 IndexedDB",
      diagnosticsDescription: "查看桌面工作站的数据状态、内置扩展连接、存储占用、备份记录与近期操作。",
    });
  });

  it("keeps the standalone installation page available in a browser", () => {
    expect(isDesktopRuntime(null)).toBe(false);
    expect(getErpAssistantRouteTarget(null)).toBeNull();
    expect(getRuntimeEnvironmentCopy(null).environment).toBe("浏览器环境");
  });
});
