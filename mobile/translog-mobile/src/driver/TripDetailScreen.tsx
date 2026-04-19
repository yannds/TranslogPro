/**
 * TripDetailScreen — Vue détaillée d'un trajet chauffeur.
 *
 * Affiche :
 *   - En-tête : origine → destination, statut, heure de départ
 *   - Bus (plaque, modèle, capacité)
 *   - Waypoints (gares intermédiaires si itinéraire avec stops)
 *   - Passagers attendus (tickets CONFIRMED|CHECKED_IN)
 *   - Colis à bord (shipments → parcels)
 *   - Actions rapides : Briefing · Check-in · Scanner billet · Rapport fin
 *
 * Data source :
 *   GET /api/tenants/:tid/trips/:id          → trip + route + bus + travelers
 *   GET /api/tenants/:tid/trips/:id/seats    → passagers avec sièges assignés
 *
 * Offline-first : useOfflineList ne s'applique pas ici (détail = un objet),
 * mais on garde le cache si le serveur tombe pendant le trajet.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { apiGet, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { LiveManifestPanel } from '../ui/LiveManifestPanel';

// Constantes UX — pas de magic number.
const STATUS_VARIANTS = ['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
type TripStatus = (typeof STATUS_VARIANTS)[number] | string;

interface Ticket {
  id:             string;
  status:         string;
  fareClass:      string;
  seatNumber:     string | null;
  passengerName:  string;
  passengerPhone: string | null;
  pricePaid:      number;
  boardingStationId:  string | null;
  alightingStationId: string | null;
}

interface TripDetail {
  id:                 string;
  status:             TripStatus;
  departureScheduled: string;
  arrivalScheduled:   string;
  seatingMode?:       string;
  route?: {
    id:          string;
    name:        string;
    origin?:      { id: string; name: string; city?: string | null };
    destination?: { id: string; name: string; city?: string | null };
    waypoints?:   Array<{ order: number; station: { id: string; name: string } }>;
  };
  bus?: {
    id:       string;
    plate?:   string;
    model?:   string;
    capacity: number;
    seatLayout?: unknown;
  };
  travelers?: Array<{ id: string; staffId: string | null }>;
  driver?: { id: string; user: { name: string | null; email: string } } | null;
  _count?: { shipments: number };
}

export function TripDetailScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const navigation = useNavigation<NavigationProp<any>>();
  const route = useRoute();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const tripId = (route.params as { tripId?: string } | undefined)?.tripId ?? '';

  const [trip, setTrip]       = useState<TripDetail | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId || !tripId) return;
    setError(null);
    try {
      const [trp, tks] = await Promise.all([
        apiGet<TripDetail>(`/api/tenants/${tenantId}/trips/${tripId}`, { skipAuthRedirect: true }),
        // Tickets du trip — endpoint existant filtre par tripId.
        apiGet<Ticket[]>(`/api/tenants/${tenantId}/tickets?tripId=${tripId}`, { skipAuthRedirect: true }).catch(() => []),
      ]);
      setTrip(trp);
      setTickets(tks ?? []);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [tenantId, tripId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function onPullRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  if (loading && !trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, padding: 24 }}>
        <Text style={{ color: colors.danger }}>{error ?? L('Trajet introuvable', 'Trip not found')}</Text>
        <Pressable onPress={() => navigation.goBack()} style={[styles.btnGhost, { borderColor: colors.border, marginTop: 20 }]}>
          <Text style={{ color: colors.text }}>{L('Retour', 'Back')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const confirmed = tickets.filter(tk => tk.status === 'CONFIRMED' || tk.status === 'CHECKED_IN' || tk.status === 'BOARDED');
  const boarded   = tickets.filter(tk => tk.status === 'BOARDED' || tk.status === 'CHECKED_IN');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backBtn}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.h1, { color: colors.text }]} numberOfLines={2}>
              {trip.route?.origin?.name ?? '?'} → {trip.route?.destination?.name ?? '?'}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              {new Date(trip.departureScheduled).toLocaleString(undefined, {
                weekday: 'short', day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </View>
          <Badge status={trip.status} colors={colors} />
        </View>

        {!online && (
          <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
            <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
          </View>
        )}

        {/* Bus */}
        <Card colors={colors} title={L('Véhicule', 'Vehicle')}>
          <Row k={L('Plaque', 'Plate')}   v={trip.bus?.plate ?? '—'} colors={colors} />
          <Row k={L('Modèle', 'Model')}    v={trip.bus?.model ?? '—'} colors={colors} />
          <Row k={L('Capacité', 'Capacity')} v={String(trip.bus?.capacity ?? '—')} colors={colors} />
          <Row k={L('Mode sièges', 'Seating')}  v={trip.seatingMode ?? '—'} colors={colors} />
        </Card>

        {/* Itinéraire */}
        <Card colors={colors} title={L('Itinéraire', 'Route')}>
          <Stop name={trip.route?.origin?.name ?? '?'} city={trip.route?.origin?.city} first colors={colors} />
          {(trip.route?.waypoints ?? [])
            .slice()
            .sort((a, b) => a.order - b.order)
            .map(wp => (
              <Stop key={wp.station.id} name={wp.station.name} colors={colors} />
            ))
          }
          <Stop name={trip.route?.destination?.name ?? '?'} city={trip.route?.destination?.city} last colors={colors} />
        </Card>

        {/* Manifeste temps réel — remplace les anciennes cartes Passagers/Colis
            (qui tronquaient à 20 et n'affichaient pas les colis). Le panel
            expose les 4 compteurs (confirmés / en gare / à bord / colis) +
            les 2 listes complètes triées par statut. Poll 5s. */}
        <LiveManifestPanel
          tenantId={tenantId}
          tripId={trip.id}
          lang={lang === 'en' ? 'en' : 'fr'}
        />

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <ActionBtn
            label={L('Briefing', 'Briefing')}
            onPress={() => navigation.navigate('DriverBriefing', { tripId: trip.id })}
            colors={colors}
          />
          <ActionBtn
            label={L('Check-in', 'Check-in')}
            onPress={() => navigation.navigate('DriverCheckin', { tripId: trip.id })}
            colors={colors}
          />
          <ActionBtn
            label={L('Scanner billets', 'Scan tickets')}
            onPress={() => navigation.navigate('DriverBoardingScan', { tripId: trip.id })}
            colors={colors}
            primary
          />
          <ActionBtn
            label={L('Scanner colis', 'Scan parcels')}
            onPress={() => navigation.navigate('DriverParcelScan', { tripId: trip.id })}
            colors={colors}
          />
          <ActionBtn
            label={L('Rapport fin', 'End report')}
            onPress={() => navigation.navigate('DriverEndReport', { tripId: trip.id })}
            colors={colors}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function Card({
  colors, title, rightText, children,
}: {
  colors: any; title: string; rightText?: string; children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{title}</Text>
        {rightText !== undefined && (
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>{rightText}</Text>
        )}
      </View>
      {children}
    </View>
  );
}

