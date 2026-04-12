import type { NextConfig } from 'next';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// Load the repo-root .env so the Next.js server-side proxy can read BACKEND_URL etc.
loadEnv({ path: path.resolve(__dirname, '../../.env') });

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@koda/shared'],
};

export default config;
