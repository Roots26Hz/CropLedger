import { defineConfig } from "vitest/config";

// Unit tests for the shared simulator core and frontend services.
// Smart-contract tests run separately under Hardhat (npm run test:contracts).
export default defineConfig({
  test: {
    include: ["simulator/**/*.test.ts", "frontend/src/**/*.test.ts"],
    environment: "node",
  },
});
