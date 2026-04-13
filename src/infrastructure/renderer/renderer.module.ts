import { Module }         from '@nestjs/common';
import { PuppeteerService } from './puppeteer.service';
import { BarcodeService }   from './barcode.service';
import { ExcelService }     from './excel.service';
import { PdfmeService }     from './pdfme.service';

@Module({
  providers: [PuppeteerService, BarcodeService, ExcelService, PdfmeService],
  exports:   [PuppeteerService, BarcodeService, ExcelService, PdfmeService],
})
export class RendererModule {}
