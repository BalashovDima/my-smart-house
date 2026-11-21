import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds straight into the PlatformIO LittleFS image directory.
// viteSingleFile inlines the JS and CSS so LittleFS only needs index.html.
// `npm run dev` proxies API calls to a real device; set VITE_DEVICE_URL to
// override the mDNS name.
export default defineConfig({
  plugins: [preact(), tailwindcss(), viteSingleFile()],
  base: './',
  build: {
    outDir: '../data',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    host: true,
    proxy: {
      '/api': process.env.VITE_DEVICE_URL || 'http://battmon.local',
    },
  },
});
