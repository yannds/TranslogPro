/**
 * AdminTripsScreen — Vue trajets temps réel pour l'admin tenant en mobilité.
 *
 * Cas d'usage :
 *   - Surveiller les trajets actifs (PLANNED/BOARDING/IN_PROGRESS/COMPLETED) du
 *     jour J ± 1.
 *   - Action rapide en cas de souci : déclarer un retard majeur, suspendre, ou
 *     annuler en cours de route (workflow incident-compensation).
 *   - PAS de planification ni d'édition : ces opérations nécessitent une UI
 *     desktop (cartes, drag, multi-sélection) et restent sur le web.
 *
 * Sécurité :
 *   - GET trips : TRIP_READ_TENANT/AGENCY (filtré server-side par scope).
 *   - Actions incident : TRIP_UPDATE_TENANT (declare-major-delay, suspend,
 *     cancel-in-transit). Service rejette si manquant.
 *   - Idempotency-Key sur toute mutation (clé déterministe trip+action).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { useI18n } from '../i18n/useI18n';

type StatusFilter = 'ALL' | 'PLANNED' | 'BOARDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SUSPENDED' | 'CANCELLED';

const STATUS_FILTERS: { id: StatusFilter; fr: string; en: string }[] = [
  { id: 'ALL',         fr: 'Tous',     en: 'All'      },
  { id: 'PLANNED',     fr: 'Prévu',    en: 'Planned'  },
  { id: 'BOARDING',    fr: 'Embarq.',  en: 'Boarding' },
  { id: 'IN_PROGRESS', fr: 'En cours', en: 'Live'     },
  { id: 'COMPLETED',   fr: 'Arrivé',   en: 'Done'     },
  { id: 'SUSPENDED',   fr: 'Suspendu', en: 'Held'     },
  { id: 'CANCELLED',   fr: 'Annulé',   en: 'Cancel.'  },
];

interface Trip {
  id:                 string;
  status:             string;
  departureScheduled: string;
  arrivalScheduled?:  string | null;
  route?: {
    origin?:      { name: string } | null;
    destination?: { name: string } | null;
  } | null;
  driver?: {
    id:    string;
    name?: string | null;
  } | null;
  bus?: {
    id:           string;
    plateNumber?: string | null;
  } | null;
  assignedSeats?: number;
  capacity?:      number;
}

export function AdminTripsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [filter, setFilter]   = useState<StatusFilter>('ALL');
  const [trips, setTrips]     = useState<Trip[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId]   = useState<string | null>(null);

  // Range jour J : 00:00 → +48h (laisse voir les départs très matin J+1)
  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 48 * 60 * 60 * 1_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (filter !== 'ALL') qs.set('status', filter);
      const res = await apiGet<Trip[]>(
        `/api/tenants/${tenantId}/trips?${qs.toString()}`,
        { skipAuthRedirect: true },
      );
      setTrips(res ?? []);
    } catch {
      setTrips([]);
    }
  }, [tenantId, range, filter]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openActions(trip: Trip) {
    if (!online) {
      Alert.alert(L('Action nécessite réseau', 'Action requires network'),
        L('Les opérations trajet ne sont pas mises en file.', 'Trip operations are not queued.'));
      return;
    }
    Alert.alert(
      `${trip.route?.origin?.name ?? '—'} → ${trip.route?.destination?.name ?? '—'}`,
      L(`Statut : ${trip.status}`, `Status: ${trip.status}`),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Déclarer retard majeur', 'Declare major delay'),
          onPress: () => askDelay(trip),
        },
        {
          text: L('Suspendre', 'Suspend'),
          style: 'destructive',
          onPress: () => askSuspend(trip),
        },
        {
          text: L('Annuler en cours', 'Cancel in transit'),
          style: 'destructive',
          onPress: () => askCancel(trip),
        },
      ],
    );
  }

  function askDelay(trip: Trip) {
    Alert.prompt(
      L('Retard estimé (minutes)', 'Estimated delay (min)'),
      L('Saisissez le retard total estimé', 'Enter total estimated delay'),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Déclarer', 'Declare'),
          onPress: async (val?: string) => {
            const minutes = Number(val);
            if (!Number.isFinite(minutes) || minutes <= 0) return;
            await mutate(trip, 'declare-major-delay', { delayMinutes: minutes });
          },
        },
      ],
      'plain-text',
      '',
      'numeric',
    );
  }

  function askSuspend(trip: Trip) {
    Alert.prompt(
      L('Motif de suspension', 'Suspension reason'),
      L('Sera consigné dans le journal.', 'Will be logged.'),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Suspendre', 'Suspend'),
          style: 'destructive',
          onPress: async (reason?: string) => {
            if (!reason || reason.trim().length < 3) {
              Alert.alert(L('Motif requis', 'Reason required'));
              return;
            }
            await mutate(trip, 'suspend', { reason });
          },
        },
      ],
      'plain-text',
    );
  }

  function askCancel(trip: Trip) {
    Alert.prompt(
      L('Annulation en cours de route', 'Cancel in transit'),
      L('Indiquez le motif et la gare où le trajet s’arrête.', 'Enter reason and station where trip stops.'),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Confirmer', 'Confirm'),
          style: 'destructive',
          onPress: async (reason?: string) => {
            if (!reason || reason.trim().length < 3) {
              Alert.alert(L('Motif requis', 'Reason required'));
              return;
            }
            await mutate(trip, 'cancel-in-transit', { reason });
          },
        },
      ],
      'plain-text',
    );
  }

  async function mutate(trip: Trip, action: 'suspend' | 'cancel-in-transit' | 'declare-major-delay', body: Record<string, unknown>) {
    setBusyId(trip.id);
    try {
      await apiPost(
        `/api/v1/tenants/${tenantId}/trips/${trip.id}/incident/${action}`,
        body,
        {
          skipAuthRedirect: true,
          headers: { 'Idempotency-Key': `trip-${action}:${trip.id}` },
        },
      );
      await load();
    } catch (e) {
      Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Trajets du jour', 'Today’s trips')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <View style={styles.filters}>
        <FlatList
          data={STATUS_FILTERS}
          keyExtractor={(f) => f.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          renderItem={({ item }) => {
            const active = filter === item.id;
            return (
              <Pressable
                onPress={() => setFilter(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Text style={{
                  color: active ? colors.primaryFg : colors.text,
                  fontWeight: '600',
                  fontSize: 12,
                }}>
                  {L(item.fr, item.en)}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {loading && trips.length === 0 && (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}

      <FlatList
        data={trips}
        keyExtractor={(tr) => tr.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        ListEmptyComponent={!loading ? (
          <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
            {L('Aucun trajet sur cette plage.', 'No trip in this range.')}
          </Text>
        ) : null}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openActions(item)}
            disabled={busyId === item.id}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.card,
              {
                borderColor: colors.border,
                backgroundColor: colors.surface,
                opacity: pressed || busyId === item.id ? 0.65 : 1,
              },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, flex: 1 }} numberOfLines={1}>
                {item.route?.origin?.name ?? '—'} → {item.route?.destination?.name ?? '—'}
              </Text>
              <StatusBadge status={item.status} colors={colors} />
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                🕒 {new Date(item.departureScheduled).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
              </Text>
              {item.bus?.plateNumber && (
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>🚌 {item.bus.plateNumber}</Text>
              )}
              {item.driver?.name && (
                <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>👤 {item.driver.name}</Text>
              )}
              {typeof item.assignedSeats === 'number' && typeof item.capacity === 'number' && (
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  💺 {item.assignedSeats}/{item.capacity}
                </Text>
              )}
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function StatusBadge({ status, colors }: { status: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  const map: Record<string, { bg: string; fg: string }> = {
    PLANNED:     { bg: colors.border, fg: colors.text },
    BOARDING:    { bg: colors.primary, fg: colors.primaryFg },
    IN_PROGRESS: { bg: colors.success, fg: '#fff' },
    COMPLETED:   { bg: colors.border, fg: colors.textMuted },
    SUSPENDED:   { bg: colors.warning, fg: '#fff' },
    CANCELLED:   { bg: colors.danger, fg: '#fff' },
  };
  const c = map[status] ?? { bg: colors.border, fg: colors.text };
  return (
    <View style={[badge.box, { backgroundColor: c.bg }]}>
      <Text style={[badge.text, { color: c.fg }]}>{status}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  box:  { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999 },
  text: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
});

const styles = StyleSheet.create({
  header:  { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:    { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:      { fontSize: 18, fontWeight: '800' },
  banner:  { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  filters: { paddingVertical: 8 },
  chip:    {
    paddingVertical:   8,
    paddingHorizontal: 14,
    borderRadius:      999,
    borderWidth:       1,
    minHeight:         36,
    justifyContent:    'center',
  },
  card:    { padding: 14, borderRadius: 12, borderWidth: 1 },
});
