const SUPPORTED_SYNC_PROVIDERS = new Set(["local", "api", "supabase"]);

function clean(value) {
  return String(value ?? "").trim();
}

function booleanValue(value, fallback = false) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function resolveRuntimeConfig(source = {}) {
  const requestedProvider = clean(source.VITE_SYNC_PROVIDER).toLowerCase() || "local";
  const syncProvider = SUPPORTED_SYNC_PROVIDERS.has(requestedProvider) ? requestedProvider : "invalid";
  const apiBaseUrl = clean(source.VITE_API_BASE_URL);
  const syncApiBaseUrl = clean(source.VITE_SYNC_API_BASE_URL);
  const supabaseUrl = clean(source.VITE_SUPABASE_URL);
  const supabaseAnonKey = clean(source.VITE_SUPABASE_ANON_KEY);
  const autoSync = booleanValue(source.VITE_SYNC_AUTO, true);
  const endpoint = syncApiBaseUrl || (syncProvider === "supabase" ? "" : apiBaseUrl);
  const cloudAuthReady = Boolean(supabaseUrl && supabaseAnonKey);
  const providerReady = syncProvider === "supabase" || syncProvider === "api"
    ? Boolean(endpoint && cloudAuthReady)
    : Boolean(endpoint);
  const cloudConfigured = syncProvider !== "local" && syncProvider !== "invalid" && providerReady;
  const valid = syncProvider !== "invalid" && (syncProvider === "local" || providerReady);
  const runtimeMode = syncProvider === "local"
    ? "local"
    : valid && cloudConfigured ? "cloud-ready" : "cloud-invalid";

  return {
    syncProvider,
    apiBaseUrl,
    syncApiBaseUrl,
    supabaseUrl,
    supabaseAnonKey,
    autoSync,
    endpoint,
    runtimeMode,
    cloudIntent: runtimeMode !== "local",
    cloudConfigured,
    valid,
  };
}

export const runtimeConfig = resolveRuntimeConfig(import.meta.env);

export function getRuntimeConfigSummary(config = runtimeConfig) {
  return {
    syncProvider: config.syncProvider,
    runtimeMode: config.runtimeMode,
    endpointConfigured: Boolean(config.endpoint),
    cloudConfigured: Boolean(config.cloudConfigured),
    valid: Boolean(config.valid),
  };
}
