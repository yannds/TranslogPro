import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';

// Config global (@Global) — typed access to process.env business variables
import { AppConfigModule } from './common/config/app-config.module';

// Infrastructure
import { DatabaseModule } from './infrastructure/database/database.module';
import { SecretModule } from './infrastructure/secret/secret.module';
import { SecurityModule } from './common/security/security.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { EventBusModule } from './infrastructure/eventbus/eventbus.module';
import { IdentityModule } from './infrastructure/identity/identity.module';
import { PaymentModule } from './infrastructure/payment/payment.module';
import { WeatherModule } from './infrastructure/weather/weather.module';
import { NotificationProviderModule } from './infrastructure/notification/notification-provider.module';

// Core Engines
import { TenancyModule } from './core/tenancy';
import { IdentityCoreModule } from './core/identity/identity-core.module';
import { IamModule } from './core/iam/iam.module';
import { WorkflowModule } from './core/workflow/workflow.module';
import { PricingModule } from './core/pricing/pricing.module';
import { GeoSafetyModule } from './core/security/geo-safety.module';

// Domain Modules
import { TenantModule } from './modules/tenant/tenant.module';
import { TicketingModule } from './modules/ticketing/ticketing.module';
import { ParcelModule } from './modules/parcel/parcel.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { TripModule } from './modules/trip/trip.module';
import { CashierModule } from './modules/cashier/cashier.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { ManifestModule } from './modules/manifest/manifest.module';
import { FlightDeckModule } from './modules/flight-deck/flight-deck.module';
import { GarageModule } from './modules/garage/garage.module';
import { SavModule } from './modules/sav/sav.module';
import { NotificationModule } from './modules/notification/notification.module';
import { DisplayModule } from './modules/display/display.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { SafetyModule } from './modules/safety/safety.module';
import { CrewModule } from './modules/crew/crew.module';
import { PublicReporterModule } from './modules/public-reporter/public-reporter.module';
import { CrmModule } from './modules/crm/crm.module';
import { IncidentModule } from './modules/incident/incident.module';
import { StaffModule } from './modules/staff/staff.module';
import { AgencyModule } from './modules/agency/agency.module';
import { RouteModule } from './modules/route/route.module';
import { TollPointModule } from './modules/toll-point/toll-point.module';
import { StationModule } from './modules/station/station.module';
import { GeoModule } from './modules/geo/geo.module';
import { TravelerModule } from './modules/traveler/traveler.module';
import { ScanModule } from './modules/scan/scan.module';
import { DlqModule } from './modules/dlq/dlq.module';
import { WorkflowDispatchModule } from './modules/workflow/workflow-dispatch.module';
import { PlatformModule }   from './modules/platform/platform.module';
import { PlatformPlansModule }     from './modules/platform-plans/platform-plans.module';
import { PlatformBillingModule }   from './modules/platform-billing/platform-billing.module';
import { PlatformPaymentModule }   from './modules/platform-payment/platform-payment.module';
import { PlatformAnalyticsModule } from './modules/platform-analytics/platform-analytics.module';
import { PlatformKpiModule }       from './modules/platform-kpi/platform-kpi.module';
import { PlatformConfigModule }    from './modules/platform-config/platform-config.module';
import { PlatformEmailModule }     from './modules/platform-email/platform-email.module';
import { PlatformTelecomModule }   from './modules/platform-telecom/platform-telecom.module';
import { SupportModule }           from './modules/support/support.module';
import { DocumentsModule }      from './modules/documents/documents.module';
import { TemplatesModule }       from './modules/templates/templates.module';
import { WorkflowStudioModule }  from './modules/workflow-studio/workflow-studio.module';
import { WhiteLabelModule }      from './modules/white-label/white-label.module';
import { ProfitabilityModule }   from './modules/pricing/pricing.module';
import { FleetDocsModule }       from './modules/fleet-docs/fleet-docs.module';
import { DriverProfileModule }   from './modules/driver-profile/driver-profile.module';
import { CrewBriefingModule }    from './modules/crew-briefing/crew-briefing.module';
import { ShipmentModule }        from './modules/shipment/shipment.module';
import { QhseModule }            from './modules/qhse/qhse.module';
import { SchedulingGuardModule } from './modules/scheduling-guard/scheduling-guard.module';
import { AuthModule }            from './modules/auth/auth.module';
import { PasswordResetModule }   from './modules/password-reset/password-reset.module';
import { DocumentVerifyModule }  from './modules/document-verify/document-verify.module';
import { TenantIamModule }       from './modules/tenant-iam/tenant-iam.module';
import { PlatformIamModule }     from './modules/platform-iam/platform-iam.module';
import { TenantSettingsModule }  from './modules/tenant-settings/tenant-settings.module';
import { MfaModule }             from './modules/mfa/mfa.module';
import { SchedulerModule }       from './modules/scheduler/scheduler.module';
import { QuotaModule }           from './modules/quota/quota.module';
import { PublicPortalModule }    from './modules/public-portal/public-portal.module';
import { PublicSignupModule }    from './modules/public-signup/public-signup.module';
import { OnboardingWizardModule } from './modules/onboarding-wizard/onboarding-wizard.module';
import { ActivationEmailsModule } from './modules/activation-emails/activation-emails.module';
import { SubscriptionCheckoutModule } from './modules/subscription-checkout/subscription-checkout.module';
import { PortalAdminModule }    from './modules/portal-admin/portal-admin.module';
import { TariffModule }          from './modules/tariff/tariff.module';
import { InvoiceModule }         from './modules/invoice/invoice.module';
import { VoucherModule }         from './modules/voucher/voucher.module';
import { IncidentCompensationModule } from './modules/incident-compensation/incident-compensation.module';
import { QuaiModule }            from './modules/quai/quai.module';
import { AnnouncementModule }    from './modules/announcement/announcement.module';
import { BulkImportModule }      from './modules/bulk-import/bulk-import.module';
import { BackupModule }          from './modules/backup/backup.module';

