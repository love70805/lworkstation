import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = fileURLToPath(new URL("../frontend/", import.meta.url));
const commands = [
  ["单元与集成测试", "pnpm", ["test"]],
  ["前端生产构建", "pnpm", ["build"]],
  ["ERP Assistant 桥接生成", "pnpm", ["erp:bridge:test"]],
  ["ERP 分批任务持久化与恢复", "node", ["../tools/erp-collection-tasks.test.mjs"]],
  ["清空本机数据与 ERP 历史隔离", "node", ["../tools/local-workspace-reset.test.mjs"]],
  ["ERP 分批采集规模与性能", "node", ["../tools/erp-collection-batches.test.mjs"]],
  ["ERP 延长时限与取消", "node", ["../tools/erp-collection-time-budget.test.mjs"]],
  ["ERP 采集慢路径", "node", ["../tools/erp-collection-slow-paths.test.mjs"]],
  ["ERP 完整历史与取消采购", "node", ["../tools/erp-purchase-history.test.mjs"]],
  ["ERP 大范围采集与续取", "node", ["../tools/erp-collection-scale.test.mjs"]],
  ["ERP 本机检查点与重启恢复", "node", ["../tools/erp-collection-recovery.test.mjs"]],
  ["ERP 首次发送请求绑定", "node", ["../tools/erp-collection-binding.test.mjs"]],
  ["ERP 请求快照竞态回归", "node", ["../tools/erp-request-binding.regression.test.mjs"]],
  ["ERP 收件协议", "pnpm", ["erp:inbox:test"]],
  ["ERP 大队列并发响应与证据持久化", "node", ["../tools/erp-inbox-responsiveness.test.mjs"]],
  ["ERP 存储复用与证据引用恢复", "node", ["../tools/erp-inbox-storage.test.mjs"]],
  ["同步服务冒烟", "pnpm", ["sync:check"]],
  ["云端种子合同", "pnpm", ["seed:check"]],
  ["PostgreSQL Schema 合同", "pnpm", ["schema:check"]],
  ["同步部署门禁", "pnpm", ["sync:deploy:check"]],
  ["前端部署门禁", "pnpm", ["deploy:check"]],
];

function run(label, command, args) {
  return new Promise((resolve) => {
    const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : command;
    const childArgs = process.platform === "win32" ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;
    const child = spawn(executable, childArgs, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      console.error(`\n[失败] ${label}: ${error.message}`);
      resolve(false);
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        console.log(`[通过] ${label}`);
        resolve(true);
        return;
      }
      console.error(`[失败] ${label}: exit=${code ?? "null"}, signal=${signal ?? "none"}`);
      resolve(false);
    });
  });
}

console.log("Lworkstation 本地发布候选验收开始");
console.log(`工作区: ${root}`);

for (const [label, command, args] of commands) {
  // 顺序执行，避免构建、数据库合同和服务冒烟共享临时资源时互相干扰。
  if (!(await run(label, command, args))) {
    console.error("\n验收未通过：请修复上一个失败项后重新执行。");
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) console.log("\n验收通过：当前版本可作为本机组内试用候选版。真实 ERP 登录态与云端资源仍需单独验收。");