function Row({ k, v, colors }: { k: string; v: string; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ color: colors.textMuted, fontSize: 13 }}>{k}</Text>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>{v}</Text>
    </View>
  );
}

function Stop({ name, city, first, last, colors }: { name: string; city?: string | null; first?: boolean; last?: boolean; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
      <View style={[
        styles.dot,
        { backgroundColor: first ? colors.success : last ? colors.danger : colors.primary },
      ]} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{name}</Text>
        {city && <Text style={{ color: colors.textMuted, fontSize: 12 }}>{city}</Text>}
      </View>
    </View>
  );
}

function Badge({ status, colors }: { status: string; colors: any }) {
  const bg = status === 'IN_PROGRESS' ? colors.primary
    : status === 'BOARDING' ? colors.warning
    : status === 'COMPLETED' ? colors.success
    : status === 'CANCELLED' ? colors.danger
    : colors.textMuted;
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ color: 'white', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>{status}</Text>
    </View>
  );
}

function BadgeMini({ status, colors }: { status: string; colors: any }) {
  const bg = status === 'BOARDED' ? colors.success
    : status === 'CHECKED_IN' ? colors.primary
    : colors.textMuted;
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: bg }}>
      <Text style={{ color: 'white', fontSize: 9, fontWeight: '700' }}>{status}</Text>
    </View>
  );
}

function ActionBtn({
  label, onPress, colors, primary,
}: { label: string; onPress: () => void; colors: any; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.actionBtn,
        {
          backgroundColor: primary ? colors.primary : colors.surface,
          borderColor: primary ? colors.primary : colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={{ color: primary ? colors.primaryFg : colors.text, fontWeight: '600', fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  h1:        { fontSize: 18, fontWeight: '800' },
  backBtn:   { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  banner:    { padding: 10, borderRadius: 8 },
  card:      { padding: 14, borderRadius: 12, borderWidth: 1, gap: 2 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  dot:       { width: 10, height: 10, borderRadius: 5 },
  btnGhost:  { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  actionBtn: { flex: 1, minWidth: 140, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
