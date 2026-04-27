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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { query } = req.body;
    const pages = getPages();

    const match = pages.find(p => p.text.toLowerCase().includes(query.toLowerCase()));
    if (!match) return res.status(200).json({ pdfs: [] });

    res.status(200).json({
      pdfs: [{
        title: '📄 College Physics 2e',
        url: 'college-physics-2e.pdf',
        pageNumber: match.page,
        snippet: extractSnippet(match.text, query),
        content: extractSnippet(match.text, query, 1500)
      }]
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function extractSnippet(text, query, maxLength = 300) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.substring(0, maxLength);
  const start = Math.max(0, idx - 100);
  return text.substring(start, Math.min(text.length, start + maxLength));
}
