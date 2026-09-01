import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(root);
const composeFile = join(workspaceRoot, "docker-compose.postgres.yml");
const migrationsDir = join(workspaceRoot, "frontend", "supabase", "migrations");
const command = String(process.argv[2] || "help").toLowerCase();

function printHelp() {
  console.log("用法：node tools/postgres-dev.mjs <up|down|migrate|check>");
  console.log("  up       启动本地 PostgreSQL 16 容器");
  console.log("  down     停止容器，保留本地数据卷");
  console.log("  migrate  执行当前版本化迁移");
  console.log("  check    检查容器健康和核心表数量");
}

function run(args, { input = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "-f", composeFile, ...args], {
      cwd: workspaceRoot,
      stdio: [input == null ? "inherit" : "pipe", "inherit", "inherit"],
      windowsHide: true,
    });
    child.on("error", (error) => reject(Object.assign(new Error("未找到 Docker。请先安装并启动 Docker Desktop。"), { cause: error, code: "DOCKER_UNAVAILABLE" })));
    child.on("close", (code) => code === 0 ? resolve() : reject(Object.assign(new Error(`Docker Compose 命令失败，退出码 ${code}。`), { code: "DOCKER_COMMAND_FAILED", status: 1 })));
    if (input != null) child.stdin.end(input);
  });
}

function runCapture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "-f", composeFile, ...args], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => reject(Object.assign(new Error("未找到 Docker。请先安装并启动 Docker Desktop。"), { cause: error, code: "DOCKER_UNAVAILABLE" })));
    child.on("close", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(Object.assign(new Error(`Docker Compose 命令失败，退出码 ${code}。`), { code: "DOCKER_COMMAND_FAILED", status: 1, stdout, stderr })));
  });
}

async function main() {
  if (command === "help") return printHelp();
  if (command === "up") {
    await run(["up", "-d", "postgres"]);
    console.log("本地 PostgreSQL 已启动：localhost:55432/shopeers");
    return;
  }
  if (command === "down") return run(["down"]);
  if (command === "migrate") {
    const migrationFiles = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .toSorted();
    await run(["exec", "-T", "postgres", "psql", "-U", "shopeers", "-d", "shopeers", "-v", "ON_ERROR_STOP=1", "-c", "create table if not exists public._shopeers_schema_migrations (version text primary key, applied_at timestamptz not null default now());"]);
    for (const file of migrationFiles) {
      const check = await runCapture(["exec", "-T", "postgres", "psql", "-U", "shopeers", "-d", "shopeers", "-tAc", `select 1 from public._shopeers_schema_migrations where version = '${file.replaceAll("'", "''")}'`]);
      if (check.stdout.trim() === "1") {
        console.log(`跳过已执行迁移：${file}`);
        continue;
      }
      const migration = await readFile(join(migrationsDir, file), "utf8");
      const input = `begin;\n${migration}\ninsert into public._shopeers_schema_migrations (version) values ('${file.replaceAll("'", "''")}');\ncommit;\n`;
      await run(["exec", "-T", "postgres", "psql", "-U", "shopeers", "-d", "shopeers", "-v", "ON_ERROR_STOP=1"], { input });
      console.log(`已执行迁移：${file}`);
    }
    console.log("PostgreSQL 全部迁移执行完成。");
    return;
  }
  if (command === "check") {
    await run(["exec", "-T", "postgres", "pg_isready", "-U", "shopeers", "-d", "shopeers"]);
    await run(["exec", "-T", "postgres", "psql", "-U", "shopeers", "-d", "shopeers", "-c", "select current_database() as database, count(*) as cloud_tables from information_schema.tables where table_schema = 'public';"]);
    return;
  }
  printHelp();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = Number(error.status) || 1;
});
