import { Module } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { StaffAssignmentService } from './staff-assignment.service';
import { StaffAssignmentController } from './staff-assignment.controller';

@Module({
  controllers: [StaffController, StaffAssignmentController],
  providers:   [StaffService, StaffAssignmentService],
  exports:     [StaffService, StaffAssignmentService],
})
export class StaffModule {}
