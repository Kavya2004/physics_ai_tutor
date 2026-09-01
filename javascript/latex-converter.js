// latex-converter.js
// ──────────────────────────────────────────────────────────────────────────────
// Helper utilities for text that appears OUTSIDE math delimiters.
// Markdown formatting (bold, italic, lists, code, tables) is now handled by
// marked.js in tutor-chat.js. This file only provides:
//   • Greek-symbol / operator text substitutions (for plain-text contexts)
//   • HTML table conversion for any pipe-tables marked misses
//   • URL protection helper used by other modules
// ──────────────────────────────────────────────────────────────────────────────

const SYMBOL_MAP = {
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ',
    '\\epsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ',
    '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ', '\\mu': 'μ',
    '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ',
    '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ',
    '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
    '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ',
    '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Phi': 'Φ',
    '\\Psi': 'Ψ', '\\Omega': 'Ω',
    '\\infty': '∞', '\\pm': '±', '\\mp': '∓',
    '\\times': '×', '\\div': '÷', '\\cdot': '·',
    '\\leq': '≤', '\\geq': '≥', '\\neq': '≠',
    '\\approx': '≈', '\\equiv': '≡', '\\propto': '∝',
    '\\subset': '⊂', '\\supset': '⊃', '\\in': '∈',
    '\\notin': '∉', '\\cup': '∪', '\\cap': '∩',
    '\\sum': '∑', '\\prod': '∏', '\\int': '∫',
    '\\sqrt': '√', '\\partial': '∂', '\\nabla': '∇'
};

// ---------------------------------------------------------------------------
// convertLatexToUnicode
// Used only for plain-text contexts (e.g. PDF export, clipboard copy).
// Does NOT process markdown — marked.js handles that in the chat pipeline.
// ---------------------------------------------------------------------------
function convertLatexToUnicode(text) {
    if (!text) return text;

    // Protect URLs from symbol substitution
    const urlMap = new Map();
    let idx = 0;
    let result = text.replace(/https?:\/\/[^\s)]+/g, (url) => {
        const key = `URLPROTECTED${idx++}`;
        urlMap.set(key, url);
        return key;
    });

    // Substitute Greek letters and math operators
    for (const [latex, unicode] of Object.entries(SYMBOL_MAP)) {
        result = result.replace(new RegExp(latex.replace(/\\/g, '\\\\'), 'g'), unicode);
    }

    // Restore URLs
    for (const [key, url] of urlMap) {
        result = result.replace(new RegExp(key, 'g'), url);
    }

    return result;
}

// ---------------------------------------------------------------------------
// convertMarkdownTables  (fallback — marked.js handles GFM tables natively)
// Kept so any external callers don't break.
// ---------------------------------------------------------------------------
function convertMarkdownTables(text) {
    return text; // no-op: marked.js handles tables
}

// ---------------------------------------------------------------------------
// convertLatexTables  (fallback for legacy callers)
// ---------------------------------------------------------------------------
function convertLatexTables(text) {
    return text; // no-op: marked.js handles tables
}

window.convertLatexToUnicode = convertLatexToUnicode;
window.convertLatexTables    = convertLatexTables;
window.convertMarkdownTables = convertMarkdownTables;
window.SYMBOL_MAP            = SYMBOL_MAP;
