import { Module } from '@nestjs/common';
import { TenantIamController } from './tenant-iam.controller';
import { TenantIamService }    from './tenant-iam.service';
import { PasswordResetModule } from '../password-reset/password-reset.module';
import { StaffModule }         from '../staff/staff.module';

@Module({
  imports:     [PasswordResetModule, StaffModule],
  controllers: [TenantIamController],
  providers:   [TenantIamService],
})
export class TenantIamModule {}
