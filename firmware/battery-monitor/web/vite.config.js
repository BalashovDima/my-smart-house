import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

// Builds straight into the PlatformIO LittleFS image directory.
// `npm run dev` proxies API calls to a real device; set VITE_DEVICE_URL to
// override the mDNS name.
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  base: './',
  build: {
    outDir: '../data',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 4096,
  },
  server: {
    host: true,
    proxy: {
      '/api': process.env.VITE_DEVICE_URL || 'http://battmon.local',
    },
  },
});
