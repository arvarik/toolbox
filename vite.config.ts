import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8"),
) as { version: string };
process.env.VITE_APP_VERSION = pkg.version;

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  server: {
    port: 5173,
    host: process.env.VITE_DEV_HOST || true,
    allowedHosts: [".local"],
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        // Preserve the client's real Host header so Express hostGuard rejects
        // DNS-rebinding domains while LAN IP / .local Origin===Host writes work.
        changeOrigin: false,
      },
    },
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "*.db",
        "*.db-wal",
        "*.db-shm",
        "secret.key",
        "**/backups/**",
        "**/uploads/**",
      ],
    },
  },
  preview: {
    host: process.env.VITE_DEV_HOST || "127.0.0.1",
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // Writes the license text of every bundled package next to the app, so the
    // shipped bundle keeps the notices its MIT, ISC, BSD and Apache licenses require.
    license: { fileName: "THIRD-PARTY-LICENSES.md" },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    testTimeout: 15_000,
    exclude: [
      ...configDefaults.exclude,
      "tests/e2e/**",
      "test-results/**",
      "playwright-report/**",
    ],
    coverage: {
      include: ["src/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      // Ratchet: raise these when coverage grows; never lower them to pass CI.
      thresholds: {
        statements: 67,
        branches: 56,
        functions: 60,
        lines: 69,
      },
    },
  },
});
