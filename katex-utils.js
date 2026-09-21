// ================================================================
// KATEX UTILS — ARVEXA School
// Normalisation, rendu et correction des formules LaTeX
// À inclure dans toutes les pages qui affichent des maths
// ================================================================

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // MACROS PERSONNALISÉES
  // ═══════════════════════════════════════════════════════════════
  const MACROS = {
    "\\R": "\\mathbb{R}",
    "\\N": "\\mathbb{N}",
    "\\Z": "\\mathbb{Z}",
    "\\Q": "\\mathbb{Q}",
    "\\C": "\\mathbb{C}",
    "\\Re": "\\operatorname{Re}",
    "\\Im": "\\operatorname{Im}",
    "\\arg": "\\operatorname{arg}",
    "\\card": "\\operatorname{card}",
    "\\Vect": "\\overrightarrow",
    "\\norm": "\\left\\|#1\\right\\|",
    "\\abs": "\\left|#1\\right|",
    "\\deriv": "\\frac{d#1}{d#2}",
    "\\derivn": "\\frac{d^{#1}#2}{d#3^{#1}}",
    "\\integral": "\\int_{#1}^{#2}",
    "\\limite": "\\lim_{#1 \\to #2}",
    "\\paren": "\\left(#1\\right)",
    "\\bracket": "\\left[#1\\right]",
    "\\set": "\\left\\{#1\\right\\}"
  };

  // ═══════════════════════════════════════════════════════════════
  // NORMALISATION LATEX
  // ═══════════════════════════════════════════════════════════════
  function normalizeLatex(input) {
    if (!input || typeof input !== 'string') return '';

    let text = String(input);

    // 1. Symboles Unicode → LaTeX
    const unicodeMap = {
      '×': '\\times',
      '÷': '\\div',
      '−': '-',
      '–': '-',
      '—': '-',
      '≠': '\\neq',
      '≤': '\\leq',
      '≥': '\\geq',
      '≈': '\\approx',
      '∞': '\\infty',
      '√': '\\sqrt',
      'π': '\\pi',
      'θ': '\\theta',
      'α': '\\alpha',
      'β': '\\beta',
      'γ': '\\gamma',
      'δ': '\\delta',
      'Δ': '\\Delta',
      'λ': '\\lambda',
      'μ': '\\mu',
      'σ': '\\sigma',
      'Σ': '\\Sigma',
      'φ': '\\phi',
      'ω': '\\omega',
      'Ω': '\\Omega',
      '∫': '\\int',
      '∑': '\\sum',
      '∂': '\\partial',
      '∈': '\\in',
      '∉': '\\notin',
      '⊂': '\\subset',
      '⊃': '\\supset',
      '∪': '\\cup',
      '∩': '\\cap',
      '∀': '\\forall',
      '∃': '\\exists',
      '⇒': '\\Rightarrow',
      '⇔': '\\Leftrightarrow',
      '→': '\\to',
      '↦': '\\mapsto',
      '⟹': '\\Longrightarrow',
      '⟺': '\\Longleftrightarrow',
      '±': '\\pm',
      '∓': '\\mp',
      '⋅': '\\cdot',
      '…': '\\ldots',
      '⋯': '\\cdots',
      '⋯': '\\cdots'
    };

    Object.keys(unicodeMap).forEach((symbol) => {
      text = text.split(symbol).join(unicodeMap[symbol]);
    });

    // 2. Fractions textuelles → LaTeX
    // "1/2" → "\frac{1}{2}"
    text = text.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, '\\frac{$1}{$2}');

    // 3. Exposants textuels : "x^2" OK, "x²" → "x^{2}"
    text = text.replace(/([a-zA-Z0-9])\^(\d+)/g, '$1^{$2}');

    // 4. Indices textuels : "x_1" OK, "x₁" → "x_{1}"
    text = text.replace(/([a-zA-Z0-9])_(\d+)/g, '$1_{$2}');

    // 5. Racines : "sqrt(x)" → "\sqrt{x}"
    text = text.replace(/sqrt\(([^)]+)\)/g, '\\sqrt{$1}');

    // 6. Fonctions trigonométriques
    const funcs = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh'];
    funcs.forEach((fn) => {
      const regex = new RegExp(`(?<![\\\\a-zA-Z])${fn}\\s*\\(`, 'g');
      text = text.replace(regex, `\\${fn}(`);
    });

    // 7. ln, log, exp
    text = text.replace(/(?<![\\a-zA-Z])ln\s*\(/g, '\\ln(');
    text = text.replace(/(?<![\\a-zA-Z])log\s*\(/g, '\\log(');
    text = text.replace(/(?<![\\a-zA-Z])exp\s*\(/g, '\\exp(');

    // 8. Limites : "lim x→0" → "\lim_{x \to 0}"
    text = text.replace(/lim\s+([a-zA-Z])\s*(?:→|\\to|->)\s*([^\s,;)]+)/g, '\\lim_{$1 \\to $2}');

    // 9. Sommes et intégrales
    text = text.replace(/sum\s*\(([^,]+),\s*([^,]+),\s*([^)]+)\)/g, '\\sum_{$1=$2}^{$3}');
    text = text.replace(/int\s*\(([^,]+),\s*([^,]+),\s*([^)]+)\)/g, '\\int_{$1}^{$2} $3 \\, d$1');

    return text;
  }

  // ═══════════════════════════════════════════════════════════════
  // CORRECTION DES DÉLIMITEURS
  // ═══════════════════════════════════════════════════════════════
  function fixDelimiters(text) {
    if (!text || typeof text !== 'string') return '';

    let result = text;

    // Remplacer \( ... \) par $ ... $
    result = result.replace(/\\\((.+?)\\\)/gs, '$$$1$$');

    // Remplacer \[ ... \] par $$ ... $$
    result = result.replace(/\\\[(.+?)\\\]/gs, '$$$$$1$$$$');

    // Corriger les doubles délimiteurs $$...$$...$$ (incohérents)
    result = result.replace(/\$\$\$+/g, '$$');

    // Détecter les formules orphelines (LaTeX sans délimiteurs)
    // Si contient \frac, \sqrt, \lim, \int, \sum sans $ autour
    const patterns = [
      /\\frac\{[^}]+\}\{[^}]+\}/g,
      /\\sqrt\{[^}]+\}/g,
      /\\lim_\{[^}]+\}/g,
      /\\int_\{[^}]+\}/g,
      /\\sum_\{[^}]+\}/g,
      /\\alpha|\\beta|\\gamma|\\theta|\\pi/g
    ];

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDU KATEX COMPLET
  // ═══════════════════════════════════════════════════════════════
  function renderKaTeX(root, options = {}) {
    if (typeof renderMathInElement !== 'function') {
      setTimeout(() => renderKaTeX(root, options), 150);
      return;
    }

    const element = root || document.body;

    // Pré-traitement : normaliser le contenu
    // (utile si le contenu vient d'une API brute)

    try {
      renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          // Délimiteurs supplémentaires pour robustesse
          { left: '\\begin{equation}', right: '\\end{equation}', display: true },
          { left: '\\begin{align}', right: '\\end{align}', display: true },
          { left: '\\begin{cases}', right: '\\end{cases}', display: true },
          { left: '\\begin{matrix}', right: '\\end{matrix}', display: true }
        ],
        throwOnError: false,
        errorColor: '#ff9a84',
        strict: false,
        trust: false,
        macros: {
          ...MACROS,
          ...(options.macros || {})
        },
        // Ignorer les balises spécifiques
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
        ignoredClasses: ['no-katex'],
        ...options
      });
    } catch (error) {
      console.warn('[KaTeX] Erreur de rendu:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDU + NORMALISATION COMBINÉS
  // ═══════════════════════════════════════════════════════════════
  function renderMath(root) {
    const element = root || document.body;

    // Normaliser les nœuds texte contenant des maths
    normalizeTextNodes(element);

    // Rendre avec KaTeX
    renderKaTeX(element);
  }

  function normalizeTextNodes(root) {
    // Récupérer les nœuds texte contenant potentiellement du LaTeX
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node.textContent;
          // Ignorer les nœuds déjà rendus par KaTeX
          if (node.parentElement?.classList?.contains('katex')) {
            return NodeFilter.FILTER_REJECT;
          }
          // Ignorer les nœuds vides
          if (!text || !text.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          // Ne garder que ceux avec des délimiteurs maths
          if (/\$|\\\(|\\\[/.test(text)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    const nodesToFix = [];
    let node;
    while ((node = walker.nextNode())) {
      nodesToFix.push(node);
    }

    // Normaliser chaque nœud
    nodesToFix.forEach((node) => {
      const fixed = fixDelimiters(node.textContent);
      if (fixed !== node.textContent) {
        node.textContent = fixed;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // NETTOYAGE DES PROMPTS IA (côté serveur — export pour usage backend)
  // ═══════════════════════════════════════════════════════════════
  function cleanAIResponse(text) {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text;

    // Retirer les blocs de code markdown
    cleaned = cleaned.replace(/```(?:json|latex|math)?\s*/gi, '');
    cleaned = cleaned.replace(/```/g, '');

    // Retirer les balises HTML éventuelles
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');

    // Normaliser le LaTeX
    cleaned = normalizeLatex(cleaned);

    return cleaned;
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPORT GLOBAL
  // ═══════════════════════════════════════════════════════════════
  window.KaTeXUtils = {
    normalizeLatex,
    fixDelimiters,
    renderKaTeX,
    renderMath,
    cleanAIResponse,
    MACROS
  };

  // Auto-render au chargement du DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Ne rien faire automatiquement, laisser les pages appeler
    });
  }

  console.log('📐 KaTeXUtils chargé');
})();