# Bibliothèque de prompts — Images landing TransLog Pro

Guide de prompts à copier-coller dans **Midjourney v6**, **DALL·E 3** (ChatGPT), **Flux Pro** ou **Stable Diffusion XL**. Chaque asset a un prompt principal (light mode) et une variante dark mode.

> **Palette produit** : teal primaire `#0d9488`, teal foncé `#0f766e`, accent ambre `#f59e0b`, neutres slate.
> **Style général** : moderne, épuré, Linear/Stripe/Vercel, pas photoréaliste saturé, pas 3D flashy.
> **Formats cibles** : WebP. Hero = 1600×1000. Sections = 1200×800. Phone mockup = 800×1600. Africa map = carré 1000×1000.
> **À livrer dans** `frontend/public/landing/` — chaque asset en paire `xxx-light.webp` + `xxx-dark.webp`.

---

## 1. Hero — Dashboard mockup principal

Remplace `DashboardMockup()`. Le plus important : doit claquer en 2 secondes.

### Prompt light
```
Ultra-clean SaaS dashboard UI screenshot, logistics & transport analytics,
browser window with chrome, sidebar with icons, 4 KPI cards at top (revenue,
tickets sold, parcels in transit, fill rate), one elegant teal area chart
with smooth curve, data table with 3 customer rows, typography Inter,
palette: white background, teal #0d9488 accents, slate 50 surfaces,
subtle shadows, generous spacing, very minimal, product photography style,
16:10 aspect ratio, crisp retina display, not cluttered, enterprise software
UI, 2026 design trends, no stock photo feel
```
Négatif : `3D render, glossy, saturated colors, photorealistic humans, emojis, clipart`

### Prompt dark (variante)
```
Same dashboard layout, dark mode: slate-900 background, slate-800 surfaces,
teal #2dd4bf accents glowing subtly, white text, same composition,
subtle ambient glow behind hero, enterprise-grade dark UI
```

---

## 2. Deep Dive #1 — Vente d'un billet (Billetterie)

Remplace `SellTicketMockup()`. Aspect : 1200×900.

### Prompt
```
SaaS admin interface: ticket selling screen for an African bus transport
company, clean browser mockup. Visible fields: route "Brazzaville →
Pointe-Noire", date "Tomorrow 07:30", seat "12A", passenger "M. Nganga",
phone number partially masked. Payment buttons row: MTN, Airtel, Wave, Cash.
A small green OFFLINE badge in the corner. Total amount 15,750 FCFA clearly
visible. A big teal "Confirm & Print" button at the bottom. Design style:
Linear / Notion, teal #0d9488 primary color, Inter typography, plenty of
whitespace, rounded corners, subtle borders, on light slate-50 background.
Framed in a browser window with the URL "acme.translogpro.com/admin/sell".
1200x900, crisp, no humans, no emojis.
```

---

## 3. Deep Dive #2 — CRM Customer 360

Remplace `CrmMockup()`. Aspect : 1200×900.

### Prompt
```
SaaS CRM customer profile card, 360-degree view. Large avatar initials "MN"
in a teal gradient circle, name "Moussa Ndiaye", VIP amber badge, masked
phone +221 77 ••• •234, "Customer since March 2023 · Dakar". Below: three
stat boxes (Tickets: 42, Parcels: 9, Total spent: 685k FCFA). A row of
preference tags (Seat 12A, Morning, Dakar → Thiès, Premium fare). A small
AI suggestion box at the bottom: "Propose seat 12A on tomorrow's trip —
84% purchase probability". Design: Linear-like, minimal, light mode on
slate-50, teal #0d9488 accents, rounded cards, browser frame with URL
"acme.translogpro.com/admin/crm". 1200x900, no clipart.
```

---

## 4. Deep Dive #3 — Analytics & Yield

Remplace `AnalyticsMockup()`. Aspect : 1200×900.

### Prompt
```
SaaS analytics dashboard, yield management for a transport company. Large
area chart showing revenue trend over 7 days (teal line, subtle gradient
fill), with a dashed grey baseline (demand). Three KPI pills above the
chart: Revenue +22%, Fill rate 86%, Forecast D+7 +12%. Below the chart:
three AI recommendation rows — "Brazzaville → Dolisie (Sun): +5%" in green,
"Pointe-Noire → Owando (Sat): -8%" in amber, "Dakar → Thiès (Mon 07:30):
Open upgrade" in neutral. A small AI sparkles badge. Design: ultra-clean,
Linear-style, teal #0d9488, Inter font, browser chrome with URL
"acme.translogpro.com/admin/analytics". 1200x900, enterprise software.
```

---

## 5. Africa Coverage — Map illustrée

Remplace `AfricaMap()`. Aspect : carré 1000×1000.

### Prompt
```
Minimal editorial illustration of the African continent, solid teal
silhouette with subtle radial gradient, 9 pulsating teal dots marking
major cities (Casablanca, Dakar, Abidjan, Lagos, Douala, Brazzaville,
Kinshasa, Lomé, Cotonou) with tiny concentric rings like GPS pings.
Flat design, no country borders shown, no text labels, not realistic
cartography. Clean light background. Style: Stripe illustrations, calm
editorial, 1000x1000, teal #0d9488 with slate accents.
```

### Variante animée (optionnel — Lottie / after-effects)
Si tu veux une version animée : même composition, les 9 points émettent des pulses circulaires en boucle (2s offset entre chaque).

---

