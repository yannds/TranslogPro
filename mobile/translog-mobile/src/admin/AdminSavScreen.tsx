/**
 * AdminSavScreen — File SAV (remboursements + réclamations) pour l'admin
 * tenant / responsable agence.
 *
 * Deux onglets :
 *   - Remboursements à traiter : GET /sav/refunds?status=REQUESTED
 *       → Actions one-tap : Approve / Reject (POST /sav/refunds/:id/approve|reject)
 *   - Réclamations en cours : GET /sav/claims?status=OPEN
 *       → Action : Resolve / Reject (PATCH /sav/claims/:id/process)
 *
 * Sécurité :
 *   - Les permissions requises sont REFUND_APPROVE_TENANT/AGENCY, SAV_CLAIM_TENANT.
 *   - Confirmations obligatoires sur les actions destructives (irréversibles).
 *   - Idempotency-Key déterministe sur approve/reject pour éviter double clic
 *     → la clé contient l'id + l'action, pas le timestamp (outbox-safe).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

type Tab = 'refunds' | 'claims';

interface RefundItem {
  id:            string;
  amount:        number;
  currency:      string | null;
  reason:        string | null;
  status:        'REQUESTED' | 'APPROVED' | 'PROCESSED' | 'REJECTED' | string;
  createdAt:     string;
  ticketId?:     string | null;
  parcelId?:     string | null;
  requestedBy?:  string | null;
}

interface ClaimItem {
  id:         string;
  type:       string;
  status:     'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'REJECTED' | string;
  description: string;
  createdAt:  string;
  reporterName?: string | null;
}

export function AdminSavScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tab, setTab]           = useState<Tab>('refunds');
  const [refunds, setRefunds]   = useState<RefundItem[]>([]);
  const [claims, setClaims]     = useState<ClaimItem[]>([]);
  const [loading, setLoading]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId]     = useState<string | null>(null);

  const loadRefunds = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<RefundItem[]>(
        `/api/tenants/${tenantId}/sav/refunds?status=REQUESTED`,
        { skipAuthRedirect: true },
      );
      setRefunds(res ?? []);
    } catch { /* silent */ }
  }, [tenantId]);

  const loadClaims = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<ClaimItem[]>(
        `/api/tenants/${tenantId}/sav/claims?status=OPEN`,
        { skipAuthRedirect: true },
      );
      setClaims(res ?? []);
    } catch { /* silent */ }
  }, [tenantId]);

  const load = useCallback(async () => {
    await Promise.all([loadRefunds(), loadClaims()]);
  }, [loadRefunds, loadClaims]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function approveRefund(r: RefundItem) {
    if (!online) {
      Alert.alert(L('Action nécessite réseau', 'Action requires network'),
        L('Les validations SAV ne partent pas en outbox.', 'SAV validations are not queued.'));
      return;
    }
    Alert.alert(
      L('Approuver le remboursement ?', 'Approve refund?'),
      `${r.amount} ${r.currency ?? ''} — ${r.reason ?? L('Sans motif', 'No reason')}`,
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Approuver', 'Approve'),
          onPress: async () => {
            setBusyId(r.id);
            try {
              await apiPost(
                `/api/tenants/${tenantId}/sav/refunds/${r.id}/approve`,
                {},
                { skipAuthRedirect: true, headers: { 'Idempotency-Key': `refund-approve:${r.id}` } },
              );
              setRefunds(prev => prev.filter(x => x.id !== r.id));
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  async function rejectRefund(r: RefundItem) {
    if (!online) return;
    Alert.alert(
      L('Rejeter le remboursement ?', 'Reject refund?'),
      `${r.amount} ${r.currency ?? ''}`,
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Rejeter', 'Reject'), style: 'destructive',
          onPress: async () => {
            setBusyId(r.id);
            try {
              await apiPost(
                `/api/tenants/${tenantId}/sav/refunds/${r.id}/reject`,
                { notes: '' },
                { skipAuthRedirect: true, headers: { 'Idempotency-Key': `refund-reject:${r.id}` } },
              );
              setRefunds(prev => prev.filter(x => x.id !== r.id));
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  async function processClaim(c: ClaimItem, decision: 'RESOLVE' | 'REJECT') {
    if (!online) return;
    const label = decision === 'RESOLVE' ? L('Résoudre', 'Resolve') : L('Rejeter', 'Reject');
    Alert.alert(
      `${label} ?`,
      c.description.slice(0, 120),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: label, style: decision === 'REJECT' ? 'destructive' : 'default',
          onPress: async () => {
            setBusyId(c.id);
            try {
              await apiPatch(
                `/api/tenants/${tenantId}/sav/claims/${c.id}/process`,
                { decision },
                { skipAuthRedirect: true, headers: { 'Idempotency-Key': `claim-${decision.toLowerCase()}:${c.id}` } },
              );
              setClaims(prev => prev.filter(x => x.id !== c.id));
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('SAV & remboursements', 'SAV & refunds')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => setTab('refunds')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'refunds' }}
          style={[styles.tab, tab === 'refunds' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
        >
          <Text style={{ color: tab === 'refunds' ? colors.primary : colors.textMuted, fontWeight: '700' }}>
            {L(`Remboursements (${refunds.length})`, `Refunds (${refunds.length})`)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('claims')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'claims' }}
          style={[styles.tab, tab === 'claims' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
        >
          <Text style={{ color: tab === 'claims' ? colors.primary : colors.textMuted, fontWeight: '700' }}>
            {L(`Réclamations (${claims.length})`, `Claims (${claims.length})`)}
          </Text>
        </Pressable>
      </View>

      {loading && refunds.length + claims.length === 0 && (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}

      {tab === 'refunds' && (
        <FlatList
          data={refunds}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? (
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
              {L('Aucun remboursement à traiter.', 'No refund pending.')}
            </Text>
          ) : null}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>
                  {item.amount.toLocaleString(lang)} {item.currency ?? ''}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  {new Date(item.createdAt).toLocaleDateString(lang, { day: '2-digit', month: 'short' })}
                </Text>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }}>
                {item.reason ?? L('Sans motif', 'No reason')}
              </Text>
              {(item.ticketId || item.parcelId) && (
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                  {item.ticketId ? `TK ${item.ticketId.slice(-8)}` : `PR ${(item.parcelId ?? '').slice(-8)}`}
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Pressable
                  onPress={() => rejectRefund(item)}
                  disabled={busyId === item.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.btn,
                    { borderColor: colors.danger, borderWidth: 1, opacity: pressed || busyId === item.id ? 0.6 : 1 },
                  ]}
                >
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>
                    {L('Rejeter', 'Reject')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => approveRefund(item)}
                  disabled={busyId === item.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.btnPrimary,
                    { backgroundColor: colors.primary, opacity: pressed || busyId === item.id ? 0.6 : 1 },
                  ]}
                >
                  <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                    {L('Approuver', 'Approve')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      {tab === 'claims' && (
        <FlatList
          data={claims}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? (
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
              {L('Aucune réclamation ouverte.', 'No open claim.')}
            </Text>
          ) : null}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{item.type}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  {new Date(item.createdAt).toLocaleDateString(lang, { day: '2-digit', month: 'short' })}
                </Text>
              </View>
              {item.reporterName && (
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                  {item.reporterName}
                </Text>
              )}
              <Text style={{ color: colors.text, fontSize: 13, marginTop: 6 }} numberOfLines={3}>
                {item.description}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Pressable
                  onPress={() => processClaim(item, 'REJECT')}
                  disabled={busyId === item.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.btn,
                    { borderColor: colors.danger, borderWidth: 1, opacity: pressed || busyId === item.id ? 0.6 : 1 },
                  ]}
                >
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>
                    {L('Rejeter', 'Reject')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => processClaim(item, 'RESOLVE')}
                  disabled={busyId === item.id}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.btnPrimary,
                    { backgroundColor: colors.success, opacity: pressed || busyId === item.id ? 0.6 : 1 },
                  ]}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>
                    {L('Résoudre', 'Resolve')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:       { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:         { fontSize: 18, fontWeight: '800' },
  banner:     { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  tabs:       { flexDirection: 'row', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  tab:        { paddingVertical: 12, paddingHorizontal: 12, minHeight: 44 },
  card:       { padding: 14, borderRadius: 12, borderWidth: 1 },
  btn:        { flex: 1, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { flex: 2, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
