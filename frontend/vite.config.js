import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ['preact', 'react', 'react-dom'] },
  server: { port: 5173, strictPort: true, proxy: process.env.SGA_UI_PREVIEW_PROXY ? { '/api': { target: process.env.SGA_UI_PREVIEW_PROXY, changeOrigin: true } } : undefined },
})
