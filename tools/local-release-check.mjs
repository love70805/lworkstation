import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = fileURLToPath(new URL("../frontend/", import.meta.url));
const commands = [
  ["单元与集成测试", "pnpm", ["test"]],
  ["前端生产构建", "pnpm", ["build"]],
  ["ERP Assistant 桥接生成", "pnpm", ["erp:bridge:test"]],
  ["ERP 收件协议", "pnpm", ["erp:inbox:test"]],
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

console.log("Shopeers 本地发布候选验收开始");
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
