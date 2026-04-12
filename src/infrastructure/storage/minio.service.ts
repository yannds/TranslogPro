import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import * as Minio from 'minio';
import {
  IStorageService,
  DocumentType,
  SIGNED_URL_TTL_SECONDS,
  SignedUrl,
} from './interfaces/storage.interface';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';

@Injectable()
export class MinioService implements IStorageService, OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Minio.Client;

  constructor(@Inject(SECRET_SERVICE) private readonly secretService: ISecretService) {}

  async onModuleInit() {
    const config = await this.secretService.getSecretObject<{
      ENDPOINT: string; PORT: string; ACCESS_KEY: string;
      SECRET_KEY: string; USE_SSL: string;
    }>('platform/minio');

    this.client = new Minio.Client({
      endPoint:  config.ENDPOINT,
      port:      parseInt(config.PORT),
      useSSL:    config.USE_SSL === 'true',
      accessKey: config.ACCESS_KEY,
      secretKey: config.SECRET_KEY,
    });

    this.logger.log(`✅ MinIO connected at ${config.ENDPOINT}:${config.PORT}`);
  }

  private getBucketName(tenantId: string): string {
    return `translog-${tenantId}-docs`;
  }

  private async ensureBucket(tenantId: string): Promise<void> {
    const bucket = this.getBucketName(tenantId);
    const exists = await this.client.bucketExists(bucket);
    if (!exists) {
      await this.client.makeBucket(bucket, 'us-east-1');
      this.logger.log(`Created bucket: ${bucket}`);
    }
  }

  async getUploadUrl(tenantId: string, key: string, type: DocumentType): Promise<SignedUrl> {
    await this.ensureBucket(tenantId);
    const bucket = this.getBucketName(tenantId);
    const ttl = SIGNED_URL_TTL_SECONDS[type];
    const url = await this.client.presignedPutObject(bucket, key, ttl);
    return { url, key, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async getDownloadUrl(tenantId: string, key: string, type: DocumentType): Promise<SignedUrl> {
    const bucket = this.getBucketName(tenantId);
    const ttl = SIGNED_URL_TTL_SECONDS[type];
    const url = await this.client.presignedGetObject(bucket, key, ttl);
    return { url, key, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async deleteObject(tenantId: string, key: string): Promise<void> {
    const bucket = this.getBucketName(tenantId);
    await this.client.removeObject(bucket, key);
  }

  assertObjectBelongsToTenant(tenantId: string, key: string): boolean {
    // Le key doit commencer par le tenantId pour confirmer l'appartenance
    return key.startsWith(`${tenantId}/`) || key.startsWith(tenantId);
  }
}
