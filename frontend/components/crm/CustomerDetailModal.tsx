/**
 * CustomerDetailModal — Fiche complète d'un voyageur (CRM)
 *
 * Onglets : Informations · Documents · Billets · Interactions (feedbacks)
 * Actions rapides : appeler, email, SMS, ajouter à une campagne, éditer
 *
 * Light par défaut, dark compatible, ARIA (role=tablist, aria-selected, focus ring).
 */

import { useState, type ReactNode } from 'react';
import {
  Phone, Mail, MessageSquare, Megaphone, Pencil, UserCircle,
  Ticket as TicketIcon, FileText, Star, MessageCircle, Calendar, MapPin, BadgeCheck,
} from 'lucide-react';
import { useFetch }         from '../../lib/hooks/useFetch';
import { Dialog }           from '../ui/Dialog';
import { Badge }            from '../ui/Badge';
import { Button }           from '../ui/Button';
import { DocumentAttachments } from '../document/DocumentAttachments';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripSummary {
  id:          string;
  departureAt: string;
  arrivalAt:   string | null;
  route:       { name: string } | null;
}

interface TicketItem {
  id:        string;
  status:    string;
  pricePaid: number | null;
  createdAt: string;
  qrCode:    string | null;
  trip:      TripSummary | null;
}

interface FeedbackItem {
  id:        string;
  ratings:   Record<string, number>;
  comment:   string | null;
  createdAt: string;
  tripId:    string | null;
}

interface CustomerDetail {
  id:            string;
  email:         string;
  name:          string | null;
  image:         string | null;
  agencyId:      string | null;
  loyaltyScore:  number;
  preferences:   Record<string, unknown> | null;
  createdAt:     string;
  agency:        { id: string; name: string } | null;
  tickets:       TicketItem[];
  feedbacks:     FeedbackItem[];
  totalSpent:    number;
  ticketCount:   number;
  feedbackCount: number;
}

type TabId = 'info' | 'docs' | 'tickets' | 'interactions';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tierOf(score: number): { label: string; variant: 'default' | 'success' | 'warning' | 'info' } {
  if (score >= 4000) return { label: 'Platinum', variant: 'info'    };
  if (score >= 2000) return { label: 'Gold',     variant: 'warning' };
  if (score >= 500)  return { label: 'Silver',   variant: 'default' };
  return { label: 'Bronze', variant: 'default' };
}

function getPhone(prefs: Record<string, unknown> | null): string {
  return typeof prefs?.['phone'] === 'string' ? (prefs['phone'] as string) : '';
}

function statusBadge(status: string): ReactNode {
  const map: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
    CONFIRMED: 'success', BOARDED: 'success', COMPLETED: 'success',
    PENDING: 'warning',
    CANCELLED: 'danger', NO_SHOW: 'danger',
  };
  return <Badge variant={map[status] ?? 'default'}>{status}</Badge>;
}

