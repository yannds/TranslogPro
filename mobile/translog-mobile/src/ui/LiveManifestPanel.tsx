/**
 * LiveManifestPanel — Vue manifest temps réel (mobile).
 *
 * Même source de vérité que BusScreen / QuaiScreen / PageQuaiManifest web :
 *   - `GET /flight-deck/trips/:tripId/passengers` → liste tickets enrichie
 *     avec le statut Traveler (CONFIRMED | CHECKED_IN | BOARDED)
 *   - `GET /flight-deck/trips/:tripId/live-stats`  → compteurs agrégés
 *   - `GET /trips/:tripId` (include shipments)     → liste parcels par statut
 *
 * Polling 5s — l'agent de quai ou le chauffeur voient en direct les scans
 * faits par leurs collègues (autre poste, driver mobile, station) sans avoir
 * à refresh manuellement.
 *
 * UX conçue pour la **liste de contrôle** :
 *   - Header : 4 compteurs colorés (Confirmés / En gare / À bord / Colis).
 *   - Tabs : Passagers | Colis — chacun trié (non-scannés en haut, puis
 *     scannés, puis à bord / livrés). L'agent voit d'un coup d'œil les
 *     retardataires.
 *   - Chaque ligne : nom / code + badge d'état + siège / poids / destination.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator,
} from 'react-native';
import { apiGet } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { EtaTime } from './EtaTime';

// ─── Types API ────────────────────────────────────────────────────────────

export interface ManifestPassenger {
  id:             string;   // ticketId
  passengerName:  string;
  seatNumber:     string | null;
  fareClass:      string | null;
  status:         string;   // CONFIRMED | CHECKED_IN | BOARDED | CANCELLED | EXPIRED
  luggageKg:      number | null;
}

interface LiveStats {
  passengersConfirmed: number;
  passengersCheckedIn: number;
  passengersOnBoard:   number;
  parcelsLoaded:       number;
  parcelsTotal:        number;
  busCapacity:         number;
  // Heures Prévu/Estimé exposées par le backend (cf. getTripLiveStats).
  scheduledDeparture?: string | null;
  estimatedDeparture?: string | null;
  scheduledArrival?:   string | null;
  estimatedArrival?:   string | null;
  delayMinutes?:       number;
}

interface ParcelRow {
  id:           string;
  trackingCode: string;
  status:       string;
  weight?:      number;
  destination?: { id: string; name: string; city?: string | null } | null;
}

// ─── Props ────────────────────────────────────────────────────────────────

export interface LiveManifestPanelProps {
  tenantId: string;
  tripId:   string;
  /** Polling interval en ms. Défaut 5000. 0 désactive le polling. */
  pollMs?:  number;
  /** Force la langue (sinon auto depuis user.locale côté appelant). */
  lang?:    'fr' | 'en';
}

// ─── Composant ────────────────────────────────────────────────────────────

