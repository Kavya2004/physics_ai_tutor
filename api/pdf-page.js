import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let cachedPages = null;

function getPages() {
  if (!cachedPages) cachedPages = JSON.parse(readFileSync(join(__dirname, 'textbook-pages.json'), 'utf8'));
  return cachedPages;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();
  const { page } = req.body;
  try {
    const pages = getPages();
    const found = pages.find(p => p.page === Number(page));
    if (!found) return res.status(404).json({ error: 'Page not found' });
    res.status(200).json({ page: found.page, total: pages.length, text: found.text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
