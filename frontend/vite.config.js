import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['frontend', 'localhost', 'nginx'],
    proxy: {
      '/reports/': backendTarget,
      '/admin/': backendTarget,
      '/api/': backendTarget,
      '/auth/': backendTarget
    }
  }
})
