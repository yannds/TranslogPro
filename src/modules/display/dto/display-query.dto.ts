import { IsEnum, IsOptional } from 'class-validator';

/**
 * Paramètres de requête pour l'endpoint d'affichage gare.
 *
 * scope : granularité de l'affichage
 *   - station (défaut) : uniquement les trajets de cette gare
 *   - city             : tous les trajets de toutes les gares de la même ville
 *   - tenant           : tous les trajets actifs du tenant (vue superviseur)
 *
 * view : sens des trajets à afficher
 *   - departures : départs depuis les gares du scope
 *   - arrivals   : arrivées vers les gares du scope
 *   - both       : les deux (défaut)
 */
export class DisplayQueryDto {
  @IsEnum(['station', 'city', 'tenant'])
  @IsOptional()
  scope?: 'station' | 'city' | 'tenant';

  @IsEnum(['departures', 'arrivals', 'both'])
  @IsOptional()
  view?: 'departures' | 'arrivals' | 'both';
}
