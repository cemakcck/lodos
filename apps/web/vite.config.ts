import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const api = "http://localhost:4100";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Lodos",
        short_name: "Lodos",
        theme_color: "#4B1D3F",
        background_color: "#24101E",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        runtimeCaching: [
          { urlPattern: /^\/(api|socket\.io)\//, handler: "NetworkOnly" },
        ],
      },
    }),
  ],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/socket.io": { target: api, ws: true },
    },
  },
});
