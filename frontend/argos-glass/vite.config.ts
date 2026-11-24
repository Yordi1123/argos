import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// En desarrollo (npm run dev) las llamadas a /api van al backend local.
// En Docker, nginx hace lo mismo hacia el servicio `backend`.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
})
