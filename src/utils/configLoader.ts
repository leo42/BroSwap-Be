import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function loadConfig() {
  const configPath = join(__dirname, '..', '..', 'config.json');
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

export function loadVerifiedTokens() {
  const tokensPath = join(__dirname, '..', '..', 'availableTokens.json');
  return JSON.parse(readFileSync(tokensPath, 'utf-8'));
}



