import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IStorageService,
  STORAGE_SERVICE,
  DocumentType,
} from '../../infrastructure/storage/interfaces/storage.interface';

export type AttachmentEntity =
  | 'CUSTOMER' | 'STAFF' | 'VEHICLE' | 'TRIP' | 'INCIDENT' | 'PARCEL';

export type AttachmentKind =
  | 'CONTRACT' | 'ID_CARD' | 'LICENSE' | 'CERTIFICATE' | 'PHOTO' | 'OTHER';

const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export interface UploadInput {
  tenantId:   string;
  entityType: AttachmentEntity;
  entityId:   string;
  kind:       AttachmentKind;
  fileName:   string;
  mimeType:   string;
  buffer:     Buffer;
  uploadedBy?: string;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async upload(dto: UploadInput) {
    if (!dto.buffer?.length) throw new BadRequestException('Fichier vide');
    if (dto.buffer.length > MAX_BYTES) throw new BadRequestException('Fichier trop lourd (max 15 Mo)');
    if (!ALLOWED_MIME.has(dto.mimeType)) {
      throw new BadRequestException(`Type MIME non autorisé : ${dto.mimeType}`);
    }

    const safeName = dto.fileName.replace(/[^\w.\-]+/g, '_').slice(0, 160);
    const checksum = createHash('sha256').update(dto.buffer).digest('hex');
    const storageKey = `attachments/${dto.entityType.toLowerCase()}/${dto.entityId}/${Date.now()}-${safeName}`;

    await this.storage.putObject(dto.tenantId, storageKey, dto.buffer, dto.mimeType);

    return this.prisma.attachment.create({
      data: {
        tenantId:   dto.tenantId,
        entityType: dto.entityType,
        entityId:   dto.entityId,
        kind:       dto.kind,
        fileName:   safeName,
        mimeType:   dto.mimeType,
        size:       dto.buffer.length,
        storageKey,
        checksum,
        uploadedBy: dto.uploadedBy ?? null,
      },
    });
  }

  async list(tenantId: string, entityType: AttachmentEntity, entityId: string) {
    return this.prisma.attachment.findMany({
      where:   { tenantId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDownloadUrl(tenantId: string, id: string) {
    const att = await this.prisma.attachment.findFirst({ where: { tenantId, id } });
    if (!att) throw new NotFoundException('Pièce jointe introuvable');
    const signed = await this.storage.getDownloadUrl(tenantId, att.storageKey, DocumentType.MAINTENANCE_DOC);
    return { downloadUrl: signed.url, expiresAt: signed.expiresAt, fileName: att.fileName, mimeType: att.mimeType };
  }

  async delete(tenantId: string, id: string) {
    const att = await this.prisma.attachment.findFirst({ where: { tenantId, id } });
    if (!att) throw new NotFoundException('Pièce jointe introuvable');
    await this.storage.deleteObject(tenantId, att.storageKey);
    const res = await this.prisma.attachment.deleteMany({ where: { id: att.id, tenantId } });
    if (res.count === 0) throw new NotFoundException('Pièce jointe introuvable');
    return { deleted: true };
  }
}
