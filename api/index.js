import { app } from '../server/app.js';
import { seedIfEmpty } from '../server/seed.js';

try {
  seedIfEmpty();
} catch (e) {
  console.warn('[seed] Could not seed initial items:', e.message);
}

export default app;

