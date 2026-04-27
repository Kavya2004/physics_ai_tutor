import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let cachedPages = null;

async function getPages() {
  if (cachedPages) return cachedPages;
  const buffer = readFileSync(join(__dirname, '..', 'college-physics-2e.pdf'));
  const pages = [];
  await pdfParse(buffer, {
    pagerender(pageData) {
      return pageData.getTextContent().then(tc => {
        pages.push({ page: pageData.pageNumber, text: tc.items.map(i => i.str).join(' ') });
        return '';
      });
    }
  });
  cachedPages = pages;
  return pages;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();
  const { page } = req.body;
  try {
    const pages = await getPages();
    const found = pages.find(p => p.page === Number(page));
    if (!found) return res.status(404).json({ error: 'Page not found' });
    res.status(200).json({ page: found.page, total: pages.length, text: found.text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
