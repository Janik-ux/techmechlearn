import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  base: "https://janik-ux.github.io/techmechlearn/",
  server: {
    port: 8080,
    open: true,
  },
  build: {
    minify: true,
  },
});
