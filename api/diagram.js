// api/diagram.js - Cloud-based math diagram generator with Gemini AI
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { question, context } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    // Enhanced prompt for diagram generation
    const diagramPrompt = `Create precise mathematical diagrams using exact shapes. Use ONLY numbers in coordinates!

Question: ${question}

Available shapes:
- line: [x1, y1, x2, y2]
- circle: [centerX, centerY, radius] 
- rectangle: [x, y, width, height]
- triangle: [x1, y1, x2, y2, x3, y3]
- arrow: [x1, y1, x2, y2]
- axis: [xMin, xMax, yMin, yMax]
- grid: [xMin, xMax, yMin, yMax, spacing]
- polygon: [x1, y1, x2, y2, x3, y3, ...]
- ellipse: [centerX, centerY, radiusX, radiusY]
- desmos: {expressions: [{latex: "y=x^2", color: "#2d70b3"}], viewport: {left: -10, right: 10, bottom: -10, top: 10}}
- table: {coordinates: [x, y, cellWidth, cellHeight], data: {rows: [["Outcome", "Probability"], ["1", "1/6"], ["2", "1/6"]]}}

Properties:
- color: "#2d70b3", "#388c46", "#6042a6", "#c74440"
- style: "solid", "dashed", "dotted"
- fill: true/false
- lineWidth: 1-5

For graphs, use desmos type with LaTeX expressions.
For tables, use table type with data.rows array.
For geometric shapes, use exact coordinates.
Use grid and axis for mathematical contexts.

Example probability tree:
{
  "needsDiagram": true,
  "instructions": {
    "title": "Probability Tree",
    "elements": [
      {"type": "grid", "coordinates": [-5, 5, -3, 3, 1], "color": "#f0f0f0"},
      {"type": "axis", "coordinates": [-5, 5, -3, 3], "color": "#333"},
      {"type": "circle", "coordinates": [0, 0, 0.2], "color": "#2d70b3", "fill": true},
      {"type": "line", "coordinates": [0, 0, -2, 1], "color": "#333"},
      {"type": "line", "coordinates": [0, 0, 2, 1], "color": "#333"}
    ]
  }
}

Respond with valid plain JSON only — no HTML encoding, no markdown, no extra text!`;

    const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [{ text: diagramPrompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 4096,
      }
    };

    // Retry logic for 503 errors
    let response;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        
        if (response.ok) break;
        
        if (response.status === 503 && attempts < maxAttempts - 1) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
          continue;
        }
        
        throw new Error(`Gemini API error: ${response.status}`);
      } catch (error) {
        if (attempts === maxAttempts - 1) throw error;
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!generatedText) {
      throw new Error('No response generated from Gemini');
    }

    // Try to parse JSON response
    let diagramData;
    try {
      // Decode HTML entities first (Gemini sometimes returns HTML-encoded text)
      let jsonText = generatedText
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');

      // Extract JSON from markdown code blocks (handles ```json, ``` or `` variants)
      const jsonMatch = jsonText.match(/`{1,3}json\s*([\s\S]*?)`{1,3}/) ||
                        jsonText.match(/`{1,3}\s*([\s\S]*?)`{1,3}/);
      if (jsonMatch) jsonText = jsonMatch[1];

      // Remove JS-style comments (// ... and /* ... */)
      jsonText = jsonText
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

      // Fix other common issues
      jsonText = jsonText
        .replace(/Math\.sqrt\(3\)/g, '1.732')
        .replace(/,\s*([\]\}])/g, '$1');  // trailing commas

      // Auto-close truncated JSON
      const opens = (jsonText.match(/[{[]/g) || []).length;
      const closes = (jsonText.match(/[}\]]/g) || []).length;
      if (opens > closes) {
        jsonText = jsonText.replace(/,\s*$/, '').replace(/"[^"]*$/, '');
        const stack = [];
        for (const ch of jsonText) {
          if (ch === '{' || ch === '[') stack.push(ch);
          else if (ch === '}' || ch === ']') stack.pop();
        }
        while (stack.length) {
          jsonText += stack.pop() === '{' ? '}' : ']';
        }
      }

      diagramData = JSON.parse(jsonText.trim());
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      // If JSON parsing fails, create a simple response
      diagramData = {
        needsDiagram: false,
        explanation: 'Failed to parse diagram instructions: ' + generatedText
      };
    }

    res.status(200).json(diagramData);

  } catch (error) {
    console.error('Error in diagram API:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to generate diagram instructions',
      details: error.message,
      stack: error.stack
    });
  }
}