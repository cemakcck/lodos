import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // userEvent typing in jsdom is CPU-bound: the ItemForm tests take 1-2 s alone and passed 5 s with every file
  // running in parallel on 8 cores. 15 s keeps a real hang failing while load alone cannot.
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"], testTimeout: 15_000 },
});
