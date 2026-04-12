import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';
import { Inject } from '@nestjs/common';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ClaimState } from '../../common/constants/workflow-states';

export interface CreateClaimDto {
  type:          string;
  description:   string;
  ticketId?:     string;
  parcelId?:     string;
  amount?:       number;
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
        type:         dto.type,
        description:  dto.description,
        ticketId:     dto.ticketId,
        parcelId:     dto.parcelId,
        claimedAmount:dto.amount,
        submittedById:actor.id,
        status:       ClaimState.SUBMITTED,
      },
    });
  }

  async process(
    tenantId: string,
    claimId:  string,
    decision: 'APPROVED' | 'REJECTED',
    notes:    string,
    actor:    CurrentUserPayload,
  ) {
    const claim = await this.prisma.claim.findFirst({ where: { id: claimId, tenantId } });
    if (!claim) throw new NotFoundException(`Claim ${claimId} not found`);

    return this.prisma.claim.update({
      where: { id: claimId },
      data:  {
        status:      decision === 'APPROVED' ? ClaimState.APPROVED : ClaimState.REJECTED,
        processedById: actor.id,
        processedAt: new Date(),
        notes,
      },
    });
  }

  async getIdPhotoUploadUrl(tenantId: string, claimId: string) {
    // Biometric data — 15min TTL enforced by DocumentType.ID_PHOTO_SAV
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
