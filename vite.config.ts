import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/CBCS-chengbencesuan/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { outDir: "dist/client" },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
