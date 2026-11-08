import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: '/MyMathApps/taylor-explorer/' makes the built app work from any sub-folder, which is what
// GitHub Pages needs when several apps live in one repo (MyMathApps/taylor-explorer/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 900 },
});
