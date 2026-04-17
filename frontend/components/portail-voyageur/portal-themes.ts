/**
 * Portal Themes — 6 designs pour le portail voyageur.
 *
 * Chaque thème définit :
 *   - Layout structurel (navbar, hero, cards, footer)
 *   - Palette de couleurs (hero, boutons, accents, cards)
 *   - Gradients du hero carousel
 *   - Style des boutons (book, pay, nav)
 *   - Ambiance générale (textures, ombres)
 *
 * Le themeId est persisté dans TenantPortalConfig.themeId.
 */

/**
 * Layout variants — chaque layout = structure HTML/CSS différente :
 *   classic   — layout d'origine (hero plein + search overlay + cards arrondies)
 *   horizon   — minimaliste épuré (nav centré, hero full-vp, search bar flottante, list minimal)
 *   vivid     — moderne split (hero split-screen, search vertical, cards horizontales couleur)
 *   prestige  — luxe classique (navbar sombre, hero letterbox, search inline, cards or)
 */
export type PortalLayout = 'classic' | 'horizon' | 'vivid' | 'prestige';

export interface PortalTheme {
  id: string;
  name: string;
  description: string;
  layout: PortalLayout;
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
  layout: 'classic',
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
  layout: 'classic',
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
  layout: 'classic',
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
// Theme 4: Monochrome — Blanc, gris, noir — minimaliste, ultra-épuré
// ═══════════════════════════════════════════════════════════════════════════════

const MONOCHROME: PortalTheme = {
  id: 'monochrome',
  name: 'Monochrome',
  description: 'Blanc, gris & noir — minimaliste, ultra-épuré, premium',
  layout: 'horizon',
  heroScenes: [
    { bg: 'linear-gradient(160deg, #000000 0%, #1c1c1c 25%, #3a3a3a 50%, #6b6b6b 70%, #a3a3a3 85%, #e5e5e5 100%)', overlay: 'radial-gradient(ellipse 120% 60% at 50% 80%, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 50%, transparent 100%)' },
    { bg: 'linear-gradient(175deg, #0a0a0a 0%, #262626 30%, #525252 55%, #a3a3a3 75%, #d4d4d4 90%, #fafafa 100%)', overlay: 'radial-gradient(ellipse 100% 55% at 55% 85%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
    { bg: 'linear-gradient(155deg, #0a0a0a 0%, #171717 20%, #404040 40%, #737373 60%, #d4d4d4 80%, #f5f5f5 100%)', overlay: 'radial-gradient(ellipse 110% 55% at 45% 80%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)' },
    { bg: 'linear-gradient(165deg, #000000 0%, #0a0a0a 15%, #1c1c1c 30%, #2e2e2e 50%, #525252 70%, #a3a3a3 90%)', overlay: 'radial-gradient(ellipse 100% 60% at 50% 80%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
  ],
  accent: '#404040',
  accentLight: '#f5f5f5',
  accentDark: '#171717',
  secondary: '#0a0a0a',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Theme 5: Pastel Doux — Rose, lavande, menthe — chaleureux, aérien
// ═══════════════════════════════════════════════════════════════════════════════

const PASTEL_SOFT: PortalTheme = {
  id: 'pastel-soft',
  name: 'Pastel Doux',
  description: 'Rose, lavande & menthe — chaleureux, aérien, moderne',
  layout: 'vivid',
  heroScenes: [
    { bg: 'linear-gradient(160deg, #1e1b2e 0%, #2d2545 20%, #7c3aed 40%, #a78bfa 55%, #c4b5fd 70%, #ede9fe 85%, #faf5ff 100%)', overlay: 'radial-gradient(ellipse 120% 60% at 50% 80%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 50%, transparent 100%)' },
    { bg: 'linear-gradient(170deg, #1a1025 0%, #3b1d6e 25%, #8b5cf6 45%, #c084fc 60%, #e9d5ff 75%, #fdf2f8 90%, #fce7f3 100%)', overlay: 'radial-gradient(ellipse 100% 55% at 55% 85%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
    { bg: 'linear-gradient(155deg, #0f1720 0%, #1e3a4a 20%, #0d9488 40%, #5eead4 55%, #99f6e4 70%, #f0fdfa 85%, #fdf4ff 100%)', overlay: 'radial-gradient(ellipse 110% 55% at 45% 80%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
    { bg: 'linear-gradient(165deg, #1c1020 0%, #3d1a4a 20%, #be185d 40%, #f472b6 55%, #fbcfe8 70%, #fce7f3 85%, #faf5ff 100%)', overlay: 'radial-gradient(ellipse 100% 60% at 50% 80%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
  ],
  accent: '#8b5cf6',
  accentLight: '#ede9fe',
  accentDark: '#5b21b6',
  secondary: '#1e1b2e',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Theme 6: Bordeaux Prestige — Bordeaux, or, crème — luxe classique
// ═══════════════════════════════════════════════════════════════════════════════

const BORDEAUX_PRESTIGE: PortalTheme = {
  id: 'bordeaux-prestige',
  name: 'Bordeaux Prestige',
  description: 'Bordeaux, or & crème — luxe classique, raffinement intemporel',
  layout: 'prestige',
  heroScenes: [
    { bg: 'linear-gradient(160deg, #1a0a0f 0%, #3b0a1a 20%, #7f1d1d 40%, #991b1b 55%, #b91c1c 65%, #d4a574 80%, #fef3c7 100%)', overlay: 'radial-gradient(ellipse 120% 60% at 50% 80%, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)' },
    { bg: 'linear-gradient(175deg, #0f0507 0%, #2d0a12 25%, #881337 45%, #be123c 60%, #d4a574 75%, #fde68a 90%, #fefce8 100%)', overlay: 'radial-gradient(ellipse 100% 55% at 55% 85%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' },
    { bg: 'linear-gradient(155deg, #0a0505 0%, #1c0a10 20%, #4c0519 35%, #9f1239 50%, #e11d48 65%, #fda4af 80%, #fff1f2 100%)', overlay: 'radial-gradient(ellipse 110% 55% at 45% 80%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)' },
    { bg: 'linear-gradient(165deg, #0a0505 0%, #1a0f05 15%, #451a03 30%, #92400e 45%, #b45309 55%, #7f1d1d 70%, #3b0a1a 85%, #1a0a0f 100%)', overlay: 'radial-gradient(ellipse 100% 60% at 50% 80%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)' },
  ],
  accent: '#be123c',
  accentLight: '#ffe4e6',
  accentDark: '#881337',
  secondary: '#1a0a0f',
};

// ═══════════════════════════════════════════════════════════════════════════════

export const PORTAL_THEMES: Record<string, PortalTheme> = {
  'amber-luxury': AMBER_LUXURY,
  'ocean-blue': OCEAN_BLUE,
  'emerald-nature': EMERALD_NATURE,
  'monochrome': MONOCHROME,
  'pastel-soft': PASTEL_SOFT,
  'bordeaux-prestige': BORDEAUX_PRESTIGE,
};

export const PORTAL_THEMES_LIST = [AMBER_LUXURY, OCEAN_BLUE, EMERALD_NATURE, MONOCHROME, PASTEL_SOFT, BORDEAUX_PRESTIGE];

export const DEFAULT_THEME_ID = 'amber-luxury';

export function getTheme(id?: string | null): PortalTheme {
  return PORTAL_THEMES[id ?? DEFAULT_THEME_ID] ?? AMBER_LUXURY;
}
