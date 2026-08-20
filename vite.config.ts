import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The oldest browsers this app runs on.
 *
 * Vite 3's default is `es2020, edge88, firefox78, chrome87, safari13`, and
 * **Safari 13 has no `BigInt`**, so a dependency using a `0n` literal fails to
 * build at all. mediabunny uses them for Matroska's 64-bit track ids.
 *
 * These four are what the code already needs. `worker.format: "es"` asks for a
 * module worker, which arrived in Chrome 80, Firefox 114 and Safari 15 — so this
 * list narrows nothing the worker had not narrowed already. The map's browser
 * constraint is evergreen desktop Chrome, Edge, Firefox and Safari, and
 * "no polyfills for browsers two or more versions behind" is out of scope on the
 * map by name.
 *
 * **It has to be set twice.** `build.target` covers the production bundle;
 * `optimizeDeps.esbuildOptions.target` covers the dependency pre-bundle the dev
 * server builds, and that one keeps its own default. Setting only the first
 * gives a build that works and a `pnpm dev` that cannot load mediabunny.
 */
const BROWSER_TARGET = ["chrome80", "edge80", "firefox114", "safari15"];

export default defineConfig(({ command }) => {
  return {
    base: "",
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      global: {
        basename: "",
      },
    },
    worker: {
      /**
       * The encode worker is an **ES module worker**, not the default IIFE.
       *
       * `encode-worker.ts` imports mediabunny and the FLAC encoder dynamically,
       * so a user exporting WAV or MP3 downloads neither. A dynamic import is
       * code splitting, and Vite refuses to split an IIFE outright: "UMD and
       * IIFE output formats are not supported for code-splitting builds".
       *
       * The cost is `new Worker(url, { type: "module" })`, which needs Chrome
       * 80, Firefox 114 or Safari 15. The map's browser constraint is evergreen
       * desktop Chrome, Edge, Firefox and Safari, so every browser we support
       * has had it for years.
       */
      format: "es",
    },
    build: {
      target: BROWSER_TARGET,
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
      esbuildOptions: {
        target: BROWSER_TARGET,
      },
    },
  };
});
