import { defineConfig } from "vitest/config";

// The billing helpers are pure functions with no DOM and no Firebase, so they
// run in plain Node — no jsdom, no emulator, no setup file.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
