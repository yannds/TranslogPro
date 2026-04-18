import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CustomerResolverService } from './customer-resolver.service';
import { CustomerClaimService } from './customer-claim.service';
import { CustomerClaimController } from './customer-claim.controller';
import { RetroClaimService } from './retro-claim.service';
import { RetroClaimController } from './retro-claim.controller';
import { CustomerRecommendationService } from './customer-recommendation.service';
import { CustomerSegmentService } from './customer-segment.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports:     [NotificationModule],
  controllers: [CrmController, CustomerClaimController, RetroClaimController],
  providers:   [
    CrmService,
    CustomerResolverService,
    CustomerClaimService,
    RetroClaimService,
    CustomerRecommendationService,
    CustomerSegmentService,
  ],
  exports:     [
    CustomerResolverService,
    CustomerClaimService,
    RetroClaimService,
    CustomerRecommendationService,
    CustomerSegmentService,
  ],
})
export class CrmModule {}
