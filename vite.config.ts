import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const convexUrl = env.VITE_CONVEX_URL || env.CONVEX_URL || "";

  return {
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_CONVEX_URL": JSON.stringify(convexUrl),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
