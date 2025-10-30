import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {

    port: 8502,
    // ✅ QUI la correzione
    allowedHosts: [
      "rbcms.formazioneintermediari.com", // dominio del proxy Apache
      "localhost",
      "127.0.0.1"
    ],
    watch: {
      usePolling: false,
      interval: 1000
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
})
