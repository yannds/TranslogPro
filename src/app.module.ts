import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';

// Infrastructure
import { DatabaseModule } from './infrastructure/database/database.module';
import { SecretModule } from './infrastructure/secret/secret.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { EventBusModule } from './infrastructure/eventbus/eventbus.module';
import { IdentityModule } from './infrastructure/identity/identity.module';
import { PaymentModule } from './infrastructure/payment/payment.module';
import { WeatherModule } from './infrastructure/weather/weather.module';
import { NotificationProviderModule } from './infrastructure/notification/notification-provider.module';

// Core Engines
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
import { FeedbackModule } from './modules/feedback/feedback.module';
import { SafetyModule } from './modules/safety/safety.module';
import { CrewModule } from './modules/crew/crew.module';
import { PublicReporterModule } from './modules/public-reporter/public-reporter.module';
import { CrmModule } from './modules/crm/crm.module';
import { IncidentModule } from './modules/incident/incident.module';
import { StaffModule } from './modules/staff/staff.module';
import { AgencyModule } from './modules/agency/agency.module';
import { RouteModule } from './modules/route/route.module';
import { StationModule } from './modules/station/station.module';
import { GeoModule } from './modules/geo/geo.module';
import { TravelerModule } from './modules/traveler/traveler.module';
import { DlqModule } from './modules/dlq/dlq.module';
import { WorkflowDispatchModule } from './modules/workflow/workflow-dispatch.module';
import { PlatformModule }   from './modules/platform/platform.module';
import { DocumentsModule }      from './modules/documents/documents.module';
import { TemplatesModule }       from './modules/templates/templates.module';
import { WorkflowStudioModule }  from './modules/workflow-studio/workflow-studio.module';
import { WhiteLabelModule }      from './modules/white-label/white-label.module';
import { ProfitabilityModule }   from './modules/pricing/pricing.module';
import { FleetDocsModule }       from './modules/fleet-docs/fleet-docs.module';
import { DriverProfileModule }   from './modules/driver-profile/driver-profile.module';
import { CrewBriefingModule }    from './modules/crew-briefing/crew-briefing.module';
import { QhseModule }            from './modules/qhse/qhse.module';
import { SchedulingGuardModule } from './modules/scheduling-guard/scheduling-guard.module';
import { AuthModule }            from './modules/auth/auth.module';
import { TenantIamModule }       from './modules/tenant-iam/tenant-iam.module';

// Interceptors
import { AuditLoggingInterceptor } from './common/interceptors/audit-logging.interceptor';

// Guards & Middleware
import { PermissionGuard }       from './core/iam/guards/permission.guard';
import { ModuleGuard }           from './core/iam/guards/module.guard';
import { RedisRateLimitGuard }   from './common/guards/redis-rate-limit.guard';
import { SessionMiddleware }     from './core/iam/middleware/session.middleware';
import { TenantMiddleware }      from './core/iam/middleware/tenant.middleware';
import { WhiteLabelMiddleware }  from './modules/white-label/white-label.middleware';

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

    // Infrastructure (ordre important — SecretModule en premier)
    SecretModule,
    DatabaseModule,
    StorageModule,
    EventBusModule,
    IdentityModule,
    // Global providers — fournissent IPaymentService, ISmsService,
    // IWhatsappService, IWeatherService à tous les modules métier
    PaymentModule,
    NotificationProviderModule,
    WeatherModule,

    // Core Engines
    GeoSafetyModule,   // @Global — TenantConfigService + GeoSafetyProvider disponibles partout
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
    FeedbackModule,
    SafetyModule,
    CrewModule,
    PublicReporterModule,
    CrmModule,
    IncidentModule,
    StaffModule,
    AgencyModule,
    RouteModule,
    StationModule,
    GeoModule,
    TravelerModule,
    DlqModule,
    WorkflowDispatchModule,
    // Platform SaaS (bootstrap + staff interne)
    PlatformModule,
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
    // QHSE — accidents, litiges, procédures QHSE
    QhseModule,
    // Scheduling Guard — garde-fou avant affectation trajet/bus/chauffeur
    SchedulingGuardModule,
    // Auth — sign-in / sign-out / me (credential provider)
    AuthModule,
    // IAM tenant — gestion utilisateurs, rôles, permissions, sessions, journal
    TenantIamModule,
  ],
  providers: [
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
    // SessionMiddleware DOIT tourner en premier — hydrate req.user pour tous les guards
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
