import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const src = join(__dirname, '..', 'node_modules', 'libsodium-sumo', 'dist', 'modules-sumo-esm', 'libsodium-sumo.mjs');

// Fix main location
const dst1 = join(__dirname, '..', 'node_modules', 'libsodium-wrappers-sumo', 'dist', 'modules-sumo-esm', 'libsodium-sumo.mjs');
// Fix nested location
const dst2 = join(__dirname, '..', 'node_modules', '@cardano-sdk', 'crypto', 'node_modules', 'libsodium-wrappers-sumo', 'dist', 'modules-sumo-esm', 'libsodium-sumo.mjs');

if (existsSync(src)) {
  // Fix main location
  if (!existsSync(dst1)) {
    mkdirSync(dirname(dst1), { recursive: true });
    copyFileSync(src, dst1);
    console.log('Fixed libsodium-sumo.mjs in main location');
  }
  
  // Fix nested location
  if (!existsSync(dst2)) {
    mkdirSync(dirname(dst2), { recursive: true });
    copyFileSync(src, dst2);
    console.log('Fixed libsodium-sumo.mjs in nested location');
  }
} else {
  console.warn('libsodium-sumo.mjs source file not found');
}

