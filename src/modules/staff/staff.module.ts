import { Module } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { StaffAssignmentService } from './staff-assignment.service';
import { StaffAssignmentController } from './staff-assignment.controller';
import { StaffProvisioningService } from './staff-provisioning.service';

@Module({
  controllers: [StaffController, StaffAssignmentController],
  providers:   [StaffService, StaffAssignmentService, StaffProvisioningService],
  exports:     [StaffService, StaffAssignmentService, StaffProvisioningService],
})
export class StaffModule {}
