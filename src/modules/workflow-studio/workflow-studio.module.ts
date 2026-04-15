import { Module } from '@nestjs/common';
import { WorkflowStudioService }      from './workflow-studio.service';
import { WorkflowMarketplaceService } from './workflow-marketplace.service';
import { SimulationSessionService }   from './simulation-session.service';
import { WorkflowStudioController }   from './workflow-studio.controller';
import {
  WorkflowMarketplacePublicController,
  WorkflowMarketplaceTenantController,
} from './workflow-marketplace.controller';

@Module({
  controllers: [
    WorkflowStudioController,
    WorkflowMarketplacePublicController,
    WorkflowMarketplaceTenantController,
  ],
  providers: [
    WorkflowStudioService,
    WorkflowMarketplaceService,
    SimulationSessionService,
  ],
  exports: [
    WorkflowStudioService,
    WorkflowMarketplaceService,
    SimulationSessionService,
  ],
})
export class WorkflowStudioModule {}
