import { expect, it } from "vitest";
import { activityName, shortActivityName } from "./salesActivitySummary";

it("removes order timestamps and pricing while retaining the campaign name", () => {
  const first = "客单创建时间:2026-08-01 04:58:49, 参与活动:【shein全球大促】2026年「返校季」常规活动, 活动时间范围:2026-07-27~2026-08-10, 结算价格:13.25";
  const second = first.replace("2026-08-01 04:58:49", "2026-07-31 00:56:12");
  expect(activityName(first)).toBe("「返校季」常规活动");
  expect(new Set([first, second].map(activityName)).size).toBe(1);
  expect(activityName("参与活动：限时折扣，活动调价方式：定价")).toBe("限时折扣");
});

it("does not invent an activity from metadata and bounds free-text summaries", () => {
  expect(activityName("客单创建时间:2026-08-01 04:58:49")).toBe("活动名称待查");
  expect(activityName("自定义活动")).toBe("自定义活动");
  expect(shortActivityName("长".repeat(50))).toBe(`${"长".repeat(36)}…`);
});
