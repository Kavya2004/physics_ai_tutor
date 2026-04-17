import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedText = null;

async function getTextbookText() {
  if (cachedText) return cachedText;
  const pdfPath = join(__dirname, '..', 'textbook.pdf');
  const buffer = readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  cachedText = data.text;
  return cachedText;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { query } = req.body;

    const text = await getTextbookText();

    if (!text.toLowerCase().includes(query.toLowerCase())) {
      return res.status(200).json({ pdfs: [] });
    }

    const snippet = extractRelevantSnippet(text, query);
    res.status(200).json({
      pdfs: [{
        title: '📄 Physics Textbook',
        url: 'textbook.pdf',
        snippet,
        content: extractRelevantSnippet(text, query, 1500)
      }]
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function extractRelevantSnippet(text, query, maxLength = 300) {
  const queryIndex = text.toLowerCase().indexOf(query.toLowerCase());
  if (queryIndex === -1) return text.substring(0, maxLength);
  const start = Math.max(0, queryIndex - 100);
  const end = Math.min(text.length, queryIndex + query.length + 200);
  return text.substring(start, end);
}
