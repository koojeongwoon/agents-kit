import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';

const apiProxyTarget = process.env.AGENTS_KIT_GUI_API_ORIGIN || 'http://127.0.0.1:3710';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
