import { Module }         from '@nestjs/common';
import { PuppeteerService } from './puppeteer.service';
import { BarcodeService }   from './barcode.service';
import { ExcelService }     from './excel.service';

@Module({
  providers: [PuppeteerService, BarcodeService, ExcelService],
  exports:   [PuppeteerService, BarcodeService, ExcelService],
})
export class RendererModule {}
