import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read VITE_* variables from the repository-root .env (shared with Hardhat).
  // Only VITE_-prefixed values are exposed to the browser bundle.
  envDir: "..",
  resolve: {
    alias: {
      // Shared, framework-free core: payload, signing, gateway, local ledger.
      "@core": fileURLToPath(new URL("../simulator", import.meta.url)),
    },
    dedupe: ["ethers", "react", "react-dom"],
  },
  server: {
    port: 5173,
    fs: { allow: [".."] },
  },
  preview: { port: 4173 },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
