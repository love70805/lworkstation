export const products = [
  {
    id: "prod-001",
    image: "/assets/09-product-library-2.jpg",
    name: "混合式主动降噪耳机",
    skuCount: 8,
    supplier: "SUP-1688-A42",
    cost: 24.5,
    store: "美国主店",
    status: "Active",
    updated: "2 小时前",
  },
  {
    id: "prod-002",
    image: "/assets/09-product-library-3.jpg",
    name: "战术防震智能手表",
    skuCount: 3,
    supplier: "SUP-1688-B11",
    cost: 18.2,
    store: "欧洲分店",
    status: "Active",
    updated: "4 小时前",
  },
  {
    id: "prod-003",
    image: null,
    name: "极简铝合金笔记本支架",
    skuCount: null,
    supplier: "SUP-1688-C99",
    cost: 12,
    store: "美国主店",
    status: "Draft",
    updated: "1 天前",
  },
  {
    id: "prod-004",
    image: null,
    name: "无线游戏手柄 V2",
    skuCount: 12,
    supplier: "SUP-1688-D04",
    cost: 31.8,
    store: "全球店",
    status: "Inactive",
    updated: "1 月 15 日",
  },
];

export const captureBatches = [
  {
    id: "BAT-20231024-A1",
    source: "detail.1688.com/...",
    captured: "2023年10月24日 14:32",
    warningLabel: "2 项警告",
    warningTone: "warning",
    count: 12,
    items: [
      { id: "capture-1", image: "/assets/05-capture-queue-2.jpg", name: "极简陶瓷杯 350ml", sku: "MUG-CER-WHT-35", cost: 12.5, warning: "Missing Weight", tone: "danger" },
      { id: "capture-2", image: "/assets/05-capture-queue-3.jpg", name: "极简陶瓷杯 350ml - 黑色", sku: "MUG-CER-BLK-35", cost: 12.5, warning: "Valid", tone: "neutral" },
    ],
  },
  {
    id: "BAT-20231024-B2",
    source: "detail.1688.com/...",
    captured: "2023年10月24日 11:15",
    warningLabel: "1 项严重问题",
    warningTone: "danger",
    count: 4,
    items: [
      { id: "capture-3", image: "/assets/05-capture-queue-4.jpg", name: "线性机械轴 50g", sku: "SW-LIN-50G", cost: 1.2, warning: "Missing English Title", duplicate: "疑似重复（SKU：SW-LIN-50）", tone: "danger" },
    ],
  },
];

export const profitRows = [
  { sku: "ANC-HP-B01", name: "混合式主动降噪耳机", image: "/assets/07-profit-panel-2.jpg", qty: 2310, revenue: 124839, unitCost: 18.5, shipping: 4.2, penalty: 0, profit: 72408, status: "Matched" },
  { sku: "WA-SHOCK-R", name: "坚固防震手表", image: "/assets/07-profit-panel-3.jpg", qty: 1230, revenue: 92662, unitCost: null, shipping: 3.8, penalty: 0, profit: null, status: "Missing" },
  { sku: "SM-GLX-U25", name: "Galaxy S25 Ultra 手机壳", image: "/assets/07-profit-panel-4.jpg", qty: 812, revenue: 14048, unitCost: 2.1, shipping: 1.5, penalty: 0, profit: 11124, status: "Matched" },
  { sku: "CTRL-WL-X", name: "无线游戏手柄", image: null, qty: 645, revenue: 32820, unitCost: 12.5, shipping: 5, penalty: 0, profit: 21532.5, status: "Draft" },
];

export const recentActivity = [
  { tone: "success", title: "数据同步完成", detail: "已从 1688 提取 42 件商品", time: "10 分钟前" },
  { tone: "warning", title: "采集队列提醒", detail: "3 件商品等待校验", time: "25 分钟前" },
  { tone: "danger", title: "账本导出失败", detail: "传输过程中网络超时", time: "1 小时前" },
  { tone: "success", title: "利润面板已更新", detail: "夜间重新计算已完成", time: "3 小时前" },
  { tone: "info", title: "系统诊断", detail: "已自动清理常规缓存", time: "5 小时前" },
];

export const diagnosticsLog = [
  { time: "2026-08-05 09:32:01", level: "WARN", source: "ExtensionSync", message: "等待 8080 端口返回清单更新超时，正在重试（1/3）..." },
  { time: "2026-08-05 09:32:05", level: "ERROR", source: "LocalData", message: "写入检查被中断，之前的快照保持完整。" },
  { time: "2026-08-05 09:35:12", level: "INFO", source: "CaptureWorker", message: "已成功校验队列 capture_pending 中的 12 件商品。" },
  { time: "2026-08-05 09:38:44", level: "ERROR", source: "ERPQuery", message: "采购列表请求失败，结果导出已禁用。" },
  { time: "2026-08-05 09:38:45", level: "WARN", source: "TaskManager", message: "采购成本核算已停止，未生成部分结果。" },
  { time: "2026-08-05 09:40:01", level: "INFO", source: "Backup", message: "自动备份校验通过，校验和正常。" },
];

export const ledgers = [
  { month: "10月", label: "2024 年 10 月", state: "Draft", profit: 112450, sales: 3240, cost: 48200, progress: 75 },
  { month: "9月", label: "2024 年 9 月", state: "Finalized", profit: 108210.5, sales: 3110, cost: 45100 },
  { month: "8月", label: "2024 年 8 月", state: "Finalized", profit: 98400, sales: 2850, cost: 41000 },
  { month: "7月", label: "2024 年 7 月", state: "Finalized", profit: 92100, sales: 2700, cost: 39700, locked: true },
];
