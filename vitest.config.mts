import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Unit tests for the site's pure logic (routing, data, formatting, the
// arrivals document and client store). Browser behaviour is covered by the
// Playwright suite in e2e/; the poller has its own Workers-runtime suite in
// cloudflare/poller.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
