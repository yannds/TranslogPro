/**
 * AdminTeamsScreen — Vue équipes (staff) mobile pour l'admin tenant.
 *
 * Sprint A3 scope mobile :
 *   - Liste staff par agence (GET /staff?agencyId=…)
 *   - Filtrage par rôle (tous | DRIVER | CASHIER | STATION_AGENT | AGENT_QUAI | MANAGER)
 *   - Actions one-tap : suspendre / réactiver / détail
 *   - Création / édition complètes → restent sur le dashboard web (pour la
 *     validation RH lourde, scans documents, signatures contractuelles) ;
 *     le mobile ne fait QUE les ops urgentes du terrain.
 *
 * Sécurité :
 *   - STAFF_READ_TENANT / STAFF_READ.
 *   - Suspend/reactivate nécessitent STAFF_MANAGE (les non-admins voient le
 *     bouton désactivé — le service rejettera côté back si tentative).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

const ROLE_FILTERS = [
  { id: 'ALL',           fr: 'Tous',    en: 'All'     },
  { id: 'DRIVER',        fr: 'Chauff.', en: 'Driver'  },
  { id: 'CASHIER',       fr: 'Caisse',  en: 'Cashier' },
  { id: 'STATION_AGENT', fr: 'Gare',    en: 'Station' },
  { id: 'AGENT_QUAI',    fr: 'Quai',    en: 'Dock'    },
  { id: 'MANAGER',       fr: 'Mgmt',    en: 'Mgmt'    },
] as const;

type RoleId = typeof ROLE_FILTERS[number]['id'];

interface Agency {
  id:   string;
  name: string;
}

interface Staff {
  userId:    string;
  role:      string;
  status:    'ACTIVE' | 'SUSPENDED' | string;
  agencyId:  string | null;
  user: {
    id:    string;
    name:  string | null;
    email: string | null;
    phone: string | null;
  };
}

export function AdminTeamsScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agencyId, setAgencyId] = useState<string | 'ALL'>('ALL');
  const [role, setRole]         = useState<RoleId>('ALL');
  const [staff, setStaff]       = useState<Staff[]>([]);
  const [loading, setLoading]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId]     = useState<string | null>(null);

  const loadAgencies = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<Agency[]>(
        `/api/tenants/${tenantId}/agencies`,
        { skipAuthRedirect: true },
      );
      setAgencies(res ?? []);
    } catch { /* silent */ }
  }, [tenantId]);

  const loadStaff = useCallback(async () => {
    if (!tenantId) return;
    try {
      const params = new URLSearchParams();
      if (agencyId !== 'ALL') params.set('agencyId', agencyId);
      if (role !== 'ALL')     params.set('role', role);
      const res = await apiGet<Staff[]>(
        `/api/tenants/${tenantId}/staff?${params.toString()}`,
        { skipAuthRedirect: true },
      );
      setStaff(res ?? []);
    } catch { /* silent */ }
  }, [tenantId, agencyId, role]);

  useEffect(() => { void loadAgencies(); }, [loadAgencies]);
  useEffect(() => {
    setLoading(true);
    loadStaff().finally(() => setLoading(false));
  }, [loadStaff]);

  async function onPullRefresh() {
    setRefreshing(true);
    await Promise.all([loadAgencies(), loadStaff()]);
    setRefreshing(false);
  }

  async function toggleSuspend(s: Staff) {
    if (!online) {
      Alert.alert(L('Action nécessite réseau', 'Requires network'),
        L('Les changements RH ne partent pas en file.', 'HR changes are not queued.'));
      return;
    }
    const action = s.status === 'ACTIVE' ? 'suspend' : 'reactivate';
    const label  = s.status === 'ACTIVE' ? L('Suspendre', 'Suspend') : L('Réactiver', 'Reactivate');
    Alert.alert(
      `${label} ${s.user.name ?? s.user.email ?? ''} ?`,
      s.status === 'ACTIVE'
        ? L('Le staff perdra l\'accès aux apps et trips assignés.',
            'Staff will lose access to apps and assigned trips.')
        : L('Le staff retrouvera ses accès.',
            'Staff will regain access.'),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: label,
          style: action === 'suspend' ? 'destructive' : 'default',
          onPress: async () => {
            setBusyId(s.userId);
            try {
              await apiPatch(
                `/api/tenants/${tenantId}/staff/${s.userId}/${action}`,
                {},
                { skipAuthRedirect: true, headers: { 'Idempotency-Key': `staff-${action}:${s.userId}` } },
              );
              setStaff(prev => prev.map(x =>
                x.userId === s.userId
                  ? { ...x, status: action === 'suspend' ? 'SUSPENDED' : 'ACTIVE' }
                  : x,
              ));
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  const grouped = useMemo(() => {
    const m = new Map<string, Staff[]>();
    for (const s of staff) {
      const key = s.role;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [staff]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Équipes', 'Teams')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {/* ── Filtre agence ─────────────────────────────────────────────────── */}
      <View style={styles.filterRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ id: 'ALL', name: L('Toutes', 'All') } as Agency, ...agencies]}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
          renderItem={({ item }) => {
            const selected = item.id === agencyId;
            return (
              <Pressable
                onPress={() => setAgencyId(item.id as string | 'ALL')}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[
                  styles.chip,
                  {
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primary : colors.surface,
                  },
                ]}
              >
                <Text style={{ color: selected ? colors.primaryFg : colors.text, fontSize: 12 }}>
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {/* ── Filtre rôle ───────────────────────────────────────────────────── */}
      <View style={styles.filterRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[...ROLE_FILTERS]}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
          renderItem={({ item }) => {
            const selected = item.id === role;
            return (
              <Pressable
                onPress={() => setRole(item.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[
                  styles.chip,
                  {
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primary : colors.surface,
                  },
                ]}
              >
                <Text style={{ color: selected ? colors.primaryFg : colors.text, fontSize: 12 }}>
                  {lang === 'en' ? item.en : item.fr}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {loading && staff.length === 0 && <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />}

      <FlatList
        data={grouped}
        keyExtractor={([roleKey]) => roleKey}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        ListEmptyComponent={!loading ? (
          <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
            {L('Aucun staff dans cette sélection.', 'No staff in this selection.')}
          </Text>
        ) : null}
        renderItem={({ item: [roleKey, list] }) => (
          <View>
            <Text style={[styles.h2, { color: colors.textMuted }]}>
              {roleKey} · {list.length}
            </Text>
            <View style={{ gap: 6, marginTop: 6 }}>
              {list.map((s, idx) => {
                const suspended = s.status === 'SUSPENDED';
                // Cl\u00e9 composite : un m\u00eame user peut avoir plusieurs lignes Staff pour
                // le m\u00eame r\u00f4le mais des agences diff\u00e9rentes (multi-assignments),
                // d'o\u00f9 la duplication potentielle de userId dans le m\u00eame groupe.
                // L'index est un tie-breaker ultime (jamais d\u00e9clench\u00e9 en pratique).
                return (
                  <View
                    key={`${s.userId}-${s.agencyId ?? 'none'}-${idx}`}
                    style={[
                      styles.card,
                      {
                        borderColor: colors.border,
                        backgroundColor: suspended ? colors.dangerBg : colors.surface,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                        {s.user.name ?? s.user.email ?? '—'}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                        {s.user.email ?? s.user.phone ?? '—'}
                      </Text>
                      {suspended && (
                        <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700', marginTop: 2 }}>
                          SUSPENDED
                        </Text>
                      )}
                    </View>
                    <Pressable
                      onPress={() => toggleSuspend(s)}
                      disabled={busyId === s.userId}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.actionBtn,
                        {
                          backgroundColor: suspended ? colors.success : colors.surface,
                          borderColor: suspended ? colors.success : colors.danger,
                          opacity: pressed || busyId === s.userId ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text style={{ color: suspended ? '#fff' : colors.danger, fontWeight: '700', fontSize: 12 }}>
                        {suspended ? L('Réactiver', 'Reactivate') : L('Suspendre', 'Suspend')}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:      { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:        { fontSize: 18, fontWeight: '800' },
  h2:        { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  banner:    { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  filterRow: { paddingVertical: 6 },
  chip:      { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, minHeight: 36, justifyContent: 'center' },
  card:      { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  actionBtn: { paddingHorizontal: 10, minHeight: 36, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
