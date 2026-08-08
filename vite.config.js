import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/pixel-art-converter/',
  server: {
    host: '0.0.0.0',
    port: 5173
  }
})
