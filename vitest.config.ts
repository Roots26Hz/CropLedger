import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the shared simulator core and frontend services.
// Smart-contract tests run separately under Hardhat (npm run test:contracts).
export default defineConfig({
  resolve: {
    alias: { "@core": fileURLToPath(new URL("./simulator", import.meta.url)) },
  },
  test: {
    include: ["simulator/**/*.test.ts", "frontend/src/**/*.test.ts"],
    environment: "node",
  },
});
