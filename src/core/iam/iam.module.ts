import { Module, Global } from '@nestjs/common';
import { PermissionGuard } from './guards/permission.guard';
import { ImpersonationGuard } from './guards/impersonation.guard';
import { RbacService } from './services/rbac.service';
import { ImpersonationService } from './services/impersonation.service';
import { ImpersonationController } from './controllers/impersonation.controller';

@Global()
@Module({
  controllers: [ImpersonationController],
  providers: [
    PermissionGuard,
    ImpersonationGuard,
    RbacService,
    ImpersonationService,
  ],
  exports: [
    PermissionGuard,
    ImpersonationGuard,
    RbacService,
    ImpersonationService,
  ],
})
export class IamModule {}
