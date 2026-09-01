import { describe, expect, it } from "vitest";
import { getRuntimeConfigSummary, resolveRuntimeConfig } from "./runtimeConfig";

describe("runtime configuration", () => {
  it("defaults to a local-only provider", () => {
    const config = resolveRuntimeConfig({});
    expect(config).toMatchObject({ syncProvider: "local", runtimeMode: "local", cloudIntent: false, cloudConfigured: false, valid: true });
    expect(getRuntimeConfigSummary(config)).toMatchObject({ syncProvider: "local", runtimeMode: "local", cloudConfigured: false, valid: true });
  });

  it("requires an endpoint for a cloud provider and never exposes keys in the summary", () => {
    const incomplete = resolveRuntimeConfig({ VITE_SYNC_PROVIDER: "api" });
    expect(incomplete).toMatchObject({ syncProvider: "api", runtimeMode: "cloud-invalid", cloudIntent: true, cloudConfigured: false, valid: false });

    const configured = resolveRuntimeConfig({
      VITE_SYNC_PROVIDER: "supabase",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "public-key",
      VITE_SYNC_API_BASE_URL: "https://example.supabase.co/functions/v1/shopeers-sync",
    });
    expect(configured).toMatchObject({ syncProvider: "supabase", cloudConfigured: true, valid: true });
    expect(getRuntimeConfigSummary(configured)).not.toHaveProperty("supabaseAnonKey");

    expect(resolveRuntimeConfig({
      VITE_SYNC_PROVIDER: "supabase",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "public-key",
    })).toMatchObject({ cloudConfigured: false, valid: false });

    expect(resolveRuntimeConfig({
      VITE_SYNC_PROVIDER: "api",
      VITE_SYNC_API_BASE_URL: "https://sync.example.test",
    })).toMatchObject({ endpoint: "https://sync.example.test", runtimeMode: "cloud-invalid", cloudIntent: true, cloudConfigured: false, valid: false });

    expect(resolveRuntimeConfig({
      VITE_SYNC_PROVIDER: "api",
      VITE_SYNC_API_BASE_URL: "https://sync.example.test",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: "public-key",
    })).toMatchObject({ endpoint: "https://sync.example.test", runtimeMode: "cloud-ready", cloudIntent: true, cloudConfigured: true, valid: true });
  });

  it("marks unknown providers invalid instead of silently enabling sync", () => {
    expect(resolveRuntimeConfig({ VITE_SYNC_PROVIDER: "unknown", VITE_API_BASE_URL: "https://example.test" })).toMatchObject({
      syncProvider: "invalid",
      cloudConfigured: false,
      valid: false,
    });
  });

  it("defaults automatic cloud sync on but allows an explicit opt-out", () => {
    expect(resolveRuntimeConfig({}).autoSync).toBe(true);
    expect(resolveRuntimeConfig({ VITE_SYNC_AUTO: "false" }).autoSync).toBe(false);
  });
});
