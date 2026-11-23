import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The dashboard talks to the Go API on :8080. In development Vite proxies
// /api so the browser sees a same-origin request and CORS stays out of the
// way; set VITE_API_PROXY when the server runs elsewhere.
const apiProxy = process.env.VITE_API_PROXY || 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: apiProxy, changeOrigin: true },
    },
  },
});
