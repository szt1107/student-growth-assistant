import config from '../vite.config.js'

// Explicit isolated QA endpoint, never the normal application backend.
export default {
  ...config,
  server: {
    host: '127.0.0.1', port: 5287, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8021', changeOrigin: true } },
  },
}
