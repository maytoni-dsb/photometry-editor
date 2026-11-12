import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// версия и коммит — видны в шапке сайта, чтобы было понятно, какая сборка опубликована
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
let commit = 'dev';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  /* не git-клон */
}

// base './' — сайт работает из любой папки (GitHub Pages: https://<org>.github.io/<repo>/)
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 2000 },
});
