import { dirname } from 'path'
import { fileURLToPath } from 'url'

const panelRoot = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: panelRoot
}

export default nextConfig
