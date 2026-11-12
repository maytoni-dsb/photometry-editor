import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' — сайт работает из любой папки (GitHub Pages: https://<org>.github.io/<repo>/)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 2000 },
});
