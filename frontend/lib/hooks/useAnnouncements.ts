/**
 * useAnnouncements — Hook unifié pour lire les annonces gare en temps réel.
 *
 * Deux modes :
 *   - `authenticated` (tenantId fourni) → SSE sur `/api/tenants/:tenantId/realtime/events`
 *     filtré sur `announcement.*`. Polling REST de bootstrap + refresh sur réception.
 *   - `public` (tenantSlug fourni) → polling REST pur sur
 *     `/public/:tenantSlug/portal/announcements` (pas de session).
 *
 * Le hook renvoie la liste courante triée par priorité desc + startsAt desc,
 * avec filtre optionnel par stationId (côté serveur + côté client).
 *
 * Zéro magic number : polling interval lu depuis PlatformConfig quand dispo,
 * défaut 30 000 ms (polling public) / 60 000 ms (refresh authenticated).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeEvents } from './useRealtimeEvents';

export interface Announcement {
  id:         string;
  type:       string;      // INFO | DELAY | CANCELLATION | SECURITY | PROMO | CUSTOM | BOARDING | ARRIVAL | SUSPENSION
  priority:   number;
  title:      string;
  message:    string;
  stationId:  string | null;
  tripId?:    string | null;
  startsAt:   string;      // ISO
  endsAt:     string | null;
  source?:    'MANUAL' | 'AUTO';
  station?:   { id: string; name: string; city: string } | null;
}

interface AuthenticatedOptions {
  mode:      'authenticated';
  tenantId:  string | undefined;
  stationId?: string;
  refreshMs?: number;
  enabled?:  boolean;
}

interface PublicOptions {
  mode:        'public';
  tenantSlug:  string | undefined;
  stationId?:  string;
  pollMs?:     number;
  enabled?:    boolean;
}

export type UseAnnouncementsOptions = AuthenticatedOptions | PublicOptions;

const DEFAULT_AUTH_REFRESH_MS  = 60_000;
const DEFAULT_PUBLIC_POLL_MS   = 30_000;
const ANNOUNCEMENT_EVENT_TYPES = ['announcement.created', 'announcement.updated', 'announcement.deleted'];

export function useAnnouncements(options: UseAnnouncementsOptions): {
  announcements: Announcement[];
  loading:       boolean;
  error:         string | null;
  refresh:       () => Promise<void>;
} {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const stationIdRef = useRef(options.stationId);
  stationIdRef.current = options.stationId;

  const enabled = options.enabled !== false;

  const fetchAnnouncements = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    setError(null);
    try {
      let url: string;
      const qs  = stationIdRef.current ? `?stationId=${encodeURIComponent(stationIdRef.current)}&activeOnly=true` : '?activeOnly=true';
      if (options.mode === 'authenticated') {
        if (!options.tenantId) return;
        url = `/api/v1/tenants/${options.tenantId}/announcements${qs}`;
      } else {
        if (!options.tenantSlug) return;
        url = `/api/public/${options.tenantSlug}/portal/announcements${stationIdRef.current ? `?stationId=${encodeURIComponent(stationIdRef.current)}` : ''}`;
      }
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json() as Announcement[];
      // Tri défensif côté client
      const sorted = [...data].sort((a, b) =>
        b.priority - a.priority || b.startsAt.localeCompare(a.startsAt),
      );
      setAnnouncements(sorted);
    } catch (err) {
      setError((err as Error)?.message ?? 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [enabled, options.mode, options.mode === 'authenticated' ? options.tenantId : options.tenantSlug]);

  // Bootstrap + polling
  useEffect(() => {
    if (!enabled) return;
    void fetchAnnouncements();
    const interval = options.mode === 'public'
      ? (options.pollMs ?? DEFAULT_PUBLIC_POLL_MS)
      : (options.refreshMs ?? DEFAULT_AUTH_REFRESH_MS);
    const timer = setInterval(() => { void fetchAnnouncements(); }, interval);
    return () => clearInterval(timer);
  }, [fetchAnnouncements, enabled, options.mode,
      options.mode === 'public' ? options.pollMs : options.refreshMs]);

  // SSE — authenticated only
  useRealtimeEvents(
    options.mode === 'authenticated' ? options.tenantId : undefined,
    (evt) => {
      if (!ANNOUNCEMENT_EVENT_TYPES.includes(evt.type)) return;
      // Optimistic : patch local avec le payload, puis refetch full list
      const payload = evt.payload as Partial<Announcement> & { announcementId?: string } | undefined;
      if (payload?.announcementId) {
        if (evt.type === 'announcement.deleted') {
          setAnnouncements((prev) => prev.filter(a => a.id !== payload.announcementId));
        } else {
          const next: Announcement = {
            id:        payload.announcementId,
            type:      payload.type ?? 'INFO',
            priority:  payload.priority ?? 0,
            title:     payload.title ?? '',
            message:   payload.message ?? '',
            stationId: (payload.stationId as string | null | undefined) ?? null,
            tripId:    (payload.tripId as string | null | undefined) ?? null,
            startsAt:  (payload.startsAt as string) ?? new Date().toISOString(),
            endsAt:    (payload.endsAt as string | null | undefined) ?? null,
            source:    (payload.source as 'MANUAL' | 'AUTO' | undefined),
          };
          setAnnouncements((prev) => {
            const idx = prev.findIndex(a => a.id === next.id);
            const merged = idx >= 0 ? prev.map(a => a.id === next.id ? { ...a, ...next } : a) : [...prev, next];
            return merged.sort((a, b) => b.priority - a.priority || b.startsAt.localeCompare(a.startsAt));
          });
        }
      }
      // Refetch authoritative list (deboucé par le serveur + polling backoff intrinsèque)
      void fetchAnnouncements();
    },
    {
      enabled: options.mode === 'authenticated' && enabled,
      types:   ANNOUNCEMENT_EVENT_TYPES,
    },
  );

  return {
    announcements,
    loading,
    error,
    refresh: fetchAnnouncements,
  };
}
