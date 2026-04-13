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

  /** Entretien courant estimé / mois (XOF) */
  @IsOptional() @IsNumber() @Min(0)
  monthlyMaintenanceAvg?: number;

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
