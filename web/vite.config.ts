import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The dev server's file access is pinned to web/ only. The competition data lives in ../data and
// must never be reachable from a browser, so the parent repo is deliberately outside `allow`, and
// anything that looks like a match asset is denied even if it somehow lands in here. (src/data/ is
// our own typed fixtures, not match data, so no "data" pattern is denied.)
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    open: false,
    fs: {
      strict: true,
      allow: ["."],
      deny: [".env", ".env.*", "**/*.mp4", "**/*_atd.*", "**/*homography*", "**/*smart_tagging*"],
    },
  },
});
