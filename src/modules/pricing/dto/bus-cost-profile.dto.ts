import {
  IsNumber, IsPositive, IsOptional, IsInt, Min,
} from 'class-validator';

export class UpsertBusCostProfileDto {
  /** Consommation en litres / 100 km */
  @IsNumber() @IsPositive()
  fuelConsumptionPer100Km!: number;

  /** Prix du carburant en XOF / litre */
  @IsNumber() @IsPositive()
  fuelPricePerLiter!: number;

  /** Coût AdBlue au litre (€) — moteurs Euro 6, défaut 0.18 */
  @IsOptional() @IsNumber() @Min(0)
  adBlueCostPerLiter?: number;

  /** Fraction AdBlue / volume carburant — défaut 0.05 (5 %) */
  @IsOptional() @IsNumber() @Min(0)
  adBlueRatioFuel?: number;

  /** Coût de maintenance au km (XOF/km) — remplace forfait mensuel (ADR-23) */
  @IsOptional() @IsNumber() @Min(0)
  maintenanceCostPerKm?: number;

  /** Redevance gare routière par départ (XOF) */
  @IsOptional() @IsNumber() @Min(0)
  stationFeePerDeparture?: number;

  /** Indemnités chauffeur par trajet (XOF) */
  @IsOptional() @IsNumber() @Min(0)
  driverAllowancePerTrip?: number;

  /** Péages forfaitaires par trajet (XOF) */
  @IsOptional() @IsNumber() @Min(0)
  tollFeesPerTrip?: number;

  /** Salaire mensuel du conducteur affecté (XOF) */
  @IsNumber() @IsPositive()
  driverMonthlySalary!: number;

  /** Assurance annuelle (XOF) */
  @IsNumber() @IsPositive()
  annualInsuranceCost!: number;

  /** Frais fixes agence / mois (XOF) — proratisés par trajet */
  @IsNumber() @IsPositive()
  monthlyAgencyFees!: number;

  /** Prix d'achat du véhicule (XOF) */
  @IsNumber() @IsPositive()
  purchasePrice!: number;

  /** Durée d'amortissement en années */
  @IsOptional() @IsInt() @Min(1)
  depreciationYears?: number;

  /** Valeur résiduelle à la fin de l'amortissement (XOF) */
  @IsOptional() @IsNumber() @Min(0)
  residualValue?: number;

  /** Nombre moyen de trajets commerciaux par mois pour ce véhicule */
  @IsOptional() @IsInt() @IsPositive()
  avgTripsPerMonth?: number;
}
