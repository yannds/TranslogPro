/**
 * AdminFinancesScreen — Hub Finances admin/manager (4 sous-vues).
 *
 * SegmentedControl :
 *   - Temps réel : CA jour/semaine/mois avec filtres agence/gare/route
 *   - Audit caisses : discrepancies + drill par caisse
 *   - Remboursements : refunds en attente d'approbation (déjà sur AdminSav)
 *   - Tickets émis : top routes / top vendeurs / volume
 *
 * Endpoints :
 *   - GET /analytics/finance-realtime?period=&agencyId=&stationId= (créé en L1)
 *   - GET /cashier/discrepancies (existant)
 *   - GET /sav/refunds?status=REQUESTED (existant)
 *   - GET /tickets?from=&to=&status= (existant)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, FlatList, Pressable, StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { useI18n } from '../i18n/useI18n';
import { Loading } from '../ui/Loading';
import { EmptyState } from '../ui/EmptyState';
import { ScreenHeader } from '../ui/ScreenHeader';
import { SegmentedControl } from '../ui/SegmentedControl';
import { AgencyFilter } from '../ui/AgencyFilter';
import { IconRefresh, IconAlert, IconOk } from '../ui/icons';

type FinanceTab = 'realtime' | 'audit' | 'refunds' | 'tickets';
type Period     = 'day' | 'week' | 'month';

interface RealtimeData {
  period:               Period;
  from:                 string;
  to:                   string;
  totalRevenue:         number;
  byPaymentMethod:      Record<string, number>;
  ticketsSold:          number;
  parcelsRegistered:    number;
  refundsAmount:        number;
  computedAt:           string;
}

interface Discrepancy {
  id:           string;
  status:       string;
  initialBalance: number;
  finalBalance: number | null;
  expectedBalance: number | null;
  closedAt:     string | null;
  cashier?: { name?: string | null; email?: string | null } | null;
}

interface RefundItem {
  id:        string;
  amount:    number;
  currency:  string | null;
  reason:    string | null;
  status:    string;
  createdAt: string;
  ticketId?: string | null;
}

interface TicketStat {
  total:           number;
  byPaymentMethod: Record<string, number>;
  byClass:         Record<string, number>;
  topRoutes:       Array<{ route: string; count: number; revenue: number }>;
}

export function AdminFinancesScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const lang = (user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tab,        setTab]        = useState<FinanceTab>('realtime');
  const [period,     setPeriod]     = useState<Period>('day');
  const [agencyId,   setAgencyId]   = useState<string | 'ALL'>('ALL');
  const [realtime,   setRealtime]   = useState<RealtimeData | null>(null);
  const [discrep,    setDiscrep]    = useState<Discrepancy[]>([]);
  const [refunds,    setRefunds]    = useState<RefundItem[]>([]);
  const [ticketStat, setTicketStat] = useState<TicketStat | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId,     setBusyId]     = useState<string | null>(null);

  const loadRealtime = useCallback(async () => {
    if (!tenantId) return;
    try {
      const qs = new URLSearchParams({ period });
      if (agencyId !== 'ALL') qs.set('agencyId', agencyId);
      const res = await apiGet<RealtimeData>(
        `/api/tenants/${tenantId}/analytics/finance-realtime?${qs.toString()}`,
        { skipAuthRedirect: true },
      );
      setRealtime(res ?? null);
    } catch { setRealtime(null); }
  }, [tenantId, period, agencyId]);

  const loadDiscrepancies = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<Discrepancy[]>(
        `/api/tenants/${tenantId}/cashier/discrepancies`,
        { skipAuthRedirect: true },
      );
      setDiscrep(res ?? []);
    } catch { setDiscrep([]); }
  }, [tenantId]);

  const loadRefunds = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<RefundItem[]>(
        `/api/tenants/${tenantId}/sav/refunds?status=REQUESTED`,
        { skipAuthRedirect: true },
      );
      setRefunds(res ?? []);
    } catch { setRefunds([]); }
  }, [tenantId]);

  const loadTicketStats = useCallback(async () => {
    if (!tenantId) return;
    // Réutilise finance-realtime pour le breakdown par méthode + ticketsSold.
    // Pour les top routes, on prendra une vue agrégée future ; pour l'instant
    // on synthétise un state minimal basé sur RealtimeData.
    try {
      const qs = new URLSearchParams({ period });
      if (agencyId !== 'ALL') qs.set('agencyId', agencyId);
      const res = await apiGet<RealtimeData>(
        `/api/tenants/${tenantId}/analytics/finance-realtime?${qs.toString()}`,
        { skipAuthRedirect: true },
      );
      if (res) {
        setTicketStat({
          total:           res.ticketsSold,
          byPaymentMethod: res.byPaymentMethod,
          byClass:         {},
          topRoutes:       [],
        });
      } else {
        setTicketStat(null);
      }
    } catch { setTicketStat(null); }
  }, [tenantId, period, agencyId]);

  useEffect(() => {
    setLoading(true);
    if (tab === 'realtime')      void loadRealtime().finally(() => setLoading(false));
    else if (tab === 'audit')    void loadDiscrepancies().finally(() => setLoading(false));
    else if (tab === 'refunds')  void loadRefunds().finally(() => setLoading(false));
    else                          void loadTicketStats().finally(() => setLoading(false));
  }, [tab, loadRealtime, loadDiscrepancies, loadRefunds, loadTicketStats]);

  async function onPullRefresh() {
    setRefreshing(true);
    if (tab === 'realtime')      await loadRealtime();
    else if (tab === 'audit')    await loadDiscrepancies();
    else if (tab === 'refunds')  await loadRefunds();
    else                          await loadTicketStats();
    setRefreshing(false);
  }

  function approveRefund(r: RefundItem) {
    if (!online) { Alert.alert(L('Réseau requis', 'Network required')); return; }
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
              await apiPatch(
                `/api/tenants/${tenantId}/sav/refunds/${r.id}/approve`,
                {},
                { skipAuthRedirect: true, headers: { 'Idempotency-Key': `refund-approve:${r.id}` } },
              );
              setRefunds(prev => prev.filter(x => x.id !== r.id));
            } catch (e) { Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e)); }
            finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={L('Finances', 'Finances')}
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
          { id: 'realtime', label: L('Temps réel',     'Real-time') },
          { id: 'audit',    label: L('Audit caisses',  'Cash audit'), badge: discrep.length },
          { id: 'refunds',  label: L('Remboursements', 'Refunds'),    badge: refunds.length },
          { id: 'tickets',  label: L('Billets',        'Tickets')     },
        ]}
        selected={tab}
        onChange={(id) => setTab(id as FinanceTab)}
      />

      {/* Filtre agence pour realtime + tickets */}
      {(tab === 'realtime' || tab === 'tickets') && (
        <AgencyFilter selected={agencyId} onChange={setAgencyId} />
      )}

      {/* Sélecteur période pour realtime + tickets */}
      {(tab === 'realtime' || tab === 'tickets') && (
        <View style={[styles.periodRow, { borderBottomColor: colors.border }]}>
          {(['day', 'week', 'month'] as Period[]).map(p => {
            const active = period === p;
            return (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[
                  styles.periodBtn,
                  {
                    backgroundColor: active ? colors.primary : 'transparent',
                    borderColor:     active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: active ? colors.primaryFg : colors.text, fontWeight: '600', fontSize: 12 }}>
                  {p === 'day'   ? L('Jour',    'Day')
                 : p === 'week'  ? L('Semaine', 'Week')
                 :                  L('Mois',   'Month')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {loading && <Loading />}

      {/* ── Temps réel ─────────────────────────────────────────────────── */}
      {tab === 'realtime' && realtime && (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        >
          {/* Hero CA */}
          <View style={[styles.hero, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
            <Text style={[styles.heroLabel, { color: colors.textMuted }]}>
              {L('CHIFFRE D’AFFAIRES', 'REVENUE')} ·{' '}
              {period === 'day' ? L('Aujourd’hui', 'Today')
              : period === 'week' ? L('Cette semaine', 'This week')
              :                       L('Ce mois', 'This month')}
            </Text>
            <Text style={[styles.heroValue, { color: colors.primary }]}>
              {realtime.totalRevenue.toLocaleString(lang)}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              {realtime.ticketsSold} {L('billets', 'tickets')} · {realtime.parcelsRegistered} {L('colis', 'parcels')}
            </Text>
          </View>

          {/* Breakdown paiement */}
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {L('PAR MÉTHODE DE PAIEMENT', 'BY PAYMENT METHOD')}
            </Text>
            {Object.keys(realtime.byPaymentMethod).length === 0 ? (
              <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 8 }}>
                {L('Aucune transaction sur cette période.', 'No transactions in this period.')}
              </Text>
            ) : (
              Object.entries(realtime.byPaymentMethod).map(([method, amount]) => {
                const pct = realtime.totalRevenue > 0 ? amount / realtime.totalRevenue : 0;
                return (
                  <View key={method} style={[styles.payRow, { borderTopColor: colors.border }]}>
                    <Text style={{ color: colors.text, flex: 1, fontWeight: '600' }}>{method}</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {amount.toLocaleString(lang)}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11, marginLeft: 8, minWidth: 40, textAlign: 'right' }}>
                      {(pct * 100).toFixed(0)}%
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {realtime.refundsAmount > 0 && (
            <View style={[styles.alertBox, { borderColor: colors.warning, backgroundColor: colors.warningBg }]}>
              <IconAlert size={18} color={colors.warning} />
              <Text style={{ color: colors.warning, marginLeft: 8, flex: 1 }}>
                {L(`${realtime.refundsAmount.toLocaleString(lang)} remboursés sur la période`,
                    `${realtime.refundsAmount.toLocaleString(lang)} refunded in period`)}
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Audit caisses ──────────────────────────────────────────────── */}
      {tab === 'audit' && (
        <FlatList
          data={discrep}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? (
            <EmptyState
              icon={IconOk}
              title={L('Aucune anomalie', 'No discrepancy')}
              description={L('Toutes les caisses sont équilibrées.', 'All registers are balanced.')}
            />
          ) : null}
          renderItem={({ item }) => {
            const diff = (item.finalBalance ?? 0) - (item.expectedBalance ?? 0);
            return (
              <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>
                    {item.cashier?.name ?? item.cashier?.email ?? '—'}
                  </Text>
                  <Text style={{
                    color: diff < 0 ? colors.danger : colors.warning,
                    fontWeight: '800', fontSize: 16,
                  }}>
                    {diff > 0 ? '+' : ''}{diff.toLocaleString(lang)}
                  </Text>
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                  {item.closedAt ? new Date(item.closedAt).toLocaleString(lang) : '—'}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                  {L('Initial', 'Initial')} : {item.initialBalance.toLocaleString(lang)} ·{' '}
                  {L('Attendu', 'Expected')} : {item.expectedBalance?.toLocaleString(lang) ?? '—'} ·{' '}
                  {L('Réel', 'Actual')} : {item.finalBalance?.toLocaleString(lang) ?? '—'}
                </Text>
              </View>
            );
          }}
        />
      )}

      {/* ── Remboursements ─────────────────────────────────────────────── */}
      {tab === 'refunds' && (
        <FlatList
          data={refunds}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? (
            <EmptyState
              icon={IconOk}
              title={L('Aucun remboursement en attente', 'No pending refund')}
            />
          ) : null}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
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
              <Pressable
                onPress={() => approveRefund(item)}
                disabled={busyId === item.id}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btnPrimary,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed || busyId === item.id ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                  {L('Approuver', 'Approve')}
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}

      {/* ── Tickets stats ──────────────────────────────────────────────── */}
      {tab === 'tickets' && ticketStat && (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        >
          <View style={[styles.hero, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
            <Text style={[styles.heroLabel, { color: colors.textMuted }]}>
              {L('BILLETS ÉMIS', 'TICKETS SOLD')}
            </Text>
            <Text style={[styles.heroValue, { color: colors.primary }]}>
              {ticketStat.total.toLocaleString(lang)}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              {period === 'day' ? L('Aujourd’hui', 'Today')
             : period === 'week' ? L('Cette semaine', 'This week')
             :                       L('Ce mois', 'This month')}
            </Text>
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12 }}>
            {L('Top routes & top vendeurs disponibles sur le portail web.',
                'Top routes & top sellers available on the web portal.')}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  banner:    { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  periodRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 6, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  periodBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },

  hero:      { padding: 16, borderRadius: 14, borderWidth: 1, borderLeftWidth: 4 },
  heroLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  heroValue: { fontSize: 28, fontWeight: '900', marginTop: 4 },

  section:   { padding: 14, borderRadius: 12, borderWidth: 1 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  payRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },

  alertBox:  { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1 },

  card:      { padding: 14, borderRadius: 12, borderWidth: 1 },
  btnPrimary:{ marginTop: 10, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
