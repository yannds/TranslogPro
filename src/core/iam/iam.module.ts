import { Module, Global } from '@nestjs/common';
import { PermissionGuard } from './guards/permission.guard';
import { ImpersonationGuard } from './guards/impersonation.guard';
import { RbacService } from './services/rbac.service';
import { ImpersonationService } from './services/impersonation.service';
import { IamBootstrapService } from './services/iam-bootstrap.service';
import { ImpersonationController } from './controllers/impersonation.controller';

@Global()
@Module({
  controllers: [ImpersonationController],
  providers: [
    PermissionGuard,
    ImpersonationGuard,
    RbacService,
    ImpersonationService,
    // Rejoué automatiquement à chaque démarrage pour sync DB ↔ seed TS.
    // Voir iam-bootstrap.service.ts pour le détail.
    IamBootstrapService,
  ],
  exports: [
    PermissionGuard,
    ImpersonationGuard,
    RbacService,
    ImpersonationService,
  ],
})
export class IamModule {}
