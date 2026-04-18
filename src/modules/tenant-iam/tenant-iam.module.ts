import { Module } from '@nestjs/common';
import { TenantIamController } from './tenant-iam.controller';
import { TenantIamService }    from './tenant-iam.service';
import { PasswordResetModule } from '../password-reset/password-reset.module';

@Module({
  imports:     [PasswordResetModule],
  controllers: [TenantIamController],
  providers:   [TenantIamService],
})
export class TenantIamModule {}
