import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Versión SemVer del sistema (docs/versionado.md). Se cambia con ./scripts/version.sh, nunca a mano.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // En desarrollo (npm run dev) las llamadas a /api van al backend local.
  // En Docker, nginx hace lo mismo hacia el servicio `backend`.
  server: { proxy: { '/api': 'http://localhost:8000' } },
})
