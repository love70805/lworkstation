import { readFileSync } from "node:fs";

export function buildSyncDatabaseConfig(env = process.env, { readCertificate = readFileSync } = {}) {
  let url;
  try { url = new URL(String(env.SHOPEERS_DATABASE_URL || "")); }
  catch { throw new Error("SHOPEERS_DATABASE_URL 必须是有效的 PostgreSQL 连接串。"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
    throw new Error("SHOPEERS_DATABASE_URL 必须指定 PostgreSQL 主机。");
  }
  let requestedMode = String(env.SHOPEERS_DATABASE_SSL || "").trim().toLowerCase();
  // node-postgres lets URL SSL parameters replace the entire ssl object. Remove
  // supported strict modes and reject all other SSL overrides before parsing.
  for (const [name, value] of [...url.searchParams]) {
    const key = name.toLowerCase();
    if (["host", "hostaddr", "port"].includes(key)) {
      throw new Error("请在连接串主机部分指定数据库地址，不允许查询参数覆盖主机或端口。");
    }
    if (key === "sslmode" && ["require", "verify-ca", "verify-full"].includes(value.toLowerCase())) {
      if (requestedMode === "disable") throw new Error("数据库 TLS 配置互相冲突。");
      requestedMode ||= "require";
      url.searchParams.delete(name);
    } else if (key.startsWith("ssl") || key === "uselibpqcompat") {
      throw new Error("连接串中不允许覆盖 TLS 校验；请使用 SHOPEERS_DATABASE_SSL 和 SHOPEERS_DATABASE_CA_FILE。");
    }
  }
  if (!["", "require", "verify-full", "disable"].includes(requestedMode)) {
    throw new Error("SHOPEERS_DATABASE_SSL 仅支持 require、verify-full 或本机开发用 disable。");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
  const tlsRequired = env.NODE_ENV === "production" || !loopback;
  if (requestedMode === "disable" && tlsRequired) throw new Error("生产或非本机数据库必须验证 TLS 证书。");
  const useTls = tlsRequired || ["require", "verify-full"].includes(requestedMode);
  if (useTls && String(env.NODE_TLS_REJECT_UNAUTHORIZED) === "0") {
    throw new Error("数据库 TLS 不允许 NODE_TLS_REJECT_UNAUTHORIZED=0。");
  }
  const caFile = String(env.SHOPEERS_DATABASE_CA_FILE || "").trim();
  if (caFile && !useTls) throw new Error("已配置数据库 CA，必须启用 TLS。");
  const max = Number(env.SHOPEERS_DB_POOL_MAX || 10);
  if (!Number.isSafeInteger(max) || max < 1 || max > 100) throw new Error("数据库连接池大小必须是 1 至 100 的整数。");
  return {
    connectionString: url.toString(),
    max,
    ssl: useTls ? { rejectUnauthorized: true, ...(caFile ? { ca: readCertificate(caFile, "utf8") } : {}) } : false,
  };
}
