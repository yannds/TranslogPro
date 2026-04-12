import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';

// Infrastructure
import { DatabaseModule } from './infrastructure/database/database.module';
import { SecretModule } from './infrastructure/secret/secret.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { EventBusModule } from './infrastructure/eventbus/eventbus.module';
import { IdentityModule } from './infrastructure/identity/identity.module';

// Core Engines
import { IamModule } from './core/iam/iam.module';
import { WorkflowModule } from './core/workflow/workflow.module';
import { PricingModule } from './core/pricing/pricing.module';

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

// Guards & Middleware
import { PermissionGuard } from './core/iam/guards/permission.guard';
import { TenantMiddleware } from './core/iam/middleware/tenant.middleware';

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

    // Core Engines
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
  ],
  providers: [
    // PermissionGuard global — protège TOUTES les routes
    // Routes sans @Permission() = 500 en dev, 403 en prod
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
