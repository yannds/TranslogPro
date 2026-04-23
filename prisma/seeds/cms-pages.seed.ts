/**
 * cms-pages.seed.ts — Contenu CMS par défaut pour les portails publics.
 *
 * Crée (idempotent) :
 *   - TenantPage "about"   (fr + en) — JSON structuré
 *   - TenantPage "fleet"   (fr + en) — HTML template galerie véhicules
 *   - TenantPage "contact" (fr + en) — JSON structuré
 *   - TenantPost  (fr)     — Article de bienvenue
 *   - TenantPortalConfig   — Créé si inexistant avec sections activées
 *
 * Appelé depuis dev.seed.ts et depuis l'onboarding tenant.
 */
import type { PrismaClient } from '@prisma/client';

interface CmsSeedOptions {
  companyName: string;
  city:        string;
  country:     string;
  phone?:      string;
  email?:      string;
}

// ─── Templates JSON — pages système ──────────────────────────────────────────

function aboutContentFr(o: CmsSeedOptions): string {
  return JSON.stringify({
    description: `${o.companyName} est une compagnie de transport voyageurs desservant les principales destinations de la région. Notre mission : relier les hommes, les familles et les opportunités avec fiabilité et confort.`,
    features: [
      { icon: 'Shield', title: 'Sécurité avant tout',    description: 'Véhicules inspectés, chauffeurs formés, standards internationaux.' },
      { icon: 'Clock',  title: 'Ponctualité',            description: 'Horaires tenus, voyageurs informés en temps réel.' },
      { icon: 'Star',   title: 'Confort de voyage',      description: 'Sièges larges, climatisation, bagages inclus.' },
      { icon: 'Heart',  title: 'Service client dédié',   description: 'Une équipe disponible à chaque étape de votre trajet.' },
    ],
  });
}

function aboutContentEn(o: CmsSeedOptions): string {
  return JSON.stringify({
    description: `${o.companyName} is a passenger transport company serving the main destinations of the region. Our mission: connecting people, families and opportunities with reliability and comfort.`,
    features: [
      { icon: 'Shield', title: 'Safety first',        description: 'Inspected vehicles, trained drivers, international standards.' },
      { icon: 'Clock',  title: 'Punctuality',         description: 'On-time schedules, passengers informed in real time.' },
      { icon: 'Star',   title: 'Travel comfort',      description: 'Wide seats, air conditioning, luggage included.' },
      { icon: 'Heart',  title: 'Dedicated service',   description: 'A team available at every step of your journey.' },
    ],
  });
}

function contactContentFr(o: CmsSeedOptions): string {
  return JSON.stringify({
    address:   `Gare routière principale, ${o.city}, ${o.country}`,
    phone:     o.phone ?? '+000 000 000 000',
    email:     o.email ?? 'contact@votresociete.com',
    hours:     'Lun–Sam 06h–20h · Dim 07h–18h',
    mapEmbed:  null,
    formEnabled: true,
  });
}

function contactContentEn(o: CmsSeedOptions): string {
  return JSON.stringify({
    address:   `Main bus terminal, ${o.city}, ${o.country}`,
    phone:     o.phone ?? '+000 000 000 000',
    email:     o.email ?? 'contact@yourcompany.com',
    hours:     'Mon–Sat 06:00–20:00 · Sun 07:00–18:00',
    mapEmbed:  null,
    formEnabled: true,
  });
}

// ─── Template HTML — page Notre Flotte ───────────────────────────────────────

function fleetHtmlFr(o: CmsSeedOptions): string {
  return `<section class="prose max-w-none">
  <h2>Notre flotte de véhicules</h2>
  <p>${o.companyName} exploite une flotte moderne et entretenue, sélectionnée pour garantir votre confort et votre sécurité sur toutes les lignes.</p>

  <h3>Nos catégories de véhicules</h3>
  <ul>
    <li><strong>Classe Confort</strong> — grands autocars climatisés, sièges inclinables, Wi-Fi, prises USB. Idéal pour les longs trajets.</li>
    <li><strong>Classe Standard</strong> — autocars fiables et confortables pour toutes les lignes du réseau.</li>
    <li><strong>Express</strong> — minibus rapides pour les liaisons courtes entre villes.</li>
  </ul>

  <h3>Équipements à bord</h3>
  <ul>
    <li>Climatisation individuelle</li>
    <li>Bagagerie en soute sécurisée</li>
    <li>Sièges numérotés (réservation en ligne)</li>
    <li>Wi-Fi embarqué (classe Confort)</li>
    <li>Prises USB / 220V (classe Confort)</li>
    <li>Toilettes à bord (longs trajets)</li>
  </ul>

  <h3>Entretien et sécurité</h3>
  <p>Chaque véhicule passe une inspection technique complète avant chaque départ. Nos techniciens certifiés garantissent des standards de maintenance conformes aux réglementations en vigueur.</p>

  <p><em>La galerie photographique et les plans de sièges détaillés par véhicule seront disponibles prochainement.</em></p>
</section>`;
}

