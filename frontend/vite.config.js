// Vite config. base "./" keeps every asset and data fetch relative, so the same build works at
// https://<org>.github.io/<repo>/ (GitHub Pages), at the root of a Vercel domain, and on localhost.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
});