function avgRating(ratings: Record<string, number>): number {
  const values = Object.values(ratings).filter(v => typeof v === 'number');
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ─── Onglets ──────────────────────────────────────────────────────────────────

function Tab({
  id, activeId, onSelect, icon, label, count,
}: {
  id:       TabId;
  activeId: TabId;
  onSelect: (id: TabId) => void;
  icon:     ReactNode;
  label:    string;
  count?:   number;
}) {
  const active = id === activeId;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`panel-${id}`}
      id={`tab-${id}`}
      onClick={() => onSelect(id)}
      className={
        'flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ' +
        (active
          ? 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800')
      }
    >
      {icon}
      <span>{label}</span>
      {typeof count === 'number' && (
        <span className={
          'text-[11px] px-1.5 py-0.5 rounded-full tabular-nums ' +
          (active
            ? 'bg-teal-600 text-white dark:bg-teal-500'
            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300')
        }>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export interface CustomerDetailModalProps {
  open:     boolean;
  onClose:  () => void;
  tenantId: string;
  customerId: string | null;
  onEdit?:  () => void;
  onAddToCampaign?: () => void;
}

export function CustomerDetailModal({
  open, onClose, tenantId, customerId, onEdit, onAddToCampaign,
}: CustomerDetailModalProps) {
  const [tab, setTab] = useState<TabId>('info');
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data, loading, error } = useFetch<CustomerDetail>(
    open && customerId && tenantId
      ? `/api/tenants/${tenantId}/crm/customers/${customerId}`
      : null,
    [tenantId, customerId, open],
  );

  const phone = getPhone(data?.preferences ?? null);
  const tier  = tierOf(data?.loyaltyScore ?? 0);

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) { setPreviewOpen(false); onClose(); } }}
      title={data?.name ?? 'Fiche voyageur'}
      description={data?.email ?? undefined}
      size={previewOpen ? '3xl' : 'xl'}
    >
      {/* États de chargement */}
      {loading && !data && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Chargement…</p>
      )}
      {error && (
        <div role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {data && (
        <div className="space-y-5">
          {/* ─── En-tête : avatar + identité + actions rapides ───────────── */}
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <div className="flex items-center gap-3">
              {data.image
                ? <img src={data.image} alt="" className="h-14 w-14 rounded-full object-cover border border-slate-200 dark:border-slate-700" />
                : (
                  <div className="h-14 w-14 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-white text-xl font-semibold">
                    {(data.name ?? data.email).charAt(0).toUpperCase()}
                  </div>
                )}
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-900 dark:text-white truncate">
                  {data.name ?? '—'}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <Badge variant={tier.variant}>
                    <Star className="w-3 h-3 mr-1" aria-hidden />{tier.label}
                  </Badge>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {data.loyaltyScore.toFixed(0)} pts
                  </span>
                  {data.agency && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" aria-hidden />{data.agency.name}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions rapides */}
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              {phone && (
                <a href={`tel:${phone}`} title="Appeler" aria-label="Appeler">
                  <Button type="button" variant="outline" size="sm">
                    <Phone className="w-4 h-4 mr-1.5" aria-hidden />Appeler
                  </Button>
                </a>
              )}
              <a href={`mailto:${data.email}`} title="Envoyer un email" aria-label="Envoyer un email">
                <Button type="button" variant="outline" size="sm">
                  <Mail className="w-4 h-4 mr-1.5" aria-hidden />Email
                </Button>
              </a>
              {phone && (
                <a href={`sms:${phone}`} title="Envoyer un SMS" aria-label="Envoyer un SMS">
                  <Button type="button" variant="outline" size="sm">
                    <MessageSquare className="w-4 h-4 mr-1.5" aria-hidden />SMS
                  </Button>
                </a>
              )}
              {onAddToCampaign && (
                <Button type="button" variant="outline" size="sm" onClick={onAddToCampaign}>
                  <Megaphone className="w-4 h-4 mr-1.5" aria-hidden />Campagne
                </Button>
              )}
              {onEdit && (
                <Button type="button" size="sm" onClick={onEdit}>
                  <Pencil className="w-4 h-4 mr-1.5" aria-hidden />Éditer
                </Button>
              )}
            </div>
          </div>

          {/* ─── KPIs synthétiques ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<TicketIcon className="w-4 h-4" />} label="Billets" value={String(data.ticketCount)} />
            <StatCard icon={<BadgeCheck className="w-4 h-4" />} label="Total dépensé" value={`${data.totalSpent.toFixed(0)} FCFA`} />
            <StatCard icon={<MessageCircle className="w-4 h-4" />} label="Feedbacks" value={String(data.feedbackCount)} />
            <StatCard icon={<Calendar className="w-4 h-4" />} label="Inscrit le" value={new Date(data.createdAt).toLocaleDateString('fr-FR')} />
          </div>

          {/* ─── Onglets ────────────────────────────────────────────────── */}
          <div role="tablist" aria-label="Fiche voyageur" className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800 -mb-px">
            <Tab id="info"         activeId={tab} onSelect={setTab} icon={<UserCircle  className="w-4 h-4" aria-hidden />} label="Informations" />
            <Tab id="docs"         activeId={tab} onSelect={setTab} icon={<FileText    className="w-4 h-4" aria-hidden />} label="Documents" />
            <Tab id="tickets"      activeId={tab} onSelect={setTab} icon={<TicketIcon  className="w-4 h-4" aria-hidden />} label="Billets" count={data.ticketCount} />
            <Tab id="interactions" activeId={tab} onSelect={setTab} icon={<MessageCircle className="w-4 h-4" aria-hidden />} label="Interactions" count={data.feedbackCount} />
          </div>

          {/* ─── Panneaux ───────────────────────────────────────────────── */}
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'info' && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <InfoRow label="Email">{data.email}</InfoRow>
                <InfoRow label="Téléphone">{phone || <span className="text-slate-400">—</span>}</InfoRow>
                <InfoRow label="Score fidélité">{data.loyaltyScore.toFixed(0)}</InfoRow>
                <InfoRow label="Agence">{data.agency?.name ?? <span className="text-slate-400">—</span>}</InfoRow>
                <InfoRow label="Inscrit le">{new Date(data.createdAt).toLocaleString('fr-FR')}</InfoRow>
                <InfoRow label="ID">
                  <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{data.id}</code>
                </InfoRow>
              </dl>
            )}

            {tab === 'docs' && (
              <DocumentAttachments
                tenantId={tenantId}
                entityType="CUSTOMER"
                entityId={data.id}
                allowedKinds={['ID_CARD', 'CONTRACT', 'PHOTO', 'OTHER']}
                onPreviewChange={setPreviewOpen}
              />
            )}

            {tab === 'tickets' && (
              <div className="space-y-2">
                {data.tickets.length === 0 && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 italic">Aucun billet.</p>
                )}
                {data.tickets.map(t => (
                  <div key={t.id} className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
                    <TicketIcon className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {t.trip?.route?.name ?? 'Trajet inconnu'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t.trip?.departureAt
                          ? new Date(t.trip.departureAt).toLocaleString('fr-FR')
                          : new Date(t.createdAt).toLocaleString('fr-FR')}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">
                      {(t.pricePaid ?? 0).toFixed(0)} FCFA
                    </span>
                    {statusBadge(t.status)}
                  </div>
                ))}
              </div>
            )}

            {tab === 'interactions' && (
              <div className="space-y-2">
                {data.feedbacks.length === 0 && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                    Aucune interaction enregistrée (plaintes, avis, appels).
                  </p>
                )}
                {data.feedbacks.map(f => {
                  const avg = avgRating(f.ratings);
                  return (
                    <div key={f.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 text-amber-500">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={'w-3.5 h-3.5 ' + (i < Math.round(avg) ? 'fill-amber-500' : 'text-slate-300 dark:text-slate-600')}
                              aria-hidden
                            />
                          ))}
                          <span className="ml-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            {avg.toFixed(1)}/5
                          </span>
                        </div>
                        <span className="text-xs text-slate-400 tabular-nums">
                          {new Date(f.createdAt).toLocaleDateString('fr-FR')}
                        </span>
                      </div>
                      {f.comment && (
                        <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{f.comment}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <span className="text-teal-600 dark:text-teal-400" aria-hidden>{icon}</span>
        {label}
      </div>
      <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white tabular-nums">
        {value}
      </p>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  );
}