function fleetHtmlEn(o: CmsSeedOptions): string {
  return `<section class="prose max-w-none">
  <h2>Our vehicle fleet</h2>
  <p>${o.companyName} operates a modern, well-maintained fleet selected to guarantee your comfort and safety on all routes.</p>

  <h3>Our vehicle categories</h3>
  <ul>
    <li><strong>Comfort Class</strong> — large air-conditioned coaches, reclining seats, Wi-Fi, USB ports. Ideal for long journeys.</li>
    <li><strong>Standard Class</strong> — reliable, comfortable coaches for all network routes.</li>
    <li><strong>Express</strong> — fast minibuses for short inter-city connections.</li>
  </ul>

  <h3>On-board equipment</h3>
  <ul>
    <li>Individual air conditioning</li>
    <li>Secure luggage storage</li>
    <li>Numbered seats (online booking)</li>
    <li>On-board Wi-Fi (Comfort class)</li>
    <li>USB / 220V outlets (Comfort class)</li>
    <li>On-board toilets (long journeys)</li>
  </ul>

  <h3>Maintenance and safety</h3>
  <p>Each vehicle undergoes a full technical inspection before every departure. Our certified technicians ensure maintenance standards comply with applicable regulations.</p>

  <p><em>Photo gallery and detailed seat maps per vehicle coming soon.</em></p>
</section>`;
}

// ─── Template Post — article de bienvenue ────────────────────────────────────

function welcomePostFr(o: CmsSeedOptions) {
  const slug = `bienvenue-sur-${o.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  return {
    title:      `Bienvenue sur le portail ${o.companyName}`,
    slug:       slug.slice(0, 80),
    excerpt:    `Retrouvez ici toutes les actualités, promotions et informations utiles pour voyager avec ${o.companyName}.`,
    content:    `<p>Nous sommes heureux de vous accueillir sur notre nouveau portail voyageurs. Vous y trouverez :</p>
<ul>
  <li>La réservation en ligne de vos billets</li>
  <li>Le suivi de vos colis</li>
  <li>Toutes nos actualités et offres promotionnelles</li>
</ul>
<p>N'hésitez pas à nous contacter pour toute question.</p>
<p><strong>L'équipe ${o.companyName}</strong></p>`,
    locale:     'fr',
    published:  true,
    publishedAt: new Date(),
    authorName: `L'équipe ${o.companyName}`,
    tags:       ['bienvenue', 'actualités'],
  };
}

// ─── Fonction principale ──────────────────────────────────────────────────────

export async function seedCmsPages(
  prisma: PrismaClient,
  tenantId: string,
  options: CmsSeedOptions,
): Promise<{ pages: number; posts: number; configCreated: boolean }> {
  let pages = 0;
  let posts = 0;

  // ── 1. TenantPortalConfig — créer si inexistant ───────────────────────────
  const existing = await prisma.tenantPortalConfig.findUnique({ where: { tenantId } });
  const configCreated = !existing;
  if (!existing) {
    await prisma.tenantPortalConfig.create({
      data: {
        tenantId,
        showAbout:   true,
        showFleet:   true,
        showNews:    true,
        showContact: true,
        newsCmsEnabled: false,
      },
    });
  }

  // ── 2. Pages CMS ─────────────────────────────────────────────────────────

  const pageDefs = [
    // About — fr
    { slug: 'about', locale: 'fr', title: `À propos — ${options.companyName}`,  content: aboutContentFr(options),  sortOrder: 1, published: true,  showInFooter: true  },
    // About — en
    { slug: 'about', locale: 'en', title: `About — ${options.companyName}`,     content: aboutContentEn(options),  sortOrder: 1, published: true,  showInFooter: true  },
    // Fleet — fr
    { slug: 'fleet', locale: 'fr', title: `Notre flotte — ${options.companyName}`, content: fleetHtmlFr(options),  sortOrder: 2, published: true,  showInFooter: false },
    // Fleet — en
    { slug: 'fleet', locale: 'en', title: `Our fleet — ${options.companyName}`, content: fleetHtmlEn(options),     sortOrder: 2, published: true,  showInFooter: false },
    // Contact — fr
    { slug: 'contact', locale: 'fr', title: 'Contact',                           content: contactContentFr(options), sortOrder: 3, published: true, showInFooter: true  },
    // Contact — en
    { slug: 'contact', locale: 'en', title: 'Contact',                           content: contactContentEn(options), sortOrder: 3, published: true, showInFooter: true  },
  ];

  for (const def of pageDefs) {
    const result = await prisma.tenantPage.upsert({
      where: { tenantId_slug_locale: { tenantId, slug: def.slug, locale: def.locale } },
      update: {},
      create: { tenantId, ...def },
    });
    if (result) pages++;
  }

  // ── 3. Post de bienvenue (fr) ─────────────────────────────────────────────
  const welcomePost = welcomePostFr(options);
  const existingPost = await prisma.tenantPost.findFirst({
    where: { tenantId, slug: welcomePost.slug },
  });
  if (!existingPost) {
    await prisma.tenantPost.create({ data: { tenantId, ...welcomePost } });
    posts++;
  }

  return { pages, posts, configCreated };
}
