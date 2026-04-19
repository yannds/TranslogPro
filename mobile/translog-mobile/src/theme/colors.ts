/**
 * Palette — light mode first, dark: parallèle.
 *
 * Conventions Apple HIG / Android Material :
 *   - Contraste AA (texte ≥ 4.5:1 sur fond) vérifié pour chaque paire
 *   - Touches cibles ≥ 44pt iOS / 48dp Android → gérer via sizes.ts
 */

export const lightColors = {
  background: '#ffffff',
  surface:    '#f8fafc',
  text:       '#0f172a',
  textMuted:  '#64748b',
  primary:    '#0f766e',
  primaryFg:  '#ffffff',
  border:     '#e2e8f0',
  danger:     '#dc2626',
  dangerBg:   '#fef2f2',
  warning:    '#d97706',
  warningBg:  '#fffbeb',
  success:    '#059669',
  successBg:  '#ecfdf5',
  cardShadow: 'rgba(15, 23, 42, 0.06)',
};

export const darkColors: typeof lightColors = {
  background: '#0b1220',
  surface:    '#0f172a',
  text:       '#f1f5f9',
  textMuted:  '#94a3b8',
  primary:    '#2dd4bf',
  primaryFg:  '#0f172a',
  border:     '#1e293b',
  danger:     '#ef4444',
  dangerBg:   '#7f1d1d',
  warning:    '#f59e0b',
  warningBg:  '#78350f',
  success:    '#10b981',
  successBg:  '#064e3b',
  cardShadow: 'rgba(0, 0, 0, 0.45)',
};
