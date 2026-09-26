import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/MyMathApps/power-series-dance/',
  plugins: [react()],
})
