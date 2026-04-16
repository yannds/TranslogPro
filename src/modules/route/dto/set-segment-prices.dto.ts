import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsString, Min, ValidateNested } from 'class-validator';

export class SegmentPriceItemDto {
  @IsString()
  fromStationId: string;

  @IsString()
  toStationId: string;

  @IsNumber()
  @Min(0)
  basePriceXaf: number;
}

export class SetSegmentPricesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SegmentPriceItemDto)
  prices: SegmentPriceItemDto[];
}
