import { Module } from '@nestjs/common';
import { QuaiController } from './quai.controller';
import { QuaiService } from './quai.service';

@Module({
  controllers: [QuaiController],
  providers:   [QuaiService],
  exports:     [QuaiService],
})
export class QuaiModule {}
