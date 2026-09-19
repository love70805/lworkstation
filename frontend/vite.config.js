import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // DOM tests must use happy-dom storage, not Node's file-backed globals.
    execArgv: ["--no-experimental-webstorage"],
  },
  server: {
    host: "127.0.0.1",
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
