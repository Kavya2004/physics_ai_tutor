import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedPages = null; // [{ page, text }]

async function getTextbookPages() {
  if (cachedPages) return cachedPages;
  const pdfPath = join(__dirname, '..', 'textbook.pdf');
  const buffer = readFileSync(pdfPath);
  const pages = [];
  await pdfParse(buffer, {
    pagerender(pageData) {
      return pageData.getTextContent().then(tc => {
        const text = tc.items.map(i => i.str).join(' ');
        pages.push({ page: pageData.pageNumber, text });
        return text;
      });
    }
  });
  cachedPages = pages;
  return pages;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { query } = req.body;
    const pages = await getTextbookPages();

    const match = pages.find(p => p.text.toLowerCase().includes(query.toLowerCase()));
    if (!match) return res.status(200).json({ pdfs: [] });

    const snippet = extractSnippet(match.text, query);
    res.status(200).json({
      pdfs: [{
        title: '📄 Physics Textbook',
        url: 'textbook.pdf',
        pageNumber: match.page,
        snippet,
        content: extractSnippet(match.text, query, 1500)
      }]
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function extractSnippet(text, query, maxLength = 300) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.substring(0, maxLength);
  const start = Math.max(0, idx - 100);
  return text.substring(start, Math.min(text.length, start + maxLength));
}
