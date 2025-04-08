import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy API requests to the deployed Cloudflare Worker
      '/api': {
        target: 'https://chat-worker.radek-duba.workers.dev', // Deployed worker URL
        changeOrigin: true, // Recommended for virtual hosted sites
        secure: true,      // Worker uses https
        // rewrite: (path) => path.replace(/^\/api/, ''), // Uncomment if worker expects paths without /api prefix
      },
      // Proxy WebSocket connections to the deployed Cloudflare Worker
      '/websocket': {
        target: 'wss://chat-worker.radek-duba.workers.dev', // Use wss protocol for deployed worker
        ws: true, // Enable WebSocket proxying
        changeOrigin: true,
        secure: true, // Worker uses wss
      }
    }
  }
})
