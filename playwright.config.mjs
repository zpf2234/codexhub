import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const use = { baseURL: 'http://127.0.0.1:4173', headless: true };
if (fs.existsSync(edgePath)) use.launchOptions = { executablePath: edgePath };

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  use,
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 30000 }
});
