import { Module } from '@nestjs/common';
import { TenantIamController } from './tenant-iam.controller';
import { TenantIamService }    from './tenant-iam.service';

@Module({
  controllers: [TenantIamController],
  providers:   [TenantIamService],
})
export class TenantIamModule {}
