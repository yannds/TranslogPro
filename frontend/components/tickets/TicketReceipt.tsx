/**
 * TicketReceipt — Visuel de billet de transport (détail + impression)
 *
 * Affiche un billet complet avec :
 *   - En-tête branding (nom compagnie, couleur primaire)
 *   - QR code (généré côté client depuis le token qrCode)
 *   - Informations passager, trajet, gares, prix
 *   - Pied de page avec ID billet et date
 *
 * Utilisé dans :
 *   - PageIssuedTickets : dialog détail + fenêtre d'impression
 */

import { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { useTenantConfig } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TicketData {
  id:              string;
  tripId:          string;
  passengerName:   string;
  seatNumber:      string | null;
  fareClass:       string;
  pricePaid:       number;
  qrCode:          string;
  status:          string;
  createdAt:       string;
  boardingStation:  { name: string; city?: string } | null;
  alightingStation: { name: string; city?: string } | null;
  trip?: {
    departureScheduled?: string;
    arrivalScheduled?:   string;
    route?: { name: string; origin?: { name: string }; destination?: { name: string } } | null;
    bus?:   { plateNumber: string } | null;
  } | null;
}

interface TicketReceiptProps {
  ticket: TicketData;
  /** Ref exposé pour permettre l'impression depuis le parent */
  innerRef?: React.Ref<HTMLDivElement>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED:       '#16a34a',
  CHECKED_IN:      '#16a34a',
  BOARDED:         '#0d9488',
  COMPLETED:       '#64748b',
  PENDING_PAYMENT: '#d97706',
  CREATED:         '#94a3b8',
  CANCELLED:       '#dc2626',
  EXPIRED:         '#dc2626',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TicketReceipt({ ticket, innerRef }: TicketReceiptProps) {
  const { brand }  = useTenantConfig();
  const { t }      = useI18n();
  const [qrUrl, setQrUrl] = useState<string>('');

  useEffect(() => {
    if (!ticket.qrCode) return;
    QRCode.toDataURL(ticket.qrCode, { width: 160, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [ticket.qrCode]);

  const routeName   = ticket.trip?.route?.name ?? null;
  const departure   = ticket.boardingStation?.name ?? ticket.trip?.route?.origin?.name ?? '—';
  const arrival     = ticket.alightingStation?.name ?? ticket.trip?.route?.destination?.name ?? '—';
  const depTime     = fmtTime(ticket.trip?.departureScheduled);
  const depDate     = fmtDate(ticket.trip?.departureScheduled);
  const plate       = ticket.trip?.bus?.plateNumber ?? null;
  const statusColor = STATUS_COLORS[ticket.status] ?? '#64748b';

  return (
    <div
      ref={innerRef}
      className="ticket-receipt"
      style={{
        width: '100%',
        maxWidth: 380,
        margin: '0 auto',
        fontFamily: brand.fontFamily,
        color: '#1e293b',
        background: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          background: brand.primaryColor,
          color: '#fff',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>
            {brand.brandName}
          </div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
            {t('issuedTickets.print')}
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            background: 'rgba(255,255,255,0.2)',
            padding: '4px 10px',
            borderRadius: 20,
          }}
        >
          {ticket.fareClass}
        </div>
      </div>

      {/* ── Route banner ────────────────────────────────────────────────────── */}
      {routeName && (
        <div
          style={{
            background: brand.secondaryColor,
            color: '#fff',
            padding: '8px 20px',
            fontSize: 13,
            fontWeight: 600,
            textAlign: 'center',
            letterSpacing: 0.3,
          }}
        >
          {routeName}
        </div>
      )}

      {/* ── Stations ────────────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('issuedTickets.departure')}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{departure}</div>
          {depTime && <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{depTime}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: '#cbd5e1' }}>
          <svg width="32" height="16" viewBox="0 0 32 16" fill="none">
            <path d="M0 8h28M24 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('issuedTickets.alighting')}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{arrival}</div>
        </div>
      </div>

      {/* ── Date ────────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', fontSize: 12, color: '#64748b', padding: '4px 0 12px' }}>
        {depDate}
        {plate && <span style={{ marginLeft: 12, fontWeight: 600 }}>Bus {plate}</span>}
      </div>

      {/* ── Dashed separator ────────────────────────────────────────────────── */}
      <div style={{ borderTop: '2px dashed #e2e8f0', margin: '0 12px' }} />

      {/* ── Passenger + QR ──────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('issuedTickets.passenger')}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{ticket.passengerName}</div>
          {ticket.seatNumber && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              {t('issuedTickets.seat')} {ticket.seatNumber}
            </div>
          )}

          {/* Price */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('issuedTickets.price')}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: brand.primaryColor }}>
              {(ticket.pricePaid ?? 0).toLocaleString()} <span style={{ fontSize: 13, fontWeight: 600 }}>XAF</span>
            </div>
          </div>
        </div>

        {/* QR code */}
        {qrUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <img src={qrUrl} alt="QR Code" style={{ width: 120, height: 120, borderRadius: 6 }} />
            <div style={{ fontSize: 9, color: '#94a3b8', textAlign: 'center', maxWidth: 120, wordBreak: 'break-all' }}>
              {ticket.id.slice(0, 12)}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          background: '#f8fafc',
          borderTop: '1px solid #e2e8f0',
          padding: '10px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 11,
        }}
      >
        <span style={{ fontFamily: 'monospace', color: '#64748b' }}>
          {ticket.id}
        </span>
        <span
          style={{
            fontWeight: 700,
            color: statusColor,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {ticket.status}
        </span>
      </div>
    </div>
  );
}

// ─── Print helper ─────────────────────────────────────────────────────────────

/**
 * Ouvre une fenêtre de print avec le rendu du ticket.
 * Appeler avec le HTML sérialisé du composant ou via un ref.
 */
export function printTicketHtml(html: string, brandName: string) {
  const w = window.open('', '_blank', 'width=440,height=700');
  if (!w) return;
  w.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<title>${brandName} — Ticket</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { display: flex; justify-content: center; padding: 20px; background: #f1f5f9; }
  @media print {
    body { background: #fff; padding: 0; }
    .ticket-receipt { box-shadow: none !important; border: none !important; }
  }
</style>
</head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
