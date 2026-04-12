import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';
import { Inject } from '@nestjs/common';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ClaimState } from '../../common/constants/workflow-states';

export interface CreateClaimDto {
  type:        string;
  description: string;
  entityId:    string;   // parcelId ou ticketId
  entityType:  string;   // PARCEL | TICKET | INCIDENT
}

@Injectable()
export class SavService {
  constructor(
    private readonly prisma:   PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async createClaim(tenantId: string, dto: CreateClaimDto, actor: CurrentUserPayload) {
    return this.prisma.claim.create({
      data: {
        tenantId,
        type:        dto.type,
        description: dto.description,
        entityId:    dto.entityId,
        entityType:  dto.entityType,
        reporterId:  actor.id,
        status:      ClaimState.OPEN,
      },
    });
  }

  async process(
    tenantId: string,
    claimId:  string,
    decision: 'RESOLVE' | 'REJECT',
    actor:    CurrentUserPayload,
  ) {
    const claim = await this.prisma.claim.findFirst({ where: { id: claimId, tenantId } });
    if (!claim) throw new NotFoundException(`Claim ${claimId} not found`);

    return this.prisma.claim.update({
      where: { id: claimId },
      data:  {
        status:     decision === 'RESOLVE' ? ClaimState.RESOLVED : ClaimState.REJECTED,
        resolvedBy: actor.id,
        resolvedAt: new Date(),
      },
    });
  }

  async getIdPhotoUploadUrl(tenantId: string, claimId: string) {
    const key = `${tenantId}/sav/${claimId}/id-${Date.now()}.jpg`;
    return this.storage.getUploadUrl(tenantId, key, DocumentType.ID_PHOTO_SAV);
  }

  async findAll(tenantId: string, status?: string) {
    return this.prisma.claim.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const claim = await this.prisma.claim.findFirst({ where: { id, tenantId } });
    if (!claim) throw new NotFoundException(`Claim ${id} not found`);
    return claim;
  }
}
