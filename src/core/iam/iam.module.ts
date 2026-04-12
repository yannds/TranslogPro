import { Module, Global } from '@nestjs/common';
import { PermissionGuard } from './guards/permission.guard';
import { RbacService } from './services/rbac.service';

@Global()
@Module({
  providers: [PermissionGuard, RbacService],
  exports:   [PermissionGuard, RbacService],
})
export class IamModule {}
