// Display only. Keep the original ledger evidence untouched.
export function activityName(raw) {
  const text = String(raw ?? "").trim();
  const named = text.match(/参与活动\s*[:：]\s*([\s\S]*)/);
  const name = (named ? named[1] : text)
    .split(/[,，;；\n]?\s*(?:活动时间范围|活动调价方式|提报的活动价格|结算价格|客单创建时间)\s*[:：]/)[0]
    .replace(/【shein全球大促】/gi, "")
    .replace(/^\s*\d{4}年\s*/, "")
    .replace(/\s+/g, " ").trim();
  return name || "活动名称待查";
}

export function shortActivityName(name) {
  const characters = Array.from(name);
  return characters.length > 36 ? `${characters.slice(0, 36).join("")}…` : name;
}
