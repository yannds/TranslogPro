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
import { useI18n } from '../../lib/i18n/useI18n';

// ── Pages internes légères (eager) ────────────────────────────────────────────
import { PageDashboard } from './PageDashboard';
import { PageAnalytics } from './PageAnalytics';
import { PageAiRoutes }  from './PageAiRoutes';
import { PageCashier }   from './PageCashier';
import { PageCrm }       from './PageCrm';
import { PageSafety }    from './PageSafety';
import { PageWip }       from './PageWip';

// ── Pages réelles lourdes (lazy — code-split) ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyFleetDocs      = lazy(() => import('../pages/PageFleetDocs').then(m => ({ default: m.PageFleetDocs })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverProfile  = lazy(() => import('../pages/PageDriverProfile').then(m => ({ default: m.PageDriverProfile })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyCrewBriefing   = lazy(() => import('../pages/PageCrewBriefing').then(m => ({ default: m.PageCrewBriefing })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverBriefing = lazy(() => import('../pages/PageDriverBriefing').then(m => ({ default: m.PageDriverBriefing })));
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
const LazyPortalAdmin    = lazy(() => import('../pages/PagePortalAdmin').then(m => ({ default: m.PagePortalAdmin })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyPortalMarket   = lazy(() => import('../pages/PagePortalMarketplace').then(m => ({ default: m.PagePortalMarketplace })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyCmsPages       = lazy(() => import('../pages/PageCmsPages').then(m => ({ default: m.PageCmsPages })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyCmsPosts       = lazy(() => import('../pages/PageCmsPosts').then(m => ({ default: m.PageCmsPosts })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyCompanySetup   = lazy(() => import('../pages/PageCompanySetup').then(m => ({ default: m.PageCompanySetup })));
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
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyPersonnel      = lazy(() => import('../pages/PagePersonnel').then(m => ({ default: m.PagePersonnel })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyAgencies       = lazy(() => import('../pages/PageAgencies').then(m => ({ default: m.PageAgencies })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyStations       = lazy(() => import('../pages/PageStations').then(m => ({ default: m.PageStations })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyCrewPlanning   = lazy(() => import('../pages/PageCrewPlanning').then(m => ({ default: m.PageCrewPlanning })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyTrips          = lazy(() => import('../pages/PageTrips').then(m => ({ default: m.PageTrips })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyTripPlanning   = lazy(() => import('../pages/PageTripPlanning').then(m => ({ default: m.PageTripPlanning })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyRoutes         = lazy(() => import('../pages/PageRoutes').then(m => ({ default: m.PageRoutes })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyTripDelays     = lazy(() => import('../pages/PageTripDelays').then(m => ({ default: m.PageTripDelays })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyFleetVehicles       = lazy(() => import('../pages/PageFleetVehicles').then(m => ({ default: m.PageFleetVehicles })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyFleetSeats          = lazy(() => import('../pages/PageFleetSeats').then(m => ({ default: m.PageFleetSeats })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyFleetTracking       = lazy(() => import('../pages/PageFleetTracking').then(m => ({ default: m.PageFleetTracking })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyMaintenanceList     = lazy(() => import('../pages/PageMaintenanceList').then(m => ({ default: m.PageMaintenanceList })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyMaintenancePlanning = lazy(() => import('../pages/PageMaintenancePlanning').then(m => ({ default: m.PageMaintenancePlanning })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyMaintenanceAlerts   = lazy(() => import('../pages/PageMaintenanceAlerts').then(m => ({ default: m.PageMaintenanceAlerts })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyParcelNew           = lazy(() => import('../pages/PageParcelNew').then(m => ({ default: m.PageParcelNew })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyParcelsList         = lazy(() => import('../pages/PageParcelsList').then(m => ({ default: m.PageParcelsList })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyShipments           = lazy(() => import('../pages/PageShipments').then(m => ({ default: m.PageShipments })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverRest          = lazy(() => import('../pages/PageDriverRest').then(m => ({ default: m.PageDriverRest })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverTrip          = lazy(() => import('../pages/PageDriverTrip').then(m => ({ default: m.PageDriverTrip })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverManifest      = lazy(() => import('../pages/PageDriverManifest').then(m => ({ default: m.PageDriverManifest })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverCheckin       = lazy(() => import('../pages/PageDriverCheckin').then(m => ({ default: m.PageDriverCheckin })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverEvents        = lazy(() => import('../pages/PageDriverEvents').then(m => ({ default: m.PageDriverEvents })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverReport        = lazy(() => import('../pages/PageDriverReport').then(m => ({ default: m.PageDriverReport })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverMaint         = lazy(() => import('../pages/PageDriverMaint').then(m => ({ default: m.PageDriverMaint })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverSchedule      = lazy(() => import('../pages/PageDriverSchedule').then(m => ({ default: m.PageDriverSchedule })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDriverDocs          = lazy(() => import('../pages/PageDriverDocs').then(m => ({ default: m.PageDriverDocs })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazySellTicket          = lazy(() => import('../pages/PageSellTicket').then(m => ({ default: m.PageSellTicket })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyIssuedTickets       = lazy(() => import('../pages/PageIssuedTickets').then(m => ({ default: m.PageIssuedTickets })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyTicketCancellations = lazy(() => import('../pages/PageTicketCancellations').then(m => ({ default: m.PageTicketCancellations })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyManifests           = lazy(() => import('../pages/PageManifests').then(m => ({ default: m.PageManifests })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazySavClaims           = lazy(() => import('../pages/PageSavClaims').then(m => ({ default: m.PageSavClaims })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazySavReports          = lazy(() => import('../pages/PageSavReports').then(m => ({ default: m.PageSavReports })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazySavRefunds          = lazy(() => import('../pages/PageSavRefunds').then(m => ({ default: m.PageSavRefunds })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyTariffGrid          = lazy(() => import('../pages/PageTariffGrid').then(m => ({ default: m.PageTariffGrid })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyInvoices            = lazy(() => import('../pages/PageInvoices').then(m => ({ default: m.PageInvoices })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyPromotions          = lazy(() => import('../pages/PagePromotions').then(m => ({ default: m.PagePromotions })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDisplayGare         = lazy(() => import('../pages/PageDisplayGare').then(m => ({ default: m.PageDisplayGare })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDisplayQuai         = lazy(() => import('../pages/PageDisplayQuai').then(m => ({ default: m.PageDisplayQuai })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDisplayBus          = lazy(() => import('../pages/PageDisplayBus').then(m => ({ default: m.PageDisplayBus })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyAiFleet             = lazy(() => import('../pages/PageAiFleet').then(m => ({ default: m.PageAiFleet })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyAiDemand            = lazy(() => import('../pages/PageAiDemand').then(m => ({ default: m.PageAiDemand })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyAiPricing           = lazy(() => import('../pages/PageAiPricing').then(m => ({ default: m.PageAiPricing })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyReports             = lazy(() => import('../pages/PageReports').then(m => ({ default: m.PageReports })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyNotifications       = lazy(() => import('../pages/PageNotifications').then(m => ({ default: m.PageNotifications })));

// ── Portail Plateforme (SUPER_ADMIN / SUPPORT_L1 / SUPPORT_L2) ────────────────
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyPlatformDashboard   = lazy(() => import('../pages/PagePlatformDashboard').then(m => ({ default: m.PagePlatformDashboard })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyTenants             = lazy(() => import('../pages/PageTenants').then(m => ({ default: m.PageTenants })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyPlatformStaff       = lazy(() => import('../pages/PagePlatformStaff').then(m => ({ default: m.PagePlatformStaff })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyImpersonation       = lazy(() => import('../pages/PageImpersonation').then(m => ({ default: m.PageImpersonation })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDebugWorkflow       = lazy(() => import('../pages/PageDebugWorkflow').then(m => ({ default: m.PageDebugWorkflow })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyDebugOutbox         = lazy(() => import('../pages/PageDebugOutbox').then(m => ({ default: m.PageDebugOutbox })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyPlatformPlans       = lazy(() => import('../pages/PagePlatformPlans').then(m => ({ default: m.PagePlatformPlans })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyPlatformBilling     = lazy(() => import('../pages/PagePlatformBilling').then(m => ({ default: m.PagePlatformBilling })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyPlatformSupport     = lazy(() => import('../pages/PagePlatformSupport').then(m => ({ default: m.PagePlatformSupport })));
// eslint-disable-next-line @typescript-eslint/promise-function-async
const LazyCustomerSupport     = lazy(() => import('../pages/PageCustomerSupport').then(m => ({ default: m.PageCustomerSupport })));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageRouterProps {
  activeId: string | null;
}


// ─── Routeur ──────────────────────────────────────────────────────────────────

export function PageRouter({ activeId }: PageRouterProps) {
  const { t } = useI18n();

  switch (activeId) {
    // ── Dashboard ──────────────────────────────────────────────────────────
    case 'dashboard':           return <PageDashboard />;

    // ── Trajets & Planning ─────────────────────────────────────────────────
    case 'trips':
    case 'trips-list':          return <LazyTrips />;
    case 'trips-planning':      return <LazyTripPlanning />;
    case 'routes':              return <LazyRoutes />;
    case 'trips-delays':        return <LazyTripDelays />;

    // ── Billetterie ────────────────────────────────────────────────────────
    case 'tickets-new':         return <LazySellTicket />;
    case 'tickets-list':        return <LazyIssuedTickets />;
    case 'tickets-cancel':      return <LazyTicketCancellations />;

    // ── Colis & Manifestes ─────────────────────────────────────────────────
    case 'manifests':           return <LazyManifests />;
    case 'parcel-new':          return <LazyParcelNew />;
    case 'parcels-list':        return <LazyParcelsList />;
    case 'shipments':           return <LazyShipments />;

    // ── SAV ────────────────────────────────────────────────────────────────
    case 'sav-claims':          return <LazySavClaims />;
    case 'sav-reports':         return <LazySavReports />;
    case 'sav-returns':         return <LazySavRefunds />;

    // ── Finance ────────────────────────────────────────────────────────────
    case 'cashier':             return <PageCashier />;
    case 'pricing-grid':        return <LazyTariffGrid />;
    case 'pricing-yield':       return <LazyProfitability />;
    case 'pricing-promo':       return <LazyPromotions />;
    case 'invoices':            return <LazyInvoices />;

    // ── Analytique & IA ────────────────────────────────────────────────────
    case 'analytics':           return <PageAnalytics />;
    case 'ai-routes':           return <PageAiRoutes />;
    case 'ai-fleet':            return <LazyAiFleet />;
    case 'ai-demand':           return <LazyAiDemand />;
    case 'ai-pricing':          return <LazyAiPricing />;
    case 'reports':             return <LazyReports />;

    // ── Flotte & Maintenance ───────────────────────────────────────────────
    case 'fleet-vehicles':      return <LazyFleetVehicles />;
    case 'fleet-tracking':      return <LazyFleetTracking />;
    case 'fleet-seats':         return <LazyFleetSeats />;
    case 'maintenance-list':    return <LazyMaintenanceList />;
    case 'maintenance-planning': return <LazyMaintenancePlanning />;
    case 'maintenance-alerts':  return <LazyMaintenanceAlerts />;
    case 'fleet-docs':               return <LazyFleetDocs initialTab="alerts" />;

    // ── Chauffeurs & Équipages ─────────────────────────────────────────────
    // Les onglets internes (licenses/rest/trainings/remediation) sont gérés
    // par la page elle-même ; une seule route parent suffit.
    case 'drivers':             return <LazyDriverProfile initialTab="overview" />;
    case 'crew-briefing':       return <LazyCrewBriefing />;
    case 'drv-briefing':        return <LazyDriverBriefing />;

    // ── Portail Chauffeur (items DRIVER_NAV) ───────────────────────────────
    case 'drv-home':            return <LazyDriverTrip />;
    case 'drv-manifest':        return <LazyDriverManifest />;
    case 'drv-checkin':         return <LazyDriverCheckin />;
    case 'drv-events':          return <LazyDriverEvents />;
    case 'drv-report':          return <LazyDriverReport />;
    case 'drv-maint':           return <LazyDriverMaint />;
    case 'drv-schedule':        return <LazyDriverSchedule />;
    case 'drv-docs':            return <LazyDriverDocs />;
    case 'drv-rest':            return <LazyDriverRest />;
    case 'drv-feedback':        return <PageWip title={t('router.drvFeedback')} />;

    // ── Portail Agent de Gare (items STATION_AGENT_NAV) ────────────────────
    case 'sa-home':             return <PageWip title={t('router.saHome')} />;
    case 'sa-sell':             return <LazySellTicket />;
    case 'sa-checkin':          return <PageWip title={t('router.saCheckin')} />;
    case 'sa-luggage':          return <PageWip title={t('router.saLuggage')} />;
    case 'sa-parcel':           return <PageWip title={t('router.saParcel')} />;
    case 'sa-manifest':         return <PageWip title={t('router.saManifest')} />;
    case 'sa-cashier':          return <PageCashier />;
    case 'sa-receipts':         return <PageWip title={t('router.saReceipts')} />;
    case 'sa-display':          return <LazyDisplayGare />;
    case 'sa-sav':              return <PageWip title={t('router.saIncident')} />;

    // ── Portail Agent de Quai (items QUAI_AGENT_NAV) ───────────────────────
    case 'qa-home':             return <PageWip title={t('router.qaHome')} />;
    case 'qa-scan':             return <PageWip title={t('router.qaScan')} />;
    case 'qa-boarding':         return <PageWip title={t('router.qaBoarding')} />;
    case 'qa-manifest':         return <PageWip title={t('router.qaManifest')} />;
    case 'qa-luggage':          return <PageWip title={t('router.qaLuggage')} />;
    case 'qa-delay':            return <PageWip title={t('router.qaDelay')} />;
    case 'qa-display':          return <LazyDisplayQuai />;
    case 'qa-sav':              return <PageWip title={t('router.qaIncident')} />;
    case 'staff-list':
    case 'personnel':           return <LazyPersonnel />;
    case 'crew-planning':       return <LazyCrewPlanning />;

    // ── QHSE ───────────────────────────────────────────────────────────────
    case 'qhse':                return <LazyQhse />;

    // ── CRM ────────────────────────────────────────────────────────────────
    case 'crm-clients':         return <PageCrm />;
    case 'crm-campaigns':       return <PageWip title={t('router.campaigns')} />;
    case 'crm-loyalty':         return <PageWip title={t('router.loyalty')} />;
    case 'crm-feedback':        return <PageWip title={t('router.feedback')} />;

    // ── Affichage & Sécurité ───────────────────────────────────────────────
    case 'display-screens':     return <LazyDisplayGare />;
    case 'display-quais':       return <LazyDisplayQuai />;
    case 'display-bus':         return <LazyDisplayBus />;
    case 'display-announcements': return <PageWip title={t('router.stationAnnounce')} />;
    case 'safety-incidents':    return <PageSafety />;
    case 'safety-monitor':      return <PageWip title={t('router.liveMonitor')} />;
    case 'safety-sos':          return <PageWip title={t('router.sosAlerts')} />;

    // ── Workflow Studio ────────────────────────────────────────────────────
    case 'workflow-studio':
    case 'wf-designer':         return <LazyWorkflowStudio />;
    case 'wf-blueprints':       return <LazyWfBlueprints />;
    case 'wf-marketplace':      return <LazyWfMarketplace />;
    case 'wf-simulate':         return <LazyWfSimulate />;

    // ── Paramètres & White-label ───────────────────────────────────────────
    case 'agencies':            return <LazyAgencies />;
    case 'stations':            return <LazyStations />;
    case 'modules':             return <LazyModules />;
    case 'white-label':         return <LazyBranding />;
    case 'portal-admin':        return <LazyPortalAdmin />;
    case 'portal-marketplace':  return <LazyPortalMarket />;
    case 'cms-pages':           return <LazyCmsPages />;
    case 'cms-posts':           return <LazyCmsPosts />;
    case 'tenant-company':      return <LazyCompanySetup />;
    case 'integrations':        return <PageWip title={t('router.apiIntegrations')} />;
    case 'documents-templates': return <LazyTemplateStudio />;

    // ── IAM ────────────────────────────────────────────────────────────────
    case 'iam-users':           return <LazyIamUsers />;
    case 'iam-roles':           return <LazyIamRoles />;
    case 'iam-audit':           return <LazyIamAudit />;
    case 'iam-sessions':        return <LazyIamSessions />;

    // ── Platform (SUPER_ADMIN / SUPPORT_L1 / SUPPORT_L2) ───────────────────
    case 'platform-dashboard':  return <LazyPlatformDashboard />;
    case 'tenants':             return <LazyTenants />;
    case 'platform-plans':      return <LazyPlatformPlans />;
    case 'platform-billing':    return <LazyPlatformBilling />;
    case 'platform-support':    return <LazyPlatformSupport />;
    case 'platform-staff':      return <LazyPlatformStaff />;
    case 'impersonation':       return <LazyImpersonation />;

    // ── Support tenant → plateforme (côté tenant) ──────────────────────────
    case 'support':             return <LazyCustomerSupport />;

    // ── Debug (SUPPORT_L2 + SUPER_ADMIN) ───────────────────────────────────
    case 'debug-workflow':      return <LazyDebugWorkflow />;
    case 'debug-outbox':        return <LazyDebugOutbox />;

    // ── Divers ─────────────────────────────────────────────────────────────
    case 'notifications':       return <LazyNotifications />;

    default:                    return <PageDashboard />;
  }
}
