import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth })),
}));

import {
  getCloudAuthClient,
  getCloudSession,
  getCloudSyncActorId,
  getCloudSyncHeaders,
  isCloudAuthConfigured,
  signInCloud,
  signOutCloud,
} from "./cloudAuth";

const config = {
  syncProvider: "supabase",
  supabaseUrl: "https://example.supabase.co",
  supabaseAnonKey: "anon-key",
  syncApiBaseUrl: "https://example.supabase.co/functions/v1/shopeers-sync",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("云端会话适配器", () => {
  it("only treats Supabase URL plus anon key as a configured cloud session", () => {
    expect(isCloudAuthConfigured(config)).toBe(true);
    expect(isCloudAuthConfigured({ ...config, supabaseAnonKey: "" })).toBe(false);
    expect(isCloudAuthConfigured({ ...config, syncProvider: "api", apiBaseUrl: "https://api.example.test" })).toBe(true);
  });

  it("loads and signs in through the Supabase auth client", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "old-token" }, user: { email: "old@example.com" } }, error: null });
    await expect(getCloudSession(config)).resolves.toMatchObject({ user: { email: "old@example.com" } });

    auth.signInWithPassword.mockResolvedValue({ data: { session: { access_token: "new-token" }, user: { email: "user@example.com" } }, error: null });
    await expect(signInCloud({ email: " user@example.com ", password: "secret", config })).resolves.toMatchObject({ session: { access_token: "new-token" } });

    auth.signOut.mockResolvedValue({ error: null });
    await expect(signOutCloud(config)).resolves.toBeUndefined();
  });

  it("returns only the public key before login and adds a bearer token after login", async () => {
    auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(getCloudSyncHeaders(config)).resolves.toEqual({ apikey: "anon-key" });
    auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: "access-token" } }, error: null });
    await expect(getCloudSyncHeaders(config)).resolves.toEqual({ apikey: "anon-key", authorization: "Bearer access-token" });
  });

  it("keeps the standalone API provider on bearer-only CORS-safe headers", async () => {
    const apiConfig = { ...config, syncProvider: "api", apiBaseUrl: "https://api.example.test" };
    auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(getCloudSyncHeaders(apiConfig)).resolves.toEqual({});
    auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: "api-access-token" } }, error: null });
    await expect(getCloudSyncHeaders(apiConfig)).resolves.toEqual({ authorization: "Bearer api-access-token" });
  });

  it("resolves the current authenticated member from the cloud session", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { access_token: "access-token", user: { id: "finance-current" } } },
      error: null,
    });
    await expect(getCloudSyncActorId(config)).resolves.toBe("finance-current");
    await expect(getCloudSyncActorId({ ...config, syncProvider: "api", apiBaseUrl: "https://api.example.test" })).resolves.toBe("finance-current");
  });

  it("returns no client when cloud auth is not configured", async () => {
    expect(getCloudAuthClient({ syncProvider: "local" })).toBeNull();
    await expect(getCloudSession({ syncProvider: "local" })).resolves.toEqual({ session: null, user: null });
  });
});

