import { Module } from '@nestjs/common';
import { RouteService } from './route.service';
import { RouteController } from './route.controller';
import { RoutingModule } from '../routing/routing.module';

@Module({
  imports:     [RoutingModule],
  controllers: [RouteController],
  providers:   [RouteService],
  exports:     [RouteService],
})
export class RouteModule {}
