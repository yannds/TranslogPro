/**
 * PageRouter — Routeur de pages interne au dashboard
 *
 * Stratégie de chargement :
 *   Eager  : pages légères sans dépendances externes (mock data + CSS)
 *   Lazy   : pages avec modules lourds (WorkflowStudio, IAM, Fleet docs, etc.)
 *
 * Le <Suspense> est posé dans AdminDashboard (orchestrateur), pas ici.
 * Ce composant retourne directement le JSX — Suspense l'enveloppe en amont.
 */
import { lazy } from 'react';

// ── Pages internes légères (eager) ────────────────────────────────────────────
import { PageDashboard } from './PageDashboard';
import { PageTrips }     from './PageTrips';
import { PageAnalytics } from './PageAnalytics';
import { PageAiRoutes }  from './PageAiRoutes';
import { PageFleet }     from './PageFleet';
import { PageCashier }   from './PageCashier';
import { PageCrm }       from './PageCrm';
import { PageSafety }    from './PageSafety';
import { PageDisplay }   from './PageDisplay';
import { PageWip }       from './PageWip';

// ── Pages réelles lourdes (lazy — code-split) ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyFleetDocs      = lazy(() => import('../pages/PageFleetDocs').then(m => ({ default: m.PageFleetDocs })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverProfile  = lazy(() => import('../pages/PageDriverProfile').then(m => ({ default: m.PageDriverProfile })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyCrewBriefing   = lazy(() => import('../pages/PageCrewBriefing').then(m => ({ default: m.PageCrewBriefing })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyQhse           = lazy(() => import('../pages/PageQhse').then(m => ({ default: m.PageQhse })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyWorkflowStudio = lazy(() => import('../pages/PageWorkflowStudio').then(m => ({ default: m.PageWorkflowStudio })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyWfBlueprints   = lazy(() => import('../pages/PageWfBlueprints').then(m => ({ default: m.PageWfBlueprints })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyWfMarketplace  = lazy(() => import('../pages/PageWfMarketplace').then(m => ({ default: m.PageWfMarketplace })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyWfSimulate     = lazy(() => import('../pages/PageWfSimulate').then(m => ({ default: m.PageWfSimulate })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyProfitability  = lazy(() => import('../pages/PageProfitability').then(m => ({ default: m.PageProfitability })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyBranding       = lazy(() => import('../pages/PageBranding').then(m => ({ default: m.PageBranding })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyIamUsers       = lazy(() => import('../pages/PageIamUsers').then(m => ({ default: m.PageIamUsers })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyIamRoles       = lazy(() => import('../pages/PageIamRoles').then(m => ({ default: m.PageIamRoles })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyIamAudit       = lazy(() => import('../pages/PageIamAudit').then(m => ({ default: m.PageIamAudit })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyIamSessions    = lazy(() => import('../pages/PageIamSessions').then(m => ({ default: m.PageIamSessions })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyModules        = lazy(() => import('../pages/PageModules').then(m => ({ default: m.PageModules })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyTemplateStudio = lazy(() => import('../pages/PageTemplateStudio').then(m => ({ default: m.PageTemplateStudio })));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageRouterProps {
  activeId: string | null;
}

// ─── Routeur ──────────────────────────────────────────────────────────────────

