import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve("apps/web"),
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules\/(react|react-dom|scheduler)\//,
            },
            { name: "navigation", test: /node_modules\/@tanstack\// },
            {
              name: "motion",
              test: /node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//,
            },
            { name: "validation", test: /node_modules\/zod\// },
          ],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8080", ws: true } },
  },
});
