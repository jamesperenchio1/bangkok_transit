import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `_name` marks a deliberately unused binding (e.g. dropping a key by destructuring).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/sw.js",
    "public/swe-worker*.js",
    "playwright-report/**",
    "test-results/**",
    "public/maplibre/**",
    "cloudflare/**/node_modules/**",
    ".wrangler/**",
    "cloudflare/**/.wrangler/**",
    "cloudflare/**/worker-configuration.d.ts",
  ]),
]);

export default eslintConfig;
