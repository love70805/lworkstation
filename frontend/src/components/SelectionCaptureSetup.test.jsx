import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SelectionCaptureFlowNote } from "./SelectionCaptureSetup";

describe("1688 capture queue status note", () => {
  it("uses an internal action in the browser without a fixed development origin", () => {
    const html = renderToStaticMarkup(<SelectionCaptureFlowNote showQueueLink onOpenQueue={() => {}} />);

    expect(html).toContain("打开待确认采集");
    expect(html).not.toContain("127.0.0.1:5173");
    expect(html).not.toContain("target=\"_blank\"");
  });

  it("hides the queue action in the desktop status surface", () => {
    const html = renderToStaticMarkup(<SelectionCaptureFlowNote showQueueLink={false} onOpenQueue={() => {}} />);

    expect(html).toContain("1688 成本只作为参考");
    expect(html).not.toContain("打开待确认采集");
  });
});
