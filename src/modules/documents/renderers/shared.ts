/**
 * Styles et utilitaires partagés entre tous les renderers.
 *
 * CERTIFICATION des documents :
 *   Chaque document généré porte un fingerprint SHA-256 de son contenu
 *   injecté en fin de HTML. Ce fingerprint permet de détecter toute
 *   altération post-génération.
 *
 *   Format :  <!-- fp:sha256hex:ts:actorId:impersonated? -->
 *
 * QR Code :
 *   La valeur QR est injectée en attribut data-qr sur un <canvas>.
 *   Le script QRious (CDN) est inclus dans chaque document pour le rendu
 *   côté navigateur au moment de l'impression. Le token lui-même est signé
 *   HMAC-SHA256 par QrService.
 */
import { createHash }   from 'crypto';
import * as QRCode      from 'qrcode';
import { ScopeContext } from '../../../common/decorators/scope-context.decorator';

export const PAGE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 12px;
    color: #1a1a1a;
    background: #fff;
    padding: 20px;
  }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #1a1a1a;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .doc-header h1 { font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }
  .doc-header .meta { font-size: 10px; color: #555; text-align: right; line-height: 1.6; }
  .section { margin-bottom: 16px; }
  .section h2 { font-size: 13px; font-weight: 700; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { padding: 5px 8px; border: 1px solid #ddd; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 700; }
  tr:nth-child(even) { background: #fafafa; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 700; }
  .badge-ok  { background: #d4edda; color: #155724; }
  .badge-warn { background: #fff3cd; color: #856404; }
  .badge-err  { background: #f8d7da; color: #721c24; }
  .qr-block { text-align: center; padding: 12px; }
  .qr-block canvas { display: block; margin: 0 auto; }
  .qr-block .qr-caption { font-size: 9px; color: #777; margin-top: 4px; }
  .fingerprint { font-size: 8px; color: #bbb; margin-top: 24px; padding-top: 8px; border-top: 1px dashed #ddd; word-break: break-all; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .field { margin-bottom: 6px; }
  .field label { font-weight: 700; display: block; font-size: 10px; color: #555; }
  .field span  { font-size: 12px; }
  .impersonation-banner {
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 10px;
    color: #856404;
    margin-bottom: 12px;
  }
`;

/**
 * Génère un QR code en base64 PNG depuis la valeur fournie.
 * En cas d'erreur, retourne une chaîne vide (le document reste imprimable).
 */
export async function qrDataUrl(value: string): Promise<string> {
  try {
    return await QRCode.toDataURL(value, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 160,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    });
  } catch {
    return '';
  }
}

/**
 * Calcule le fingerprint SHA-256 du contenu HTML et l'injecte en commentaire.
 * Appelé en dernier, après que le HTML final est construit.
 */
export function certify(
  html: string,
  actorId: string,
  scope: ScopeContext | undefined,
): string {
  const ts = new Date().toISOString();
  const hash = createHash('sha256').update(html).digest('hex');
  const impersonated = scope?.isImpersonating
    ? ` impersonated-by:${scope.actorTenantId}`
    : '';
  const comment = `\n<!-- fp:${hash}:${ts}:${actorId}${impersonated} -->\n`;
  const fingerprint = `<div class="fingerprint">Empreinte document : ${hash} — ${ts}</div>`;
  return html.replace('</body>', `${fingerprint}${comment}</body>`);
}

/** Enveloppe HTML complète avec styles embarqués. */
export function htmlDoc(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Bannière impersonation si le document est généré par un agent support. */
export function impersonationBanner(scope: ScopeContext | undefined): string {
  if (!scope?.isImpersonating) return '';
  return `<div class="impersonation-banner">
    ⚠ Document généré par un agent support (impersonation active) — acteur : ${escHtml(scope.actorTenantId)}
  </div>`;
}

/** Échappe les caractères HTML sensibles. */
export function escHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Formate une date en français. */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Formate un montant en FCFA. */
export function fmtCfa(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `${amount.toLocaleString('fr-FR')} FCFA`;
}
