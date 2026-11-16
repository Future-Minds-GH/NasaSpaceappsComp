// Vite config. base "./" keeps every asset and data fetch relative, so the same build works at
// https://<org>.github.io/<repo>/ (GitHub Pages), at the root of a Vercel domain, and on localhost.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "h3-js": fileURLToPath(new URL("./src/h3-stub.js", import.meta.url)) } },
});
