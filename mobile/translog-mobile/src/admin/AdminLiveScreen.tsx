/**
 * AdminLiveScreen — Vue temps réel des trajets en cours pour l'admin tenant.
 *
 * Polling toutes les 10s sur GET /api/tenants/:tid/trips/live (créé en L1)
 * qui retourne les trajets en cours enrichis :
 *   - state : 'on-time' | 'delayed' | 'early' | 'arrived' | 'suspended' | 'planned'
 *   - delayMinutes : signe + magnitude
 *
 * Affiche par groupe d'état (En cours · En retard · À l'heure · Suspendu).
 * Tap → AdminTripsScreen avec le trajet présélectionné (ou si admin a une
 * action urgente, on peut ouvrir l'ActionSheet de TripDetail).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, RefreshControl,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { useI18n } from '../i18n/useI18n';
import { Loading } from '../ui/Loading';
import { EmptyState } from '../ui/EmptyState';
import { ScreenHeader } from '../ui/ScreenHeader';
import { AgencyFilter } from '../ui/AgencyFilter';
import { IconRefresh, IconTruck, IconClock, IconWarn, IconOk, IconAlert } from '../ui/icons';

interface LiveTrip {
  id:                 string;
  status:             string;
  state:              'planned' | 'on-time' | 'early' | 'delayed' | 'arrived' | 'suspended';
  delayMinutes:       number;
  departureScheduled: string;
  route?: {
    origin?:      { name: string } | null;
    destination?: { name: string } | null;
  } | null;
  bus?:    { plateNumber?: string | null } | null;
  driver?: { name?: string | null }       | null;
}

const POLL_INTERVAL_MS = 10_000;

export function AdminLiveScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const lang = (user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [trips,    setTrips]    = useState<LiveTrip[]>([]);
  const [agencyId, setAgencyId] = useState<string | 'ALL'>('ALL');
  const [loading,  setLoading]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const path = agencyId === 'ALL'
        ? `/api/tenants/${tenantId}/trips/live`
        : `/api/tenants/${tenantId}/trips/live?agencyId=${encodeURIComponent(agencyId)}`;
      const res = await apiGet<LiveTrip[]>(path, { skipAuthRedirect: true });
      setTrips(res ?? []);
      setLastUpdate(new Date());
    } catch {
      // silencieux — on garde le snapshot précédent (UI résiliente)
    }
  }, [tenantId, agencyId]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
    // Polling toutes les 10s tant que l'écran est monté
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Compteurs par état
  const counts = {
    inProgress: trips.filter(t => t.status === 'IN_PROGRESS').length,
    delayed:    trips.filter(t => t.state === 'delayed').length,
    boarding:   trips.filter(t => t.status === 'BOARDING' || t.status === 'OPEN').length,
    suspended:  trips.filter(t => t.state === 'suspended').length,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={L('Trajets en cours', 'Live trips')}
        subtitle={lastUpdate
          ? L(`Mis à jour ${formatTimeAgo(lastUpdate, lang)}`, `Updated ${formatTimeAgo(lastUpdate, lang)}`)
          : undefined}
        onBack={() => nav.goBack()}
        actions={[{ icon: IconRefresh, label: L('Rafraîchir', 'Refresh'), onPress: load }]}
      />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <AgencyFilter selected={agencyId} onChange={setAgencyId} />

      <View style={styles.summaryRow}>
        <SummaryChip icon={IconTruck} label={L('En cours', 'Live')} value={counts.inProgress} tone={colors.success} colors={colors} />
        <SummaryChip icon={IconWarn}  label={L('Retard', 'Delayed')} value={counts.delayed}    tone={colors.warning} colors={colors} alert={counts.delayed > 0} />
        <SummaryChip icon={IconClock} label={L('Embarq.', 'Boarding')} value={counts.boarding}  tone={colors.primary} colors={colors} />
        <SummaryChip icon={IconAlert} label={L('Suspendu', 'Held')}  value={counts.suspended}   tone={colors.danger}  colors={colors} alert={counts.suspended > 0} />
      </View>

      {loading && trips.length === 0 && <Loading />}

      <FlatList
        data={trips}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        ListEmptyComponent={!loading ? (
          <EmptyState
            icon={IconOk}
            title={L('Aucun trajet en cours', 'No live trip')}
            description={L('Tous les trajets de la journée sont terminés ou pas encore commencés.',
                          'All trips for today are completed or not yet started.')}
          />
        ) : null}
        renderItem={({ item }) => {
          const stateInfo = stateColors(item.state, colors);
          return (
            <Pressable
              onPress={() => nav.navigate('Trajets', { highlight: item.id })}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.card,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  borderLeftWidth: 4,
                  borderLeftColor: stateInfo.color,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                  {item.route?.origin?.name ?? '—'} → {item.route?.destination?.name ?? '—'}
                </Text>
                <View style={[styles.stateBadge, { backgroundColor: stateInfo.color }]}>
                  <Text style={{ color: stateInfo.fg, fontSize: 10, fontWeight: '800' }}>
                    {stateInfo.label(L)}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  🕒 {new Date(item.departureScheduled).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {item.delayMinutes !== 0 && (
                  <Text style={{
                    color: item.delayMinutes > 0 ? colors.warning : colors.success,
                    fontSize: 12, fontWeight: '700',
                  }}>
                    {item.delayMinutes > 0 ? '+' : ''}{item.delayMinutes} min
                  </Text>
                )}
                {item.bus?.plateNumber && (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>🚌 {item.bus.plateNumber}</Text>
                )}
                {item.driver?.name && (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>👤 {item.driver.name}</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

function SummaryChip({
  icon: Icon, label, value, tone, alert, colors,
}: {
  icon: typeof IconTruck;
  label: string;
  value: number;
  tone: string;
  alert?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[
      styles.summaryChip,
      { borderColor: alert ? tone : colors.border, backgroundColor: colors.surface },
    ]}>
      <Icon size={14} color={tone} />
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16, marginLeft: 4 }}>
        {value}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function stateColors(state: LiveTrip['state'], colors: ReturnType<typeof useTheme>['colors']): {
  color: string; fg: string; label: (L: (a: string, b: string) => string) => string;
} {
  switch (state) {
    case 'on-time':   return { color: colors.success, fg: '#fff',                label: (L) => L('À L’HEURE', 'ON TIME') };
    case 'delayed':   return { color: colors.warning, fg: '#fff',                label: (L) => L('RETARD',    'DELAYED') };
    case 'early':     return { color: colors.primary, fg: colors.primaryFg,      label: (L) => L('EN AVANCE', 'EARLY')   };
    case 'arrived':   return { color: colors.border,  fg: colors.textMuted,      label: (L) => L('ARRIVÉ',    'ARRIVED') };
    case 'suspended': return { color: colors.danger,  fg: '#fff',                label: (L) => L('SUSPENDU',  'HELD')    };
    case 'planned':
    default:          return { color: colors.border,  fg: colors.text,           label: (L) => L('PRÉVU',     'PLANNED') };
  }
}

function formatTimeAgo(d: Date, lang: string): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5)   return lang === 'en' ? 'just now' : 'à l’instant';
  if (sec < 60)  return lang === 'en' ? `${sec}s ago` : `il y a ${sec}s`;
  const min = Math.floor(sec / 60);
  return lang === 'en' ? `${min}min ago` : `il y a ${min}min`;
}

const styles = StyleSheet.create({
  banner:  { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  summaryChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent:'center',
    paddingVertical: 8,
    borderRadius:    10,
    borderWidth:     1,
    flexWrap:        'wrap',
    minHeight:       50,
  },
  card:    { padding: 14, borderRadius: 12, borderWidth: 1 },
  stateBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999 },
});