// Interceptors
import { AuditLoggingInterceptor } from './common/interceptors/audit-logging.interceptor';

// Guards & Middleware
import { PermissionGuard }       from './core/iam/guards/permission.guard';
import { ModuleGuard }           from './core/iam/guards/module.guard';
import { RedisRateLimitGuard }   from './common/guards/redis-rate-limit.guard';
import { SubscriptionGuard }     from './common/guards/subscription.guard';
import { SessionMiddleware }     from './core/iam/middleware/session.middleware';
import { TenantMiddleware }      from './core/iam/middleware/tenant.middleware';
import { WhiteLabelMiddleware }  from './modules/white-label/white-label.middleware';
import { TenantHostMiddleware, PathTenantMatchGuard } from './core/tenancy';
import { MetricsModule } from './modules/metrics/metrics.module';

@Module({
  imports: [
    // Scheduling (OutboxPoller, GPS reset, partition creation)
    ScheduleModule.forRoot(),

    // In-process event emitter (domain event handlers)
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),

    // Rate limiting global
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60000, limit: 300 },
    ]),

    // Config typée globale — AVANT tout module qui pourrait en dépendre
    AppConfigModule,

    // Observabilité — expose GET /metrics (Prometheus) + APP_INTERCEPTOR
    // qui mesure latence + status code de toute requête HTTP. Aucun import
    // bloquant (pas de DB), donc sûr de le placer en tête.
    MetricsModule,

    // Infrastructure (ordre important — SecretModule en premier)
    SecretModule,
    DatabaseModule,
    StorageModule,
    EventBusModule,
    SecurityModule, // @Global — Turnstile, Idempotency (anti-abus POST publics)
    IdentityModule,
    // Global providers — fournissent IPaymentService, ISmsService,
    // IWhatsappService, IWeatherService à tous les modules métier
    PaymentModule,
    NotificationProviderModule,
    WeatherModule,

    // Core Engines
    TenancyModule,       // @Global — HostConfig, TenantResolver, TenantDomainRepo, guards/middleware
    IdentityCoreModule,  // @Global — AuthIdentityService (tenant-scoped credential lookups)
    GeoSafetyModule,     // @Global — TenantConfigService + GeoSafetyProvider disponibles partout
    IamModule,
    WorkflowModule,
    PricingModule,

    // Domain Modules
    TenantModule,
    TicketingModule,
    ParcelModule,
    FleetModule,
    TripModule,
    CashierModule,
    TrackingModule,
    ManifestModule,
    FlightDeckModule,
    GarageModule,
    SavModule,
    NotificationModule,
    DisplayModule,
    AnalyticsModule,
    RealtimeModule,
    FeedbackModule,
    SafetyModule,
    CrewModule,
    PublicReporterModule,
    CrmModule,
    IncidentModule,
    StaffModule,
    AgencyModule,
    RouteModule,
    TollPointModule,
    StationModule,
    GeoModule,
    TravelerModule,
    ScanModule,
    DlqModule,
    WorkflowDispatchModule,
    // Platform SaaS (bootstrap + staff interne)
    PlatformModule,
    // Plans SaaS (catalogue DB-driven, CRUD SA)
    PlatformPlansModule,
    // Billing plateforme — souscriptions + factures plateforme → tenants
    PlatformBillingModule,
    // Payment plateforme — config commission SaaS + payout commission (split)
    PlatformPaymentModule,
    // Analytics plateforme — growth/adoption/health + crons DAU/HealthScore
    PlatformAnalyticsModule,
    // KPI plateforme — North Star, MRR, cohortes, activation, stratégique (lecture cross-tenant)
    PlatformKpiModule,
    // Config plateforme — seuils/paramètres DB-driven (SA settings)
    PlatformConfigModule,
    // Email plateforme — liste providers + healthcheck (read-only sur le choix)
    PlatformEmailModule,
    // Telecom plateforme — providers SMS / WhatsApp (Twilio) + healthcheck
    PlatformTelecomModule,
    // Support tenant → plateforme (tickets + thread)
    SupportModule,
    // Documents imprimables (billets, manifestes, colis, factures)
    DocumentsModule,
    // Templates de documents (CRUD + stockage MinIO)
    TemplatesModule,
    // Workflow Studio & Marketplace (blueprints, designer, simulation)
    WorkflowStudioModule,
    // Marque Blanche (UI par tenant — CSS variables, logos, couleurs)
    WhiteLabelModule,
    // Rentabilité & Yield Management (coûts, snapshots, suggestions de prix)
    ProfitabilityModule,
    // Fleet docs, documents réglementaires véhicules & consommables
    FleetDocsModule,
    // Driver & HR — dossier chauffeur, repos, formations, remédiation CRM
    DriverProfileModule,
    // Crew Briefing — checklist équipements pré-départ
    CrewBriefingModule,
    // Shipment — groupement de colis par destination
    ShipmentModule,
    // QHSE — accidents, litiges, procédures QHSE
    QhseModule,
    // Scheduling Guard — garde-fou avant affectation trajet/bus/chauffeur
    SchedulingGuardModule,
    // Auth — sign-in / sign-out / me (credential provider)
    AuthModule,
    // Password reset — routes publiques /auth/password-reset/* + service admin
    PasswordResetModule,
    // Vérification publique de documents — /verify/ticket/:id?q=, /verify/parcel/:code
    DocumentVerifyModule,
    // IAM tenant — gestion utilisateurs, rôles, permissions, sessions, journal
    TenantIamModule,
    // IAM plateforme — audit cross-tenant, sessions globales, reset MFA, rôles plateforme
    PlatformIamModule,
    // Settings tenant : taxes, payment config, intégrations API
    TenantSettingsModule,
    MfaModule,
    // Scheduler (Module M PRD) — TripTemplate CRUD + cron récurrence
    SchedulerModule,
    // Quota Manager (Module N PRD) — observation runtime quotas Redis
    QuotaModule,
    // Portail public voyageur — endpoints sans auth, rate-limités
    PublicPortalModule,
    // Signup SaaS public — waitlist, plans, création tenant (rate-limités, honeypot)
    PublicSignupModule,
    // Onboarding wizard post-signup — 5 étapes tenant admin (brand/agency/station/route/invite)
    OnboardingWizardModule,
    // Emails d'activation — drip J+1/J+3/J+7 via cron quotidien, IEmailService
    ActivationEmailsModule,
    // Checkout d'abonnement SaaS — PaymentOrchestrator SUBSCRIPTION intent
    SubscriptionCheckoutModule,
    // CMS Admin portail — pages, posts, config portail (SETTINGS_MANAGE_TENANT)
    PortalAdminModule,
    // Tarification — grille tarifaire & promotions
    TariffModule,
    // Facturation — factures émises (billets, colis, corporate)
    InvoiceModule,
    // Quais de gare — zones d'embarquement physiques
    QuaiModule,
    // Annonces gare — messages sonores/visuels diffusés aux écrans
    AnnouncementModule,
    // Voucher — bons de réduction (compensation, promo, geste commercial) ─ 2026-04-19
    VoucherModule,
    // Incident en route — suspend/cancel/major-delay + compensation (refund/voucher/snack) ─ 2026-04-19
    IncidentCompensationModule,
    // Bulk import — génération templates XLSX + import gares/véhicules/personnel/chauffeurs
    BulkImportModule,
    // Backup / Restore / RGPD — sauvegardes tenant (3 granularités), export RGPD
    BackupModule,
  ],
  providers: [
    // SubscriptionGuard global — vérifie le statut abonnement AVANT le RBAC.
    // En SUSPENDED/CANCELLED : seules auth/billing/RGPD passent.
    // En CHURNED : 403 systématique.
    // Redis cache TTL 60s — déblocage uniquement via webhook PSP.
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    // PathTenantMatchGuard global — ferme la fuite cross-tenant sur les
    // endpoints publics dont le tenantId/slug vient du path (display écrans,
    // portail public, track colis). Si req.resolvedHostTenant est présent,
    // path.tenantId/slug DOIT matcher host.tenantId/slug (sinon 403).
    // Exception : super-admin plateforme (PLATFORM_TENANT_ID) ou pas de host
    // résolu. Ordre : s'exécute AVANT PermissionGuard → rejet précoce.
    { provide: APP_GUARD, useClass: PathTenantMatchGuard },
    // PermissionGuard global — protège TOUTES les routes
    // Routes sans @Permission() = 500 en dev, 403 en prod
    { provide: APP_GUARD, useClass: PermissionGuard },
    // ModuleGuard global — vérifie qu'un module SaaS est actif pour le tenant.
    // Déclenché uniquement sur les routes portant @RequireModule('KEY').
    // S'exécute APRÈS PermissionGuard (ordre de déclaration APP_GUARD).
    { provide: APP_GUARD, useClass: ModuleGuard },
    // AuditLoggingInterceptor global — traçabilité ISO 27001 sur toutes les mutations
    { provide: APP_INTERCEPTOR, useClass: AuditLoggingInterceptor },
    // RedisRateLimitGuard — injecté via @UseGuards() par endpoint
    // Nécessite REDIS_CLIENT (fourni par EventBusModule @Global)
    RedisRateLimitGuard,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // TenantHostMiddleware est le TOUT PREMIER — résout req.resolvedHostTenant
    // depuis le header Host AVANT toute authentification. Cela permet à
    // SessionMiddleware (ou TenantIsolationGuard) d'enforcer ensuite que
    // session.tenantId == host.tenantId (anti cookie smuggling cross-tenant).
    consumer
      .apply(TenantHostMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    // SessionMiddleware — hydrate req.user pour tous les guards
    consumer
      .apply(SessionMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    // WhiteLabelMiddleware — charge la config visuelle du tenant (cache Redis L1)
    // Appliqué après TenantMiddleware pour bénéficier du req.user déjà résolu
    consumer
      .apply(WhiteLabelMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
