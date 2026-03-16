import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { NextConfig } from 'next'

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {
    root: workspaceRoot,
  },
}

export default nextConfig
