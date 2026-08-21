import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { return res.status(405).json({ error: 'Method not allowed' }); }

  try {
    const { data } = req.body; // base64 data URL or raw base64
    if (!data) return res.status(400).json({ error: 'data is required' });

    const base64 = data.includes(',') ? data.split(',')[1] : data;
    const buffer = Buffer.from(base64, 'base64');
    const pdfData = await pdfParse(buffer);
    const text = (pdfData.text || '').replace(/\s+/g, ' ').trim();

    // Return up to 25 000 chars — enough to cover a 5-page problem set
    res.status(200).json({ text: text.slice(0, 25000) });
  } catch (err) {
    console.error('[extract-pdf]', err.message);
    res.status(500).json({ error: err.message });
  }
}
