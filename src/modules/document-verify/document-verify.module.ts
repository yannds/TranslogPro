import { Module } from '@nestjs/common';
import { DocumentVerifyController } from './document-verify.controller';
import { DocumentVerifyService } from './document-verify.service';
import { QrService } from '../../core/security/qr/qr.service';

/**
 * DocumentVerifyModule — routes publiques `/verify/*` pour visualiser un
 * document officiel via le QR code imprimé sur billets/talons.
 *
 * Aucune dépendance sur AuthModule : les routes sont délibérément publiques
 * (ouvrables depuis n'importe quel smartphone sans session). L'autorisation
 * est faite par le HMAC du token (tickets) ou l'opacité du trackingCode (colis).
 */
@Module({
  controllers: [DocumentVerifyController],
  providers:   [DocumentVerifyService, QrService],
})
export class DocumentVerifyModule {}
