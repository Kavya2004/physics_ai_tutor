// Fallback content with textbook knowledge
const fallbackContent = {
  'newton': {
    title: "Newton's Laws of Motion - Chapter 5",
    content: "Newton's three laws: 1) An object at rest stays at rest unless acted on by a net force. 2) F = ma. 3) For every action there is an equal and opposite reaction."
  },
  'kinematics': {
    title: 'Kinematics - Chapter 3',
    content: 'Kinematics describes motion using displacement, velocity, and acceleration. Key equations: v = v₀ + at, x = x₀ + v₀t + ½at², v² = v₀² + 2aΔx.'
  },
  'energy': {
    title: 'Work and Energy - Chapter 7',
    content: 'Work W = F·d·cosθ. Kinetic energy KE = ½mv². Potential energy PE = mgh. Conservation of energy: total mechanical energy is constant in the absence of non-conservative forces.'
  },
  'momentum': {
    title: 'Momentum and Collisions - Chapter 9',
    content: 'Momentum p = mv. Impulse J = FΔt = Δp. In a closed system, total momentum is conserved. Elastic collisions conserve both momentum and kinetic energy.'
  },
  'gravity': {
    title: 'Gravitation - Chapter 13',
    content: "Newton's law of gravitation: F = Gm₁m₂/r². Near Earth's surface, g ≈ 9.8 m/s². Gravitational potential energy U = -Gm₁m₂/r."
  },
  'waves': {
    title: 'Waves - Chapter 16',
    content: 'Wave speed v = fλ. Transverse waves oscillate perpendicular to propagation; longitudinal waves oscillate parallel. The wave equation: v = √(T/μ) for a string.'
  }
};

import { checkRateLimit, sanitizeInput, validateRequest, createErrorResponse } from '../middleware/security.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Apply rate limiting
    const rateLimitResult = checkRateLimit('search', req);
    if (!rateLimitResult.allowed) {
        return res.status(429).json({
            error: 'Rate limit exceeded',
            retryAfter: rateLimitResult.retryAfter
        });
    }
  
    try {
      // Validate request structure
      const validation = validateRequest(req, ['query']);
      if (!validation.valid) {
          return res.status(400).json({ error: 'Invalid request', details: validation.errors });
      }

      // Sanitize input
      const { query } = sanitizeInput(req.body);
      
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ error: 'Valid search query is required' });
      }

      // Limit query length
      const sanitizedQuery = query.trim().substring(0, 500);
  
      const apiKey = process.env.GOOGLE_CSE_API_KEY;
      const cx = process.env.GOOGLE_CSE_ID;
      
      // Validate API keys if they exist (optional for this endpoint)
      if (apiKey && cx) {
        if (typeof apiKey !== 'string' || apiKey.length < 10 || 
            typeof cx !== 'string' || cx.length < 10) {
          console.warn('Invalid Google API credentials detected');
        }
      }
      
      let results = [];
      
      // Try Google Custom Search first
      if (apiKey && cx) {
        try {
          const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(sanitizedQuery)}`;
          const response = await fetch(searchUrl, {
            timeout: 10000 // 10 second timeout
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.items) {
              results = data.items.slice(0, 3).map(item => {
                // Fix common URL format issues
                let fixedLink = item.link
                  .replace(/₁/g, '_1_')
                  .replace(/₂/g, '_2_')
                  .replace(/₃/g, '_3_')
                  .replace(/₄/g, '_4_')
                  .replace(/₅/g, '_5_')
                  .replace(/basicdefinitions/g, '0_0_introduction');
                
                return {
                  title: item.title,
                  link: fixedLink,
                  snippet: item.snippet
                };
              });
            }
          }
        } catch (searchError) {
          console.warn('Google Search failed, using fallback:', searchError.message);
        }
      }
      
      // If no results or search failed, provide fallback content
      if (results.length === 0) {
        const queryLower = query.toLowerCase();
        const matchedTopic = Object.keys(fallbackContent).find(topic => 
          queryLower.includes(topic)
        );
        
        if (matchedTopic) {
          const fallback = fallbackContent[matchedTopic];
          results = [{
            title: fallback.title,
            link: 'Reference content available below',
            snippet: fallback.content
          }];
        } else {
          results = [{
            title: 'Physics Concepts',
            link: 'Built-in reference',
            snippet: 'This topic relates to fundamental physics concepts. Let me help explain the key principles.'
          }];
        }
      }
  
      res.status(200).json({ results });
    } catch (error) {
      const errorResponse = createErrorResponse(error, false);
      console.error('Search API Error:', errorResponse);
      
      // Provide fallback even on complete failure
      const fallbackResults = [{
        title: 'Physics Reference',
        link: 'Built-in content',
        snippet: 'I can help explain physics concepts based on my training. What specific topic would you like to explore?'
      }];
      
      res.status(200).json({ results: fallbackResults });
    }
  }
  