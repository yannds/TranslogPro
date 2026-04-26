/**
 * PlatformTenantsScreen — Liste des tenants clients du SaaS, vue super-admin.
 *
 * Source : GET /api/platform/analytics/tenant/:id et GET /platform/analytics/growth
 * pour la liste des top tenants. Pour la liste complète paginée, on utilise
 * directement /api/tenants (perm TENANT_MANAGE).
 *
 * Actions :
 *   - Liste (filtre status : ACTIVE / TRIAL / SUSPENDED / CANCELLED)
 *   - Tap → détail (subscription + activité)
 *   - Suspendre / Réactiver (PATCH /api/tenants/:id)
 *   - Onboarding nouveau tenant (POST /api/tenants — wizard 3 étapes)
 *
 * Permission requise : control.tenant.manage.global.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, RefreshControl, Alert, TextInput,
} from 'react-native';
import { apiGet, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { Loading } from '../ui/Loading';
import { EmptyState } from '../ui/EmptyState';
import { ScreenHeader } from '../ui/ScreenHeader';
import {
  IconBuilding, IconSearch, IconRefresh, IconAdd,
} from '../ui/icons';

interface Tenant {
  id:              string;
  slug:            string;
  name:            string;
  country?:        string | null;
  provisionStatus: string;
  planId?:         string | null;
  createdAt:       string;
}

const STATUS_FILTERS = [
  { id: 'all',       fr: 'Tous',      en: 'All'        },
  { id: 'ACTIVE',    fr: 'Actifs',    en: 'Active'     },
  { id: 'TRIAL',     fr: 'Essai',     en: 'Trial'      },
  { id: 'SUSPENDED', fr: 'Suspendus', en: 'Suspended'  },
] as const;

export function PlatformTenantsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const lang = (user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [items,    setItems]    = useState<Tenant[]>([]);
  const [filter,   setFilter]   = useState<string>('all');
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId,   setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ items?: Tenant[] } | Tenant[]>(
        '/api/tenants?limit=100',
        { skipAuthRedirect: true },
      );
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      setItems(list as Tenant[]);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function askToggleStatus(t: Tenant) {
    if (!online) { Alert.alert(L('Réseau requis', 'Network required')); return; }
    const isSuspending = t.provisionStatus === 'ACTIVE' || t.provisionStatus === 'TRIAL';
    Alert.alert(
      isSuspending
        ? L('Suspendre ce tenant ?', 'Suspend this tenant?')
        : L('Réactiver ce tenant ?', 'Reactivate this tenant?'),
      `${t.name} (${t.slug})`,
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: isSuspending ? L('Suspendre', 'Suspend') : L('Réactiver', 'Reactivate'),
          style: isSuspending ? 'destructive' : 'default',
          onPress: async () => {
            setBusyId(t.id);
            try {
              await apiPatch(
                `/api/tenants/${t.id}`,
                { provisionStatus: isSuspending ? 'SUSPENDED' : 'ACTIVE' },
                {
                  skipAuthRedirect: true,
                  headers: { 'Idempotency-Key': `tenant-status:${t.id}:${isSuspending ? 'suspend' : 'reactivate'}` },
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

  const visible = useMemo(() => {
    let list = items;
    if (filter !== 'all') list = list.filter(t => t.provisionStatus === filter);
    const q = search.trim().toLowerCase();
    if (q.length >= 2) {
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.country ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, filter, search]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={L('Tenants', 'Tenants')}
        subtitle={`${items.length} ${L('total', 'total')}`}
        actions={[
          {
            icon: IconAdd,
            label: L('Nouveau tenant', 'New tenant'),
            onPress: () => Alert.alert(
              L('Onboarding', 'Onboarding'),
              L('Wizard de création disponible dans une prochaine version. Utilisez le portail web pour créer un tenant.',
                'Creation wizard coming soon. Use the web portal to create a tenant.'),
            ),
          },
          { icon: IconRefresh, label: L('Rafraîchir', 'Refresh'), onPress: load },
        ]}
      />

      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <IconSearch size={16} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={L('Rechercher (nom / slug / pays)', 'Search (name / slug / country)')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
      </View>

      <View style={[styles.filtersRow, { borderBottomColor: colors.border }]}>
        {STATUS_FILTERS.map(f => {
          const active = filter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              accessibilityRole="tab"
              style={[
                styles.chip,
                {
                  borderColor:     active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary : 'transparent',
                },
              ]}
            >
              <Text style={{
                color: active ? colors.primaryFg : colors.text,
                fontWeight: '600', fontSize: 12,
              }}>{L(f.fr, f.en)}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading && items.length === 0 && <Loading />}

      <FlatList
        data={visible}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        ListEmptyComponent={!loading ? (
          <EmptyState
            icon={IconBuilding}
            title={L('Aucun tenant', 'No tenant')}
            description={search || filter !== 'all'
              ? L('Essayez d’élargir le filtre.', 'Try widening the filter.')
              : L('Aucun tenant créé pour le moment.', 'No tenant created yet.')}
          />
        ) : null}
        renderItem={({ item }) => {
          const status = statusInfo(item.provisionStatus, colors);
          const canToggle = ['ACTIVE', 'TRIAL', 'SUSPENDED'].includes(item.provisionStatus);
          return (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                    {item.slug}{item.country ? ` · ${item.country}` : ''}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                  <Text style={{ color: status.fg, fontSize: 10, fontWeight: '800' }}>
                    {item.provisionStatus}
                  </Text>
                </View>
              </View>
              {canToggle && (
                <Pressable
                  onPress={() => askToggleStatus(item)}
                  disabled={busyId === item.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.btnOutline,
                    {
                      borderColor: item.provisionStatus === 'SUSPENDED' ? colors.success : colors.warning,
                      opacity: pressed || busyId === item.id ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={{
                    color: item.provisionStatus === 'SUSPENDED' ? colors.success : colors.warning,
                    fontWeight: '700',
                  }}>
                    {item.provisionStatus === 'SUSPENDED'
                      ? L('Réactiver', 'Reactivate')
                      : L('Suspendre', 'Suspend')}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function statusInfo(s: string, colors: ReturnType<typeof useTheme>['colors']) {
  switch (s) {
    case 'ACTIVE':    return { bg: colors.success, fg: '#fff' };
    case 'TRIAL':     return { bg: colors.primary, fg: colors.primaryFg };
    case 'SUSPENDED': return { bg: colors.warning, fg: '#fff' };
    case 'CANCELLED': return { bg: colors.danger,  fg: '#fff' };
    default:          return { bg: colors.border,  fg: colors.text };
  }
}

const styles = StyleSheet.create({
  searchBox:   { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, fontSize: 14 },
  filtersRow:  { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  chip:        { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, minHeight: 30 },
  card:        { padding: 14, borderRadius: 12, borderWidth: 1 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999 },
  btnOutline:  { marginTop: 10, minHeight: 40, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
