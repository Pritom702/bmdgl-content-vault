import { db } from './db.js';
import { createUser } from './auth.js';

export const TEAM_ACCOUNTS = [
  { name: 'Pritom',   email: 'pritom@brightmind.com',   password: 'password123', role: 'admin' },
  { name: 'Sharafat', email: 'sharafat@brightmind.com', password: 'password123', role: 'admin' },
  { name: 'Minhaj',   email: 'minhaj@brightmind.com',   password: 'password123', role: 'member' },
  { name: 'Saiful',   email: 'saiful@brightmind.com',   password: 'password123', role: 'member' },
  { name: 'Rafi',     email: 'rafi@brightmind.com',     password: 'password123', role: 'member' },
  { name: 'Tanvir',   email: 'tanvir@brightmind.com',   password: 'password123', role: 'member' },
  { name: 'Akib',     email: 'akib@brightmind.com',     password: 'password123', role: 'member' },
];

export function seedIfEmpty() {
  if (process.env.NO_SEED === '1') return;

  // Ensure all 7 team accounts exist
  for (const acc of TEAM_ACCOUNTS) {
    const row = db.prepare('SELECT id FROM users WHERE email = ?').get(acc.email);
    if (!row) createUser(acc);
  }

  // Create default team collections if empty
  const collCount = db.prepare('SELECT COUNT(*) AS n FROM collections').get().n;
  if (collCount === 0) {
    const insC = db.prepare('INSERT INTO collections(name, description, emoji) VALUES (?, ?, ?)');
    insC.run('AI Tools & Automation', 'Useful AI tools, GitHub repos, and workflow automations', '⚡');
    insC.run('Prompts & Templates', 'Copy-paste prompts, system instructions, and templates', '📋');
    insC.run('Growth & Content Ideas', 'High-performing Reels, Shorts, and creative references', '🎬');
    insC.run('Skool & Community Drops', 'Drive folders, lead magnets, and community resources', '📦');
  }
}
