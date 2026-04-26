/**
 * AdminIncidentsScreen — Triage incidents temps réel pour l'admin tenant.
 *
 * Cas d'usage :
 *   - Liste des incidents OPEN/IN_PROGRESS (SOS + standards) avec sévérité
 *     visible.
 *   - Action one-tap : assigner à soi-même (acknowledge), ou résoudre avec
 *     note libre.
 *   - L'investigation profonde (photos, attachements, comments) reste sur le
 *     web — le mobile sert au triage rapide en mobilité.
 *
 * Sécurité :
 *   - GET /incidents : TRIP_UPDATE_AGENCY (partagé avec dispatch).
 *   - PATCH assign / resolve : même permission.
 *   - Idempotency-Key sur les mutations (clé déterministe id+action).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { useI18n } from '../i18n/useI18n';

type StatusFilter = 'OPEN' | 'IN_PROGRESS' | 'ALL';

const FILTERS: { id: StatusFilter; fr: string; en: string }[] = [
  { id: 'OPEN',        fr: 'À traiter',   en: 'Open'    },
  { id: 'IN_PROGRESS', fr: 'En cours',    en: 'Live'    },
  { id: 'ALL',         fr: 'Tous',        en: 'All'     },
];

interface Incident {
  id:         string;
  status:     'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | string;
  severity:   'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string | null;
  isSos:      boolean | null;
  category:   string | null;
  description: string | null;
  createdAt:  string;
  tripId:     string | null;
  assigneeId: string | null;
  reporter?: {
    id:    string;
    name?: string | null;
  } | null;
  trip?: {
    route?: {
      origin?:      { name: string } | null;
      destination?: { name: string } | null;
    } | null;
  } | null;
}

export function AdminIncidentsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [filter, setFilter]   = useState<StatusFilter>('OPEN');
  const [items, setItems]     = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [sosOnly, setSosOnly] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const qs = new URLSearchParams();
      if (filter !== 'ALL') qs.set('status', filter);
      if (sosOnly) qs.set('sos', 'true');
      const path = qs.toString()
        ? `/api/tenants/${tenantId}/incidents?${qs.toString()}`
        : `/api/tenants/${tenantId}/incidents`;
      const res = await apiGet<Incident[]>(path, { skipAuthRedirect: true });
      setItems(res ?? []);
    } catch {
      setItems([]);
    }
  }, [tenantId, filter, sosOnly]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function ack(item: Incident) {
    if (!online) {
      Alert.alert(L('Réseau requis', 'Network required'));
      return;
    }
    if (!user?.id) return;
    Alert.alert(
      L('Prendre cet incident ?', 'Take this incident?'),
      L('Vous serez assigné comme responsable.', 'You will be assigned as the owner.'),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Prendre', 'Take'),
          onPress: async () => {
            setBusyId(item.id);
            try {
              await apiPatch(
                `/api/tenants/${tenantId}/incidents/${item.id}/assign`,
                { assigneeId: user.id },
                {
                  skipAuthRedirect: true,
                  headers: { 'Idempotency-Key': `incident-assign:${item.id}:${user.id}` },
                },
              );
              await load();
            } catch (e) {
              Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }

  function resolve(item: Incident) {
    if (!online) {
      Alert.alert(L('Réseau requis', 'Network required'));
      return;
    }
    Alert.prompt(
      L('Résoudre l’incident', 'Resolve incident'),
      L('Saisissez la résolution (≥ 5 caractères).', 'Enter resolution note (≥ 5 chars).'),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Résoudre', 'Resolve'),
          onPress: async (resolution?: string) => {
            const r = (resolution ?? '').trim();
            if (r.length < 5) {
              Alert.alert(L('Note trop courte', 'Note too short'));
              return;
            }
            setBusyId(item.id);
            try {
              await apiPatch(
                `/api/tenants/${tenantId}/incidents/${item.id}/resolve`,
                { resolution: r },
                {
                  skipAuthRedirect: true,
                  headers: { 'Idempotency-Key': `incident-resolve:${item.id}` },
                },
              );
              setItems(prev => prev.filter(x => x.id !== item.id));
            } catch (e) {
              Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
      'plain-text',
    );
  }

  const sosCount = useMemo(() => items.filter(i => i.isSos === true).length, [items]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Incidents', 'Incidents')}
        </Text>
        {sosCount > 0 && (
          <View style={[styles.sosBadge, { backgroundColor: colors.danger }]}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>SOS · {sosCount}</Text>
          </View>
        )}
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <View style={[styles.filters, { borderBottomColor: colors.border }]}>
        {FILTERS.map(f => {
          const active = filter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.tab, active && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            >
              <Text style={{ color: active ? colors.primary : colors.textMuted, fontWeight: '700' }}>
                {L(f.fr, f.en)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setSosOnly(s => !s)}
          accessibilityRole="switch"
          accessibilityState={{ checked: sosOnly }}
          style={[styles.tab, { marginLeft: 'auto' }]}
        >
          <Text style={{ color: sosOnly ? colors.danger : colors.textMuted, fontWeight: '700', fontSize: 12 }}>
            {sosOnly ? L('🚨 SOS', '🚨 SOS') : L('Tous', 'All')}
          </Text>
        </Pressable>
      </View>

      {loading && items.length === 0 && (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        ListEmptyComponent={!loading ? (
          <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
            {L('Aucun incident.', 'No incident.')}
          </Text>
        ) : null}
        renderItem={({ item }) => {
          const sevColor = severityToColor(item.severity, colors);
          return (
            <View style={[
              styles.card,
              {
                borderColor: item.isSos ? colors.danger : colors.border,
                backgroundColor: colors.surface,
                borderLeftWidth: 4,
                borderLeftColor: item.isSos ? colors.danger : sevColor,
              },
            ]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {item.isSos && (
                  <Text style={{ color: colors.danger, fontWeight: '900', fontSize: 12 }}>🚨 SOS</Text>
                )}
                {item.severity && (
                  <Text style={{ color: sevColor, fontWeight: '700', fontSize: 11 }}>
                    {item.severity}
                  </Text>
                )}
                <Text style={{ color: colors.textMuted, fontSize: 11, marginLeft: 'auto' }}>
                  {new Date(item.createdAt).toLocaleString(lang, {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </View>

              {item.category && (
                <Text style={{ color: colors.text, fontWeight: '700', marginTop: 6 }}>
                  {item.category}
                </Text>
              )}

              {item.description && (
                <Text style={{ color: colors.text, marginTop: 4 }} numberOfLines={3}>
                  {item.description}
                </Text>
              )}

              {item.trip?.route && (
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
                  🛣 {item.trip.route.origin?.name ?? '—'} → {item.trip.route.destination?.name ?? '—'}
                </Text>
              )}

              {item.reporter?.name && (
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                  👤 {item.reporter.name}
                </Text>
              )}

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Pressable
                  onPress={() => resolve(item)}
                  disabled={busyId === item.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.btn,
                    {
                      backgroundColor: colors.success,
                      opacity: pressed || busyId === item.id ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>
                    {L('Résoudre', 'Resolve')}
                  </Text>
                </Pressable>
                {!item.assigneeId && (
                  <Pressable
                    onPress={() => ack(item)}
                    disabled={busyId === item.id}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.btnOutline,
                      {
                        borderColor: colors.primary,
                        opacity: pressed || busyId === item.id ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>
                      {L('Prendre', 'Take')}
                    </Text>
                  </Pressable>
                )}
                {item.assigneeId && (
                  <View style={[styles.btnOutline, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      {L('Assigné', 'Assigned')}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function severityToColor(sev: string | null | undefined, colors: ReturnType<typeof useTheme>['colors']): string {
  switch (sev) {
    case 'CRITICAL': return colors.danger;
    case 'HIGH':     return colors.danger;
    case 'MEDIUM':   return colors.warning;
    case 'LOW':      return colors.success;
    default:         return colors.border;
  }
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:      { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:        { fontSize: 18, fontWeight: '800', flex: 1 },
  sosBadge:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  banner:    { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  filters:   {
    flexDirection:    'row',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems:        'center',
  },
  tab:       { paddingVertical: 12, paddingHorizontal: 12, minHeight: 44 },
  card:      { padding: 14, borderRadius: 12, borderWidth: 1 },
  btn:       { flex: 1, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnOutline:{ flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
