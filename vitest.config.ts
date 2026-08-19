import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Separate from `vite.config.ts` on purpose.
 *
 * The production build config carries `terser`, `manualChunks` and a `define`
 * block that the test runner has no use for. Standing rule 4 says Simple view
 * must not regress, and the safest way to keep a test setting out of the shipped
 * bundle is to keep it out of the build config.
 *
 * Vitest 0.34.6 is the last line that runs on Vite 3, which this repo is on.
 * Vitest 1 and later need Vite 5. Checked at install: only one `vite` is in
 * `node_modules`, version 3.2.11, so nothing was upgraded to make tests work.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Plain Node. No jsdom, no Web Audio polyfill, no browser.
    //
    // Answered by the edit stack design: every operation is a built-in Web Audio
    // node or an `AudioWorklet`, and a worklet is a thin shell around a plain
    // function over `Float32Array`. Test the function, not the shell.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
