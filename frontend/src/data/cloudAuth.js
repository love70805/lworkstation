import { createClient } from "@supabase/supabase-js";
import { runtimeConfig } from "../config/runtimeConfig";

const AUTH_STORAGE_KEY = "shopeers-supabase-auth";
const CLOUD_AUTH_SYNC_PROVIDERS = new Set(["api", "supabase"]);
let cachedClient = null;
let cachedConfigKey = "";

function authConfig(config = runtimeConfig) {
  return {
    url: String(config.supabaseUrl ?? "").trim().replace(/\/$/, ""),
    anonKey: String(config.supabaseAnonKey ?? "").trim(),
  };
}

export function isCloudAuthConfigured(config = runtimeConfig) {
  const { url, anonKey } = authConfig(config);
  const endpoint = String(config.syncApiBaseUrl || config.apiBaseUrl || "").trim();
  return CLOUD_AUTH_SYNC_PROVIDERS.has(config.syncProvider) && Boolean(url && anonKey && endpoint);
}

export function getCloudAuthClient(config = runtimeConfig) {
  const { url, anonKey } = authConfig(config);
  if (!url || !anonKey) return null;
  const key = `${url}|${anonKey}`;
  if (cachedClient && cachedConfigKey === key) return cachedClient;
  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: AUTH_STORAGE_KEY,
    },
  });
  cachedConfigKey = key;
  return cachedClient;
}

export async function getCloudSession(config = runtimeConfig) {
  const client = getCloudAuthClient(config);
  if (!client) return { session: null, user: null };
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const session = data.session ?? null;
  return { session, user: session?.user ?? data.user ?? null };
}

export async function signInCloud({ email, password, config = runtimeConfig } = {}) {
  const client = getCloudAuthClient(config);
  if (!client) throw new Error("尚未配置 Supabase 项目地址和匿名公钥。");
  const normalizedEmail = String(email ?? "").trim();
  if (!normalizedEmail || !String(password ?? "")) throw new Error("请输入邮箱和密码。");
  const { data, error } = await client.auth.signInWithPassword({ email: normalizedEmail, password: String(password) });
  if (error) throw error;
  return { session: data.session ?? null, user: data.user ?? null };
}

export async function signOutCloud(config = runtimeConfig) {
  const client = getCloudAuthClient(config);
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export function subscribeCloudAuth(callback, config = runtimeConfig) {
  const client = getCloudAuthClient(config);
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((event, session) => {
    callback({ event, session: session ?? null, user: session?.user ?? null });
  });
  return () => data.subscription.unsubscribe();
}

export async function getCloudSyncHeaders(config = runtimeConfig) {
  if (!CLOUD_AUTH_SYNC_PROVIDERS.has(config.syncProvider)) return {};
  const { anonKey } = authConfig(config);
  if (!anonKey) return {};
  const { session } = await getCloudSession(config);
  if (config.syncProvider === "api") {
    return session?.access_token
      ? { authorization: `Bearer ${session.access_token}` }
      : {};
  }
  if (!session?.access_token) return { apikey: anonKey };
  return {
    apikey: anonKey,
    authorization: `Bearer ${session.access_token}`,
  };
}

export async function getCloudSyncActorId(config = runtimeConfig) {
  if (!CLOUD_AUTH_SYNC_PROVIDERS.has(config.syncProvider)) return "";
  const { user } = await getCloudSession(config);
  return String(user?.id ?? "").trim();
}
