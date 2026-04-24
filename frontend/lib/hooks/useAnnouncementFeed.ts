/**
 * useAnnouncementFeed — Flux d'annonces tenant, tenant-scopé, polling 30 s.
 *
 * Remplace `useNotifications` (demo hardcoded) pour les surfaces back-office :
 *   - PageNotifications         (centre de notifications)
 *   - AdminDashboard.ticker     (bandeau en bas)
 *   - PortalShell.ticker        (bandeau portail)
 *
 * Source : GET /api/v1/tenants/:id/announcements?activeOnly=true
 * Sécurité : tenantId path-scoped côté back (cf. AnnouncementService.findAll).
 *
 * Mapping DB → shape UI :
 *   - Announcement.type (INFO|DELAY|CANCELLATION|SECURITY|PROMO|BOARDING|ARRIVAL|SUSPENSION)
 *     → NotificationType (DELAY_ALERT|SECURITY_ALERT|TARIFF_CHANGE|TRIP_STATUS_CHANGE|GENERAL_INFO|ROAD_SAFETY|WEATHER_UPDATE)
 *   - Announcement.priority (Int, plus élevé = urgent) → 1|2|3 (1 = urgent)
 *
 * NB : `dismiss` et `clearAll` sont locaux (UI) — on ne modifie pas la DB
 * (les annonces sont émises par le back via AnnouncementTripListener et
 * cycle de vie contrôlé par isActive/startsAt/endsAt côté serveur).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import type { TranslationMap } from '../i18n/types';
import type { Notification, NotificationType } from './useNotifications';

// Polling intervalle — aligné sur l'ancienne simulation (30 s) pour continuité UX.
// Pas de magic number inline : constante nommée.
const POLL_INTERVAL_MS = 30_000;

// Seuils de priorité DB → 1|2|3 UI. Les annonces auto (trip lifecycle) utilisent
// priority 0/5/10 selon la criticité (cf. announcement-trip.listener).
const PRIORITY_URGENT_THRESHOLD    = 8;
const PRIORITY_IMPORTANT_THRESHOLD = 3;

interface AnnouncementDto {
  id:         string;
  tenantId:   string;
  title:      string;
  message:    string;
  type:       string;
  priority:   number;
  isActive:   boolean;
  startsAt:   string;
  endsAt:     string | null;
  tripId?:    string | null;
  createdAt:  string;
}

function mapType(dbType: string): NotificationType {
  switch (dbType) {
    case 'DELAY':
    case 'CANCELLATION':
      return 'DELAY_ALERT';
    case 'SECURITY':
    case 'SUSPENSION':
      return 'SECURITY_ALERT';
    case 'PROMO':
      return 'TARIFF_CHANGE';
    case 'BOARDING':
    case 'ARRIVAL':
      return 'TRIP_STATUS_CHANGE';
    case 'INFO':
    default:
      return 'GENERAL_INFO';
  }
}

function mapPriority(dbPriority: number): 1 | 2 | 3 {
  if (dbPriority >= PRIORITY_URGENT_THRESHOLD)    return 1;
  if (dbPriority >= PRIORITY_IMPORTANT_THRESHOLD) return 2;
  return 3;
}

function toTranslationMap(title: string, message: string): TranslationMap {
  // Les annonces DB sont stockées en une langue (celle de l'admin qui a publié).
  // On expose le texte sur `fr` (langue par défaut du back) + fallback `en`.
  // Si l'équipe souhaite de l'i18n par annonce, c'est un chantier séparé
  // (ajouter AnnouncementTranslation 1-n).
  const body = title ? `${title} — ${message}` : message;
  return { fr: body, en: body };
}

interface UseAnnouncementFeedOptions {
  tenantId:  string | null | undefined;
  maxItems?: number;
}

interface UseAnnouncementFeedResult {
  notifications: Notification[];
  isConnected:   boolean;
  loading:       boolean;
  error:         string | null;
  dismiss:       (id: string) => void;
  clearAll:      () => void;
  refetch:       () => void;
}

export function useAnnouncementFeed(
  { tenantId, maxItems = 50 }: UseAnnouncementFeedOptions,
): UseAnnouncementFeedResult {
  const [raw,         setRaw]         = useState<AnnouncementDto[]>([]);
  const [dismissed,   setDismissed]   = useState<Set<string>>(new Set());
  const [cleared,     setCleared]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const fetchFeed = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AnnouncementDto[]>(
        `/api/v1/tenants/${tenantId}/announcements?activeOnly=true`,
      );
      setRaw(data ?? []);
      setIsConnected(true);
    } catch (e) {
      setError((e as Error).message ?? 'fetch failed');
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    fetchFeed();
    const iv = setInterval(fetchFeed, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [tenantId, fetchFeed]);

  const notifications = useMemo<Notification[]>(() => {
    if (cleared) return [];
    return raw
      .filter(a => !dismissed.has(a.id))
      .map(a => ({
        id:        a.id,
        type:      mapType(a.type),
        priority:  mapPriority(a.priority),
        createdAt: new Date(a.createdAt),
        expiresAt: a.endsAt ? new Date(a.endsAt) : undefined,
        ref:       a.tripId ?? undefined,
        message:   toTranslationMap(a.title, a.message),
      }))
      .slice(0, maxItems);
  }, [raw, dismissed, cleared, maxItems]);

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setCleared(true);
  }, []);

  return { notifications, isConnected, loading, error, dismiss, clearAll, refetch: fetchFeed };
}
