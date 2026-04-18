/**
 * ParcelLabel — Talon d'expédition colis (imprimable)
 *
 * Format paysage compact (écran → papier A6/étiquette 10×15).
 * Contenu :
 *   - QR code tracking
 *   - Code de suivi en gros (lecture rapide)
 *   - Destinataire (nom, téléphone, adresse)
 *   - Gare destination
 *   - Poids, prix
 *   - Branding tenant (bande latérale couleur primaire)
 *
 * Rendu côté client : le QR est généré via la lib `qrcode` et inline en
 * data-URL, ce qui permet de sérialiser le HTML pour l'impression (via
 * printHtmlBatch) sans perte.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTenantConfig } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { buildParcelVerifyUrl } from '../../lib/document-verify-url';

export interface ParcelLabelData {
  id:            string;
  trackingCode:  string;
  status:        string;
  weight:        number;
  price:         number;
  destination?:  { name: string; city?: string | null } | null;
  recipientInfo?: { name?: string | null; phone?: string | null; address?: string | null } | null;
  createdAt?:    string;
}

interface Props {
  parcel:   ParcelLabelData;
  innerRef?: React.Ref<HTMLDivElement>;
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ParcelLabel({ parcel, innerRef }: Props) {
  const { brand } = useTenantConfig();
  const { t }     = useI18n();
  const [qrUrl, setQrUrl] = useState<string>('');

  useEffect(() => {
    if (!parcel.trackingCode) return;
    // QR encode l'URL publique → scan smartphone affiche le talon officiel
    // rendu par le backend (document signé identique à celui du back-office).
    const verifyUrl = buildParcelVerifyUrl(parcel.trackingCode);
    QRCode.toDataURL(verifyUrl, { width: 160, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [parcel.trackingCode]);

  const destName = parcel.destination?.name ?? '—';
  const destCity = parcel.destination?.city ?? '';
  const rcpName  = parcel.recipientInfo?.name ?? '—';
  const rcpPhone = parcel.recipientInfo?.phone ?? '';
  const rcpAddr  = parcel.recipientInfo?.address ?? '';

  return (
    <div
      ref={innerRef}
      className="parcel-label"
      style={{
        width: '100%',
        maxWidth: 520,
        minHeight: 280,
        margin: '0 auto',
        fontFamily: brand.fontFamily,
        color: '#1e293b',
        background: '#fff',
        border: '2px solid #0f172a',
        borderRadius: 4,
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      {/* ── Bande latérale colorée (branding) ─────────────────────────────── */}
      <div style={{
        background: brand.primaryColor, color: '#fff',
        width: 80, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 8px',
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1,
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
        }}>
          {t('parcelsList.parcelLabel')}
        </div>
        <div style={{ fontSize: 9, opacity: 0.9, textAlign: 'center', lineHeight: 1.2 }}>
          {brand.brandName}
        </div>
      </div>

      {/* ── Corps ────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Tracking code + QR */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('parcelsList.trackingCode')}
            </div>
            <div style={{
              fontSize: 20, fontWeight: 800, marginTop: 2,
              fontFamily: 'monospace', letterSpacing: 1,
            }}>
              {parcel.trackingCode}
            </div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>
              {fmtDate(parcel.createdAt)}
            </div>
          </div>
          {qrUrl && (
            <img src={qrUrl} alt="QR" style={{ width: 100, height: 100, flexShrink: 0 }} />
          )}
        </div>

        {/* Destination */}
        <div style={{
          background: '#f1f5f9', padding: '8px 10px', borderRadius: 4,
          borderLeft: `4px solid ${brand.primaryColor}`,
        }}>
          <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('parcelsList.destination')}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 1 }}>
            {destName}{destCity ? ` — ${destCity}` : ''}
          </div>
        </div>

        {/* Recipient */}
        <div>
          <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('parcelsList.recipient')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>
            {rcpName}
            {rcpPhone && <span style={{ fontWeight: 400, marginLeft: 8, color: '#475569' }}>· {rcpPhone}</span>}
          </div>
          {rcpAddr && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{rcpAddr}</div>
          )}
        </div>

        {/* Meta row */}
        <div style={{
          display: 'flex', gap: 16, paddingTop: 8, marginTop: 'auto',
          borderTop: '1px dashed #cbd5e1',
        }}>
          <div>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('parcelsList.weight')}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{parcel.weight.toLocaleString('fr-FR')} kg</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('parcelsList.value')}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{parcel.price.toLocaleString('fr-FR')} XAF</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('parcelsList.status')}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: brand.primaryColor }}>{parcel.status}</div>
          </div>
        </div>

        <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#cbd5e1' }}>
          {parcel.id}
        </div>
      </div>
    </div>
  );
}
