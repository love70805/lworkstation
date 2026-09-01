import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DesktopErpExtensionSummary } from "./ErpAssistantSetup";

describe("desktop ERP extension status entry", () => {
  it("renders concise built-in status controls without browser installation actions", () => {
    const html = renderToStaticMarkup(
      <DesktopErpExtensionSummary
        extensionLabel="内置扩展已运行"
        extensionHint="v8.0.12 · 当前页面已连接"
        extensionTone="success"
        extensionBadge="已连接"
        serviceLabel="收件服务在线，等待 ERP 回传"
        checking={false}
        onRefresh={() => {}}
        onOpenDiagnostics={() => {}}
      />,
    );

    expect(html).toContain("内置 ERP 扩展");
    expect(html).toContain("系统诊断");
    expect(html).toContain("复检");
    expect(html).not.toContain("下载扩展包");
    expect(html).not.toContain("Chrome");
    expect(html).not.toContain("加载已解压");
  });
});
