import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Im Entwicklungsmodus leitet Vite API- und Vorschau-Anfragen an das
// laufende Rust-Backend weiter (`cargo run -- --no-open`).
const backend = process.env.SQRITTO_BACKEND ?? 'http://127.0.0.1:4517';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/preview': { target: backend, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
});
