import { describe, expect, it } from "vitest";
import { getErpAssistantStatusRequests } from "./erpAssistantStatus";

describe("ERP assistant status requests", () => {
  it("uses route-only desktop IPC requests without exposing localhost endpoints", () => {
    expect(getErpAssistantStatusRequests()).toEqual({
      requests: { route: "/erp/v1/requests", method: "GET", query: { includeHistory: true } },
      extensionStatus: { route: "/erp/v1/extension-status", method: "GET", query: {} },
    });
  });
});
