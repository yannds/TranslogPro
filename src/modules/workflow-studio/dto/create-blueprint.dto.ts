import { IsString, IsBoolean, IsOptional, IsArray, ValidateNested, IsObject, IsEnum, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class GraphNodePositionDto {
  @IsOptional() x?: number;
  @IsOptional() y?: number;
}

export class GraphNodeDto {
  @IsString()  id!:    string;
  @IsString()  label!: string;
  @IsIn(['initial', 'state', 'terminal'])
  type!: 'initial' | 'state' | 'terminal';
  @IsOptional()
  @ValidateNested()
  @Type(() => GraphNodePositionDto)
  position?: GraphNodePositionDto;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class GraphEdgeDto {
  @IsString()  id!:         string;
  @IsString()  source!:     string;
  @IsString()  target!:     string;
  @IsString()  label!:      string;
  @IsArray()   @IsString({ each: true }) guards!:      string[];
  @IsString()  permission!: string;
  @IsArray()   @IsString({ each: true }) sideEffects!: string[];
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class WorkflowGraphDto {
  @IsString()  entityType!: string;
  @IsArray()   @ValidateNested({ each: true }) @Type(() => GraphNodeDto) nodes!: GraphNodeDto[];
  @IsArray()   @ValidateNested({ each: true }) @Type(() => GraphEdgeDto) edges!: GraphEdgeDto[];
  @IsOptional() @IsString()  version?:  string;
  @IsOptional() @IsObject()  metadata?: Record<string, unknown>;
}

export class CreateBlueprintDto {
  @IsString()           name!:        string;
  @IsString()           slug!:        string;
  @IsOptional() @IsString() description?: string;
  @IsString()           entityType!:  string;
  @ValidateNested()     @Type(() => WorkflowGraphDto) graph!: WorkflowGraphDto;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsString()  categoryId?: string;
  @IsOptional() @IsArray()   @IsString({ each: true }) tags?: string[];
}

export class UpdateBlueprintDto {
  @IsOptional() @IsString()  name?:        string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsBoolean() isPublic?:    boolean;
  @IsOptional() @IsString()  categoryId?:  string;
  @IsOptional() @IsArray()   @IsString({ each: true }) tags?: string[];
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowGraphDto)
  graph?: WorkflowGraphDto;
}

export class InstallBlueprintDto {
  @IsString() blueprintId!: string;
}

export class ImportBlueprintDto {
  /** Graphe exporté (inclut checksum pour vérification intégrité) */
  @IsObject() graphJson!: Record<string, unknown>;
  @IsString() checksum!:  string;
  @IsOptional() @IsString()  name?:        string;
  @IsOptional() @IsString()  description?: string;
  @IsOptional() @IsBoolean() isPublic?:    boolean;
}