export function PageRouter({ activeId }: PageRouterProps) {
  switch (activeId) {
    // ── Dashboard ──────────────────────────────────────────────────────────
    case 'dashboard':           return <PageDashboard />;

    // ── Trajets ────────────────────────────────────────────────────────────
    case 'trips':
    case 'trips-list':          return <PageTrips />;
    case 'trips-planning':      return <PageWip title="Planning hebdomadaire" />;
    case 'routes':              return <PageWip title="Lignes & Routes" />;
    case 'trips-delays':        return <PageWip title="Retards & Alertes" />;

    // ── Billetterie ────────────────────────────────────────────────────────
    case 'tickets-new':         return <PageWip title="Vendre un billet" />;
    case 'tickets-list':        return <PageWip title="Billets émis" />;
    case 'tickets-cancel':      return <PageWip title="Annulations" />;

    // ── Colis & Manifestes ─────────────────────────────────────────────────
    case 'manifests':           return <PageWip title="Manifestes" />;
    case 'parcel-new':          return <PageWip title="Enregistrer un colis" />;
    case 'parcels-list':        return <PageWip title="Suivi colis" />;
    case 'shipments':           return <PageWip title="Expéditions groupées" />;

    // ── SAV ────────────────────────────────────────────────────────────────
    case 'sav-claims':          return <PageWip title="Réclamations SAV" />;
    case 'sav-reports':         return <PageWip title="Signalements" />;
    case 'sav-returns':         return <PageWip title="Remboursements" />;

    // ── Finance ────────────────────────────────────────────────────────────
    case 'cashier':             return <PageCashier />;
    case 'pricing-grid':        return <PageWip title="Grille tarifaire" />;
    case 'pricing-yield':       return <LazyProfitability />;
    case 'pricing-promo':       return <PageWip title="Promotions" />;
    case 'invoices':            return <PageWip title="Facturation" />;

    // ── Analytique & IA ────────────────────────────────────────────────────
    case 'analytics':           return <PageAnalytics />;
    case 'ai-routes':           return <PageAiRoutes />;
    case 'ai-fleet':            return <PageWip title="Optimisation flotte" />;
    case 'ai-demand':           return <PageWip title="Prévisions demande" />;
    case 'ai-pricing':          return <PageWip title="Tarifs dynamiques" />;
    case 'reports':             return <PageWip title="Rapports périodiques" />;

    // ── Flotte & Maintenance ───────────────────────────────────────────────
    case 'fleet-vehicles':      return <PageFleet />;
    case 'fleet-seats':         return <PageWip title="Plans de sièges" />;
    case 'maintenance-list':    return <PageWip title="Fiches de maintenance" />;
    case 'maintenance-planning': return <PageWip title="Planning garage" />;
    case 'maintenance-alerts':  return <PageWip title="Alertes techniques" />;
    case 'fleet-docs':
    case 'fleet-docs-alerts':
    case 'fleet-docs-consumables':
    case 'fleet-docs-config':   return <LazyFleetDocs />;

    // ── Chauffeurs & Équipages ─────────────────────────────────────────────
    case 'drivers':
    case 'drivers-list':
    case 'driver-licenses':
    case 'driver-rest':
    case 'driver-trainings':
    case 'driver-remediation':  return <LazyDriverProfile />;
    case 'crew-briefing':       return <LazyCrewBriefing />;
    case 'staff-list':          return <PageWip title="Personnel" />;
    case 'crew-planning':       return <PageWip title="Planning équipages" />;

    // ── QHSE ───────────────────────────────────────────────────────────────
    case 'qhse-accidents':
    case 'qhse-accidents-list':
    case 'qhse-disputes':
    case 'qhse-procedures':     return <LazyQhse />;
    case 'qhse-config':         return <PageWip title="Configuration QHSE" />;

    // ── CRM ────────────────────────────────────────────────────────────────
    case 'crm-clients':         return <PageCrm />;
    case 'crm-campaigns':       return <PageWip title="Campagnes marketing" />;
    case 'crm-loyalty':         return <PageWip title="Programme fidélité" />;
    case 'crm-feedback':        return <PageWip title="Avis & Feedbacks" />;

    // ── Affichage & Sécurité ───────────────────────────────────────────────
    case 'display-screens':     return <PageDisplay />;
    case 'display-quais':       return <PageWip title="Gestion des quais" />;
    case 'display-announcements': return <PageWip title="Annonces gare" />;
    case 'safety-incidents':    return <PageSafety />;
    case 'safety-monitor':      return <PageWip title="Suivi temps réel" />;
    case 'safety-sos':          return <PageWip title="Alertes SOS" />;

    // ── Workflow Studio ────────────────────────────────────────────────────
    case 'workflow-studio':
    case 'wf-designer':         return <LazyWorkflowStudio />;
    case 'wf-blueprints':       return <LazyWfBlueprints />;
    case 'wf-marketplace':      return <LazyWfMarketplace />;
    case 'wf-simulate':         return <LazyWfSimulate />;

    // ── Paramètres & White-label ───────────────────────────────────────────
    case 'modules':             return <LazyModules />;
    case 'white-label':         return <LazyBranding />;
    case 'integrations':        return <PageWip title="Intégrations API" />;
    case 'documents-templates': return <LazyTemplateStudio />;

    // ── IAM ────────────────────────────────────────────────────────────────
    case 'iam-users':           return <LazyIamUsers />;
    case 'iam-roles':           return <LazyIamRoles />;
    case 'iam-audit':           return <LazyIamAudit />;
    case 'iam-sessions':        return <LazyIamSessions />;

    // ── Platform (SUPER_ADMIN) ─────────────────────────────────────────────
    case 'tenants':             return <PageWip title="Gestion des tenants" />;
    case 'platform-staff':      return <PageWip title="Staff plateforme" />;
    case 'impersonation':       return <PageWip title="Impersonation JIT" />;

    // ── Debug ──────────────────────────────────────────────────────────────
    case 'debug-workflow':      return <PageWip title="Workflow debug" />;
    case 'debug-outbox':        return <PageWip title="Outbox replay" />;

    // ── Divers ─────────────────────────────────────────────────────────────
    case 'notifications':       return <PageWip title="Notifications" />;

    default:                    return <PageDashboard />;
  }
}
