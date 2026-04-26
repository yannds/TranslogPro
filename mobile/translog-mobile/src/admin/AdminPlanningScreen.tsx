/**
 * AdminPlanningScreen — Hub Planning admin/manager (3 sous-vues).
 *
 * SegmentedControl :
 *   - Calendrier  : grille semaine — bus × jours, navigation S ± N
 *                   (réutilise GET /trips?from=&to=&agencyId= existant)
 *   - Ressources  : chauffeurs assignés cross-trips (groupé par jour)
 *   - Repos       : chauffeurs actuellement en repos (endedAt=null)
 *                   GET /driver-profile/rest-active (créé en L4 backend)
 *
 * Vue par défaut : Calendrier sur la semaine courante.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, FlatList, Pressable, StyleSheet, RefreshControl,
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
import { SegmentedControl } from '../ui/SegmentedControl';
import { AgencyFilter } from '../ui/AgencyFilter';
import { IconCoffee, IconTruck, IconCalendar, IconRefresh, IconUserCircle } from '../ui/icons';

type PlanTab = 'calendar' | 'resources' | 'rest';

interface Trip {
  id:                 string;
  status:             string;
  departureScheduled: string;
  bus?:    { id: string; plateNumber?: string | null } | null;
  driver?: { id: string; user?: { name?: string | null } | null } | null;
  route?: {
    origin?:      { name: string } | null;
    destination?: { name: string } | null;
  } | null;
}

interface RestPeriod {
  id:          string;
  staffId:     string;
  startedAt:   string;
  source:      string;
  notes:       string | null;
  durationMin: number;
  agencyId:    string | null;
  driver?: { id: string; name: string | null; email: string | null } | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

export function AdminPlanningScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const lang = (user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tab,         setTab]         = useState<PlanTab>('calendar');
  const [agencyId,    setAgencyId]    = useState<string | 'ALL'>('ALL');
  const [weekOffset,  setWeekOffset]  = useState(0);
  const [trips,       setTrips]       = useState<Trip[]>([]);
  const [rest,        setRest]        = useState<RestPeriod[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  // Range = semaine sélectionnée (lundi 00:00 → dimanche 23:59:59)
  const week = useMemo(() => {
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    const day = monday.getDay();
    const diff = day === 0 ? 6 : day - 1; // semaine commence lundi
    monday.setDate(monday.getDate() - diff + weekOffset * 7);
    const sunday = new Date(monday.getTime() + 7 * MS_PER_DAY - 1);
    return { from: monday, to: sunday };
  }, [weekOffset]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(week.from);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [week]);

  function weekLabel(): string {
    if (weekOffset === 0)  return L('Cette semaine',     'This week');
    if (weekOffset === 1)  return L('Semaine prochaine', 'Next week');
    if (weekOffset === -1) return L('Semaine dernière',  'Last week');
    const start = week.from.toLocaleDateString(lang, { day: '2-digit', month: 'short' });
    const end   = week.to.toLocaleDateString(lang,   { day: '2-digit', month: 'short' });
    return `${start} → ${end}`;
  }

  const loadTrips = useCallback(async () => {
    if (!tenantId) return;
    try {
      const qs = new URLSearchParams({
        from: week.from.toISOString(),
        to:   week.to.toISOString(),
      });
      if (agencyId !== 'ALL') qs.set('agencyId', agencyId);
      const res = await apiGet<Trip[]>(
        `/api/tenants/${tenantId}/trips?${qs.toString()}`,
        { skipAuthRedirect: true },
      );
      setTrips(res ?? []);
    } catch {
      setTrips([]);
    }
  }, [tenantId, week, agencyId]);

  const loadRest = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<RestPeriod[]>(
        `/api/tenants/${tenantId}/driver-profile/rest-active`,
        { skipAuthRedirect: true },
      );
      const filtered = agencyId === 'ALL'
        ? (res ?? [])
        : (res ?? []).filter(p => p.agencyId === agencyId);
      setRest(filtered);
    } catch {
      setRest([]);
    }
  }, [tenantId, agencyId]);

  useEffect(() => {
    setLoading(true);
    if (tab === 'rest') {
      loadRest().finally(() => setLoading(false));
    } else {
      loadTrips().finally(() => setLoading(false));
    }
  }, [tab, loadTrips, loadRest]);

  async function onPullRefresh() {
    setRefreshing(true);
    if (tab === 'rest') await loadRest();
    else                await loadTrips();
    setRefreshing(false);
  }

  // ── Calendrier : groupé par bus × jour ─────────────────────────────────
  const calendarByBus = useMemo(() => {
    const map = new Map<string, { busLabel: string; days: Trip[][] }>();
    for (const trip of trips) {
      const busKey = trip.bus?.id ?? '__no_bus__';
      const busLabel = trip.bus?.plateNumber ?? L('Sans bus assigné', 'No bus assigned');
      if (!map.has(busKey)) {
        map.set(busKey, { busLabel, days: Array.from({ length: 7 }, () => [] as Trip[]) });
      }
      const dayIdx = Math.floor((new Date(trip.departureScheduled).getTime() - week.from.getTime()) / MS_PER_DAY);
      if (dayIdx >= 0 && dayIdx < 7) {
        map.get(busKey)!.days[dayIdx].push(trip);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].busLabel.localeCompare(b[1].busLabel));
  }, [trips, week, lang]);

  // ── Ressources : chauffeurs assignés cross-trips ───────────────────────
  const resourcesByDriver = useMemo(() => {
    const map = new Map<string, { name: string; trips: Trip[] }>();
    for (const t of trips) {
      const driverKey = t.driver?.id ?? '__unassigned__';
      const driverName = t.driver?.user?.name ?? L('Non assigné', 'Unassigned');
      if (!map.has(driverKey)) map.set(driverKey, { name: driverName, trips: [] });
      map.get(driverKey)!.trips.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].trips.length - a[1].trips.length);
  }, [trips, lang]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={L('Planning', 'Planning')}
        onBack={() => nav.goBack()}
        actions={[{ icon: IconRefresh, label: L('Rafraîchir', 'Refresh'), onPress: onPullRefresh }]}
      />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <SegmentedControl
        items={[
          { id: 'calendar',  label: L('Calendrier',  'Calendar')  },
          { id: 'resources', label: L('Ressources',  'Resources') },
          { id: 'rest',      label: L('Repos',       'Rest'), badge: rest.length },
        ]}
        selected={tab}
        onChange={(id) => setTab(id as PlanTab)}
      />

      <AgencyFilter selected={agencyId} onChange={setAgencyId} />

      {/* ── Navigation semaine (Calendrier + Ressources) ────────────────── */}
      {(tab === 'calendar' || tab === 'resources') && (
        <View style={[styles.weekRow, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => setWeekOffset(w => Math.max(w - 1, -8))} disabled={weekOffset <= -8} hitSlop={8} style={styles.navBtn}>
            <Text style={{ color: weekOffset <= -8 ? colors.textMuted : colors.primary, fontSize: 22, fontWeight: '700' }}>‹</Text>
          </Pressable>
          <Pressable onPress={() => setWeekOffset(0)} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{weekLabel()}</Text>
          </Pressable>
          <Pressable onPress={() => setWeekOffset(w => Math.min(w + 1, 8))} disabled={weekOffset >= 8} hitSlop={8} style={styles.navBtn}>
            <Text style={{ color: weekOffset >= 8 ? colors.textMuted : colors.primary, fontSize: 22, fontWeight: '700' }}>›</Text>
          </Pressable>
        </View>
      )}

      {loading && trips.length === 0 && rest.length === 0 && <Loading />}

      {/* ── Calendrier ─────────────────────────────────────────────────── */}
      {tab === 'calendar' && (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        >
          {calendarByBus.length === 0 && !loading ? (
            <EmptyState
              icon={IconCalendar}
              title={L('Aucun trajet cette semaine', 'No trip this week')}
            />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                {/* Header jours */}
                <View style={{ flexDirection: 'row' }}>
                  <View style={[styles.cellBus, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700' }}>BUS</Text>
                  </View>
                  {weekDays.map((d, i) => (
                    <View key={i} style={[styles.cellDay, { borderColor: colors.border }]}>
                      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                        {d.toLocaleDateString(lang, { weekday: 'short' })}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 10 }}>
                        {d.getDate()}
                      </Text>
                    </View>
                  ))}
                </View>
                {/* Lignes bus */}
                {calendarByBus.map(([busKey, { busLabel, days }]) => (
                  <View key={busKey} style={{ flexDirection: 'row' }}>
                    <View style={[styles.cellBus, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                      <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>
                        {busLabel}
                      </Text>
                    </View>
                    {days.map((dayTrips, i) => (
                      <View key={i} style={[styles.cellDayTrips, { borderColor: colors.border }]}>
                        {dayTrips.length === 0 ? (
                          <Text style={{ color: colors.textMuted, fontSize: 10 }}>—</Text>
                        ) : dayTrips.slice(0, 3).map(tr => (
                          <View key={tr.id} style={[styles.tripChip, { backgroundColor: colors.primary }]}>
                            <Text style={{ color: colors.primaryFg, fontSize: 9, fontWeight: '600' }} numberOfLines={1}>
                              {new Date(tr.departureScheduled).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                          </View>
                        ))}
                        {dayTrips.length > 3 && (
                          <Text style={{ color: colors.textMuted, fontSize: 9 }}>+{dayTrips.length - 3}</Text>
                        )}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </ScrollView>
      )}

      {/* ── Ressources : chauffeurs cross-trips ──────────────────────────── */}
      {tab === 'resources' && (
        <FlatList
          data={resourcesByDriver}
          keyExtractor={([k]) => k}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? (
            <EmptyState icon={IconTruck} title={L('Aucun chauffeur cette semaine', 'No driver this week')} />
          ) : null}
          renderItem={({ item: [, group] }) => (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <IconUserCircle size={20} color={colors.primary} />
                <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                  {group.name}
                </Text>
                <Text style={{ color: colors.textMuted, fontWeight: '700' }}>
                  {group.trips.length} {L('trajets', 'trips')}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                {group.trips.slice(0, 6).map(tr => (
                  <View key={tr.id} style={[styles.routeChip, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.text, fontSize: 11 }} numberOfLines={1}>
                      {tr.route?.origin?.name?.slice(0, 4) ?? '?'} → {tr.route?.destination?.name?.slice(0, 4) ?? '?'}
                    </Text>
                  </View>
                ))}
                {group.trips.length > 6 && (
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>+{group.trips.length - 6}</Text>
                )}
              </View>
            </View>
          )}
        />
      )}

      {/* ── Repos : chauffeurs actuellement indisponibles ────────────────── */}
      {tab === 'rest' && (
        <FlatList
          data={rest}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? (
            <EmptyState
              icon={IconCoffee}
              title={L('Aucun chauffeur en repos', 'No driver resting')}
              description={L('Tous les chauffeurs sont disponibles.', 'All drivers are available.')}
            />
          ) : null}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <IconCoffee size={20} color={colors.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                    {item.driver?.name ?? item.driver?.email ?? item.staffId}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    {L('Depuis', 'Since')} {new Date(item.startedAt).toLocaleString(lang, {
                      weekday: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                    {' · '}
                    <Text style={{ color: colors.warning, fontWeight: '700' }}>
                      {formatDuration(item.durationMin, lang)}
                    </Text>
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                    {item.source}{item.notes ? ` · ${item.notes}` : ''}
                  </Text>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function formatDuration(min: number, lang: string): string {
  if (min < 60) return lang === 'en' ? `${min}min` : `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return lang === 'en' ? `${h}h${m > 0 ? m + 'min' : ''}` : `${h}h${m > 0 ? m + 'min' : ''}`;
}

const styles = StyleSheet.create({
  banner:  { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  weekRow: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navBtn:  { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  cellBus: { width: 110, padding: 8, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  cellDay: { width: 70, padding: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  cellDayTrips: { width: 70, padding: 4, borderWidth: StyleSheet.hairlineWidth, gap: 2, justifyContent: 'center', minHeight: 60 },
  tripChip: { paddingVertical: 2, paddingHorizontal: 4, borderRadius: 4, alignItems: 'center' },
  card:     { padding: 14, borderRadius: 12, borderWidth: 1 },
  routeChip:{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
});