export function LiveManifestPanel({ tenantId, tripId, pollMs = 5000, lang = 'fr' }: LiveManifestPanelProps) {
  const { colors } = useTheme();
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tab, setTab]               = useState<'pax' | 'parcels'>('pax');
  const [passengers, setPassengers] = useState<ManifestPassenger[] | null>(null);
  const [parcels, setParcels]       = useState<ParcelRow[] | null>(null);
  const [stats, setStats]           = useState<LiveStats | null>(null);
  const [loading, setLoading]       = useState(true);

  const passengersUrl = `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers`;
  const statsUrl      = `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/live-stats`;
  // Endpoint dédié qui renvoie une liste de parcels enrichie (id, code,
  // statut, destination, poids). Remplace l'ancien `trip.findOne` qui ne
  // chargeait que `_count.shipments` → liste parcels toujours vide.
  const parcelsUrl    = `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/parcels`;

  const refresh = useCallback(async () => {
    if (!tenantId || !tripId) return;
    try {
      const [pax, st, pcl] = await Promise.all([
        apiGet<ManifestPassenger[]>(passengersUrl, { skipAuthRedirect: true }).catch(() => null),
        apiGet<LiveStats>(statsUrl,                { skipAuthRedirect: true }).catch(() => null),
        apiGet<ParcelRow[]>(parcelsUrl,            { skipAuthRedirect: true }).catch(() => null),
      ]);
      if (pax) setPassengers(pax);
      if (st)  setStats(st);
      if (pcl) setParcels(pcl);
    } finally {
      setLoading(false);
    }
  }, [tenantId, tripId, passengersUrl, statsUrl, parcelsUrl]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  // ─── Tri des listes ──────────────────────────────────────────────────
  // Pour les passagers : CONFIRMED (à faire) en haut, CHECKED_IN ensuite,
  // BOARDED en bas (validés). Aide l'agent à voir d'un coup d'œil qui reste.
  const sortedPax = useMemo(() => {
    if (!passengers) return [];
    const weight = (s: string) => s === 'BOARDED' ? 2 : s === 'CHECKED_IN' ? 1 : 0;
    return [...passengers].sort((a, b) => {
      const w = weight(a.status) - weight(b.status);
      return w !== 0 ? w : a.passengerName.localeCompare(b.passengerName);
    });
  }, [passengers]);

  // Parcels : non chargés en haut (à scanner), puis chargés, puis livrés.
  const sortedParcels = useMemo(() => {
    if (!parcels) return [];
    const weight = (s: string) => {
      if (s === 'DELIVERED') return 3;
      if (s === 'ARRIVED')   return 2;
      if (s === 'LOADED' || s === 'IN_TRANSIT') return 1;
      return 0;
    };
    return [...parcels].sort((a, b) => weight(a.status) - weight(b.status));
  }, [parcels]);

  // ─── Rendu ───────────────────────────────────────────────────────────
  if (loading && !stats && !passengers) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {/* Bandeau Prévu / Estimé — visible dès qu'un retard est observé.
          Source backend : getTripLiveStats expose scheduledArrival +
          estimatedArrival + delayMinutes. Affiché en stacked pour
          maximiser la lisibilité dans la card du manifest. */}
      {stats && (stats.scheduledDeparture || stats.scheduledArrival) && (
        <View style={[styles.etaCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {stats.scheduledDeparture && (
            <View style={{ flex: 1 }}>
              <Text style={[styles.etaLabel, { color: colors.textMuted }]}>
                {L('Départ', 'Departure')}
              </Text>
              <EtaTime
                scheduled={stats.scheduledDeparture}
                estimated={stats.estimatedDeparture}
                delayMinutes={stats.delayMinutes ?? 0}
                layout="stacked"
                lang={lang}
              />
            </View>
          )}
          {stats.scheduledArrival && (
            <View style={{ flex: 1 }}>
              <Text style={[styles.etaLabel, { color: colors.textMuted }]}>
                {L('Arrivée', 'Arrival')}
              </Text>
              <EtaTime
                scheduled={stats.scheduledArrival}
                estimated={stats.estimatedArrival}
                delayMinutes={stats.delayMinutes ?? 0}
                layout="stacked"
                lang={lang}
              />
            </View>
          )}
        </View>
      )}

      {/* Compteurs */}
      <View style={styles.statsRow}>
        <Stat
          tone="slate"
          label={L('Confirmés', 'Confirmed')}
          value={stats?.passengersConfirmed ?? 0}
          colors={colors}
        />
        <Stat
          tone="info"
          label={L('En gare', 'In station')}
          value={stats?.passengersCheckedIn ?? 0}
          colors={colors}
        />
        <Stat
          tone="success"
          label={L('À bord', 'Boarded')}
          value={stats?.passengersOnBoard ?? 0}
          colors={colors}
        />
        <Stat
          tone="purple"
          label={L('Colis', 'Parcels')}
          value={`${stats?.parcelsLoaded ?? 0}/${stats?.parcelsTotal ?? 0}`}
          colors={colors}
        />
      </View>

      {/* Tabs pax | parcels */}
      <View style={[styles.tabsRow, { borderColor: colors.border }]}>
        <Pressable
          onPress={() => setTab('pax')}
          style={[styles.tab, tab === 'pax' && { backgroundColor: colors.primary }]}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'pax' }}
        >
          <Text style={{ color: tab === 'pax' ? colors.primaryFg : colors.text, fontWeight: '700' }}>
            {L('Passagers', 'Passengers')} ({sortedPax.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('parcels')}
          style={[styles.tab, tab === 'parcels' && { backgroundColor: colors.primary }]}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'parcels' }}
        >
          <Text style={{ color: tab === 'parcels' ? colors.primaryFg : colors.text, fontWeight: '700' }}>
            {L('Colis', 'Parcels')} ({sortedParcels.length})
          </Text>
        </Pressable>
      </View>

      {/* Liste */}
      {tab === 'pax' ? (
        <FlatList
          data={sortedPax}
          keyExtractor={(p) => p.id}
          scrollEnabled={false}  // imbriqué dans un ScrollView parent ; on laisse
          contentContainerStyle={{ gap: 6 }}
          ListEmptyComponent={
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 16 }}>
              {L('Aucun passager confirmé.', 'No confirmed passenger.')}
            </Text>
          }
          renderItem={({ item }) => (
            <PaxRow item={item} colors={colors} lang={lang} />
          )}
        />
      ) : (
        <FlatList
          data={sortedParcels}
          keyExtractor={(p) => p.id}
          scrollEnabled={false}
          contentContainerStyle={{ gap: 6 }}
          ListEmptyComponent={
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 16 }}>
              {L('Aucun colis sur ce trajet.', 'No parcel for this trip.')}
            </Text>
          }
          renderItem={({ item }) => (
            <ParcelRowItem item={item} colors={colors} lang={lang} />
          )}
        />
      )}
    </View>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────

