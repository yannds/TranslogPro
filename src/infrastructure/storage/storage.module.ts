import { Module, Global } from '@nestjs/common';
import { MinioService } from './minio.service';
import { STORAGE_SERVICE } from './interfaces/storage.interface';

@Global()
@Module({
  providers: [
    {
      provide:  STORAGE_SERVICE,
      useClass: MinioService,
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
