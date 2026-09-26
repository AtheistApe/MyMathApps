import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/MyMathApps/phase-portrait-explorer/',
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
  },
});