function Stat({ tone, label, value, colors }: {
  tone: 'slate' | 'info' | 'success' | 'purple';
  label: string;
  value: number | string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  // Palette discrète — conserver la lisibilité avec dark mode du thème app.
  const bg = tone === 'success' ? 'rgba(16,185,129,0.12)'
           : tone === 'info'    ? 'rgba(59,130,246,0.12)'
           : tone === 'purple'  ? 'rgba(168,85,247,0.12)'
           :                       'rgba(148,163,184,0.12)';
  const fg = tone === 'success' ? '#10b981'
           : tone === 'info'    ? '#3b82f6'
           : tone === 'purple'  ? '#a855f7'
           :                       colors.text;
  return (
    <View style={[styles.stat, { backgroundColor: bg }]}>
      <Text style={[styles.statLabel, { color: fg, opacity: 0.8 }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.statValue, { color: fg }]}>{value}</Text>
    </View>
  );
}

function PaxRow({ item, colors, lang }: {
  item: ManifestPassenger;
  colors: ReturnType<typeof useTheme>['colors'];
  lang: 'fr' | 'en';
}) {
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);
  const tone = item.status === 'BOARDED'    ? { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: L('À bord', 'Boarded') }
             : item.status === 'CHECKED_IN' ? { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6', label: L('En gare', 'Checked in') }
             : item.status === 'CANCELLED'  ? { bg: 'rgba(239,68,68,0.15)',  fg: '#ef4444', label: L('Annulé', 'Cancelled') }
             :                                { bg: 'rgba(148,163,184,0.15)', fg: colors.textMuted, label: L('Attendu', 'Expected') };
  return (
    <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
          {item.passengerName}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
          {item.seatNumber ? `${L('siège', 'seat')} ${item.seatNumber}` : L('place libre', 'free seat')}
          {item.fareClass ? ` · ${item.fareClass}` : ''}
          {item.luggageKg != null ? ` · ${item.luggageKg} kg` : ''}
        </Text>
      </View>
      <View style={[styles.badge, { backgroundColor: tone.bg }]}>
        <Text style={{ color: tone.fg, fontWeight: '800', fontSize: 11 }}>
          {tone.label}
        </Text>
      </View>
    </View>
  );
}

function ParcelRowItem({ item, colors, lang }: {
  item: ParcelRow;
  colors: ReturnType<typeof useTheme>['colors'];
  lang: 'fr' | 'en';
}) {
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);
  const tone = item.status === 'DELIVERED' ? { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: L('Livré', 'Delivered') }
             : item.status === 'ARRIVED'   ? { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7', label: L('Arrivé', 'Arrived') }
             : item.status === 'LOADED' || item.status === 'IN_TRANSIT'
                                           ? { bg: 'rgba(16,185,129,0.12)', fg: '#10b981', label: L('Chargé', 'Loaded') }
             : item.status === 'CANCELLED' || item.status === 'LOST' || item.status === 'DAMAGED'
                                           ? { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444', label: item.status }
             :                               { bg: 'rgba(148,163,184,0.15)', fg: colors.textMuted, label: L('À charger', 'To load') };
  return (
    <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
          {item.trackingCode}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
          → {item.destination?.name ?? '?'}
          {item.weight ? ` · ${item.weight} kg` : ''}
        </Text>
      </View>
      <View style={[styles.badge, { backgroundColor: tone.bg }]}>
        <Text style={{ color: tone.fg, fontWeight: '800', fontSize: 11 }}>
          {tone.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  stat: {
    flex: 1,
    minWidth: '22%',
    padding: 10,
    borderRadius: 10,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
  },
  tabsRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  etaCard: {
    flexDirection: 'row',
    gap: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  etaLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
});
