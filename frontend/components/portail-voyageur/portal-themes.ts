/**
 * Portal Themes — 3 designs élégants prédéfinis pour le portail voyageur.
 *
 * Chaque thème définit :
 *   - Palette de couleurs (hero, boutons, accents, cards)
 *   - Gradients du hero carousel
 *   - Style des boutons (book, pay, nav)
 *   - Ambiance générale (textures, ombres)
 *
 * Le themeId est persisté dans TenantPortalConfig.themeId.
 */

export interface PortalTheme {
  id: string;
  name: string;
  description: string;
  // Hero carousel backgrounds
  heroScenes: { bg: string; overlay: string }[];
  // Hex colors for inline styles (Tailwind can't do dynamic classes)
  accent: string;        // primary accent hex (#d97706)
  accentLight: string;   // light accent hex (#fef3c7)
  accentDark: string;    // darker accent hex (#92400e)
  secondary: string;     // secondary color hex
}

// ═══════════════════════════════════════════════════════════════════════════════
// Theme 1: Ambre Luxe — Or & noir, premium, chaleureux
// ═══════════════════════════════════════════════════════════════════════════════

const AMBER_LUXURY: PortalTheme = {
  id: 'amber-luxury',
  name: 'Ambre Luxe',
  description: 'Or & noir — premium, chaleureux, élégant',
  heroScenes: [
    { bg: 'linear-gradient(160deg, #1a0a00 0%, #3d1a00 20%, #b45309 45%, #f59e0b 65%, #fbbf24 80%, #fef3c7 100%)', overlay: 'radial-gradient(ellipse 120% 60% at 50% 80%, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)' },
    { bg: 'linear-gradient(175deg, #0c1445 0%, #1e3a5f 30%, #b45309 60%, #d97706 75%, #1e293b 100%)', overlay: 'radial-gradient(ellipse 100% 50% at 50% 90%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)' },
    { bg: 'linear-gradient(165deg, #0f0a05 0%, #44200d 25%, #92400e 50%, #d97706 70%, #fbbf24 90%, #fffbeb 100%)', overlay: 'radial-gradient(ellipse 110% 55% at 45% 85%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)' },
    { bg: 'linear-gradient(150deg, #0a0a0a 0%, #1c1917 25%, #292524 40%, #44403c 55%, #78716c 75%, #d6d3d1 100%)', overlay: 'radial-gradient(ellipse 90% 60% at 50% 75%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)' },
  ],
  accent: '#d97706',
  accentLight: '#fef3c7',
  accentDark: '#92400e',
  secondary: '#1e293b',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Theme 2: Océan Bleu — Bleu profond, confiance, sérénité
// ═══════════════════════════════════════════════════════════════════════════════

const OCEAN_BLUE: PortalTheme = {
  id: 'ocean-blue',
  name: 'Océan Bleu',
  description: 'Bleu profond & cyan — confiance, sérénité, prestige maritime',
  heroScenes: [
    { bg: 'linear-gradient(160deg, #020617 0%, #0c1e3e 20%, #1e40af 45%, #2563eb 65%, #60a5fa 85%, #dbeafe 100%)', overlay: 'radial-gradient(ellipse 120% 60% at 50% 80%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 50%, transparent 100%)' },
    { bg: 'linear-gradient(170deg, #0f172a 0%, #1e3a5f 30%, #0369a1 55%, #0284c7 70%, #0ea5e9 85%, #e0f2fe 100%)', overlay: 'radial-gradient(ellipse 100% 55% at 55% 85%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
    { bg: 'linear-gradient(155deg, #020617 0%, #0f1b3d 25%, #1d4ed8 50%, #3b82f6 70%, #93c5fd 90%, #eff6ff 100%)', overlay: 'radial-gradient(ellipse 110% 55% at 45% 80%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
    { bg: 'linear-gradient(165deg, #030712 0%, #111827 20%, #1f2937 35%, #0e7490 55%, #06b6d4 75%, #cffafe 100%)', overlay: 'radial-gradient(ellipse 100% 60% at 50% 80%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
  ],
  accent: '#2563eb',
  accentLight: '#dbeafe',
  accentDark: '#1e40af',
  secondary: '#0f172a',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Theme 3: Émeraude Nature — Vert & doré, naturel, premium
// ═══════════════════════════════════════════════════════════════════════════════

const EMERALD_NATURE: PortalTheme = {
  id: 'emerald-nature',
  name: 'Émeraude Nature',
  description: 'Vert émeraude & or — naturel, éco-premium, raffiné',
  heroScenes: [
    { bg: 'linear-gradient(160deg, #022c22 0%, #064e3b 20%, #059669 45%, #10b981 65%, #6ee7b7 85%, #ecfdf5 100%)', overlay: 'radial-gradient(ellipse 120% 60% at 50% 80%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 50%, transparent 100%)' },
    { bg: 'linear-gradient(170deg, #0a1a0f 0%, #14532d 30%, #15803d 55%, #16a34a 70%, #4ade80 85%, #dcfce7 100%)', overlay: 'radial-gradient(ellipse 100% 55% at 55% 85%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
    { bg: 'linear-gradient(155deg, #0a0f0a 0%, #1a2e1a 25%, #166534 50%, #22c55e 70%, #86efac 90%, #f0fdf4 100%)', overlay: 'radial-gradient(ellipse 110% 55% at 45% 80%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
    { bg: 'linear-gradient(165deg, #0a0a05 0%, #1c1917 20%, #365314 35%, #84cc16 55%, #d97706 75%, #fef3c7 100%)', overlay: 'radial-gradient(ellipse 100% 60% at 50% 80%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)' },
  ],
  accent: '#059669',
  accentLight: '#ecfdf5',
  accentDark: '#064e3b',
  secondary: '#1a2e1a',
};

// ═══════════════════════════════════════════════════════════════════════════════

export const PORTAL_THEMES: Record<string, PortalTheme> = {
  'amber-luxury': AMBER_LUXURY,
  'ocean-blue': OCEAN_BLUE,
  'emerald-nature': EMERALD_NATURE,
};

export const PORTAL_THEMES_LIST = [AMBER_LUXURY, OCEAN_BLUE, EMERALD_NATURE];

export const DEFAULT_THEME_ID = 'amber-luxury';

export function getTheme(id?: string | null): PortalTheme {
  return PORTAL_THEMES[id ?? DEFAULT_THEME_ID] ?? AMBER_LUXURY;
}
