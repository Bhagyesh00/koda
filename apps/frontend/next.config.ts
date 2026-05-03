import type { NextConfig } from 'next';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// Load the repo-root .env so the Next.js server-side proxy can read BACKEND_URL etc.
loadEnv({ path: path.resolve(__dirname, '../../.env') });

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@koda/shared'],
  output: 'standalone',
  webpack: (config) => {
    // @huggingface/transformers ships an `onnxruntime-node` adapter that uses
    // native bindings — Webpack tries to bundle it for the client build and
    // fails. Aliasing it to `false` strips it from client bundles; transformers
    // falls back to the WASM/WebGPU runtime which is what we want in-browser.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string | false>),
      'onnxruntime-node$': false,
    };
    return config;
  },
};

export default config;
