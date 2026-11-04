import { start } from './app.js';
import { seedIfEmpty } from './seed.js';

try {
  seedIfEmpty();
} catch (e) {
  console.warn('[seed] Could not seed initial items:', e.message);
}

start();

