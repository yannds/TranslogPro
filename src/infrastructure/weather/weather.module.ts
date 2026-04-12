import { Module, Global } from '@nestjs/common';
import { OpenWeatherMapService } from './open-weather-map.service';
import { WEATHER_SERVICE } from './interfaces/weather.interface';

@Global()
@Module({
  providers: [{ provide: WEATHER_SERVICE, useClass: OpenWeatherMapService }],
  exports:   [WEATHER_SERVICE],
})
export class WeatherModule {}