## 6. Mobile Companion — Phone mockup réel

Remplace `PhoneMockup()`. Aspect : 800×1600.

### Prompt
```
Mobile app mockup, modern smartphone frame (iPhone-style but neutral, no
Apple branding), screen shows a bus ticket booking app in French. Visible:
top bar "📍 Dakar" + user avatar icon. A highlighted card "Tomorrow 07:30
— Dakar → Abidjan — from 28,000 FCFA" with a teal gradient. Below, three
trip options with times "07:30 → 13:00", "09:15 → 15:40", "13:00 → 18:30"
— first one highlighted teal. Bottom big teal button "Reserve · Mobile
Money" with a QR icon. Style: minimal, Inter font, light mode, teal
#0d9488 accents. Floating phone on a soft gradient background (white to
very light teal). 800x1600, crisp, modern, product-focused, no hands
holding the phone.
```

---

## 7. Hero backdrop — décor ambient (optionnel)

Couche décorative derrière le hero, peut remplacer le gradient CSS actuel.

### Prompt
```
Abstract background gradient for a SaaS hero section, soft radial glow
in teal #0d9488 fading to pure white, subtle noise grain, very minimal
dot pattern at low opacity. No objects, no shapes. Editorial, calm,
Stripe-like aesthetic. 1920x1080, light mode.
```

---

## 8. Badges de paiement (Mobile Money operators)

Remplace le composant `PayBadge` qui affiche du texte. À faire en SVG ou WebP, très petits (64×64).

### Demande
Je recommande d'utiliser les logos officiels fournis par les opérateurs (MTN MoMo, Airtel, Orange Money, Wave, Visa, Mastercard) pour le trust bar. Les télécharger depuis leur brand kit officiel plutôt que de les générer via IA (risque juridique). Liens :
- MTN MoMo : https://www.mtn.com/brand-centre
- Airtel : https://www.airtel.africa/business/branding
- Orange Money : https://www.orange.com/en/press/materials
- Wave : https://www.wave.com/en/press/
- Visa & Mastercard : brand centers officiels

Les placer dans `frontend/public/landing/payments/` en WebP + SVG.

---

## 9. Screenshots "réels" du produit (captures in-app)

Pour les sections Deep Dive, si tu préfères des captures 100% authentiques plutôt que des prompts IA :

**Commande Playwright à lancer une fois l'app seed :**
```bash
# À créer en phase ultérieure
npx playwright test test/screenshots/landing.spec.ts --update-snapshots
```
Ce test naviguera sur les pages `/admin/sell-ticket`, `/admin/crm/customers/:id`, `/admin/analytics/yield` en mode light + dark et capturera des PNG en 1600×1000. Idée : je peux le coder dans une phase ultérieure.

En attendant, les prompts IA ci-dessus font des mockups suffisamment réalistes pour la v1.

---

## 10. OpenGraph / social preview

Pour le partage sur LinkedIn, X, WhatsApp. Format : **1200×630**.

### Prompt
```
Social media preview card for TransLog Pro SaaS. Centered: bold title
"TransLog Pro", tagline "The SaaS platform for African transport" below.
A subtle dashboard mockup silhouette in the background, teal #0d9488
gradient overlay, slate-900 base. Minimal, professional, legible at thumbnail
size. 1200x630, no humans, no emojis, no clipart.
```

À sauver comme `frontend/public/landing/og-image.webp` et référencer dans `<meta property="og:image" ...>` (à ajouter à `frontend/index.html`).

---

## Méta — Où placer les fichiers

```
frontend/public/landing/
├── hero-dashboard-light.webp      (#1)
├── hero-dashboard-dark.webp       (#1 variante)
├── deepdive-sell-light.webp       (#2)
├── deepdive-sell-dark.webp
├── deepdive-crm-light.webp        (#3)
├── deepdive-crm-dark.webp
├── deepdive-analytics-light.webp  (#4)
├── deepdive-analytics-dark.webp
├── africa-map.svg                 (#5, SVG idéal pour net)
├── mobile-companion.webp          (#6)
├── hero-backdrop.webp             (#7, optionnel)
├── payments/                      (#8 — logos officiels)
│   ├── momo.svg
│   ├── airtel.svg
│   ├── orange.svg
│   ├── wave.svg
│   ├── visa.svg
│   └── mastercard.svg
└── og-image.webp                  (#10)
```

## Méta — Comment les brancher

Dès que tu me donnes les assets (ou que tu les déposes dans `frontend/public/landing/`), je remplace les mockups SVG actuels dans [PublicLanding.tsx](frontend/components/public/PublicLanding.tsx) par un composant `<picture>` avec les deux sources (light + dark) via `prefers-color-scheme` ou selon la classe `.dark` sur `<html>`. Exemple :

```tsx
<picture>
  <source srcSet="/landing/hero-dashboard-dark.webp"  media="(prefers-color-scheme: dark)" />
  <img src="/landing/hero-dashboard-light.webp" alt={t('landing.hero.mockupTitle')} loading="eager" />
</picture>
```

Je gèrerai aussi le loading prioritaire (`loading="eager"` pour hero, `loading="lazy"` pour le reste) et les dimensions explicites pour éviter le CLS.

---

## Quelles images prioriser

Si tu ne dois en générer que 3 pour le premier jet : **#1 hero**, **#6 mobile**, **#10 OpenGraph**. Les autres mockups SVG actuels de la landing sont déjà très propres et peuvent rester pour une v1 publique sans rougir.
