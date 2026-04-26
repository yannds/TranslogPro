/**
 * CashierMyStatsScreen — Performance perso du caissier (jour/sem/mois).
 *
 * Utilise GET /api/tenants/:tid/cashier/registers/:id/transactions
 * (existant) sur la caisse ouverte courante + agrégation client-side.
 *
 * v1 : metrics du jour seulement (caisse ouverte). Les historiques par
 * période semaine/mois nécessiteront un endpoint /cashier/me/stats à
 * créer si besoin.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, StyleSheet, RefreshControl,
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
import { IconRefresh, TabIconCash as IconCash, IconTrendUp, IconAlert } from '../ui/icons';

interface Register {
  id:             string;
  initialBalance: number;
  openedAt:       string;
  status:         string;
}

interface Transaction {
  id:            string;
  type:          string;
  amount:        number;
  paymentMethod: string;
  createdAt:     string;
}

export function CashierMyStatsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const lang = (user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [register,   setRegister]   = useState<Register | null>(null);
  const [tx,         setTx]         = useState<Transaction[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const reg = await apiGet<Register>(
        `/api/tenants/${tenantId}/cashier/registers/me/open`,
        { skipAuthRedirect: true },
      );
      setRegister(reg ?? null);
      if (reg?.id) {
        const txs = await apiGet<Transaction[]>(
          `/api/tenants/${tenantId}/cashier/registers/${reg.id}/transactions?limit=200`,
          { skipAuthRedirect: true },
        );
        setTx(txs ?? []);
      } else {
        setTx([]);
      }
    } catch {
      // silencieux
    }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Agrégations
  const stats = useMemo(() => {
    if (!register) return null;
    const sales       = tx.filter(t => t.type === 'TICKET_SALE' || t.type === 'PARCEL_REGISTRATION' || t.type === 'PAYMENT');
    const refunds     = tx.filter(t => t.type === 'REFUND');
    const totalSales  = sales.reduce((sum, t) => sum + (t.amount ?? 0), 0);
    const totalRefund = refunds.reduce((sum, t) => sum + Math.abs(t.amount ?? 0), 0);
    const byMethod: Record<string, number> = {};
    for (const t of sales) {
      byMethod[t.paymentMethod] = (byMethod[t.paymentMethod] ?? 0) + (t.amount ?? 0);
    }
    return {
      totalSales,
      totalRefund,
      txCount:        sales.length,
      refundCount:    refunds.length,
      byMethod,
      durationHours:  Math.round((Date.now() - new Date(register.openedAt).getTime()) / (60 * 60_000)),
    };
  }, [tx, register]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={L('Mes performances', 'My performance')}
        onBack={() => nav.goBack()}
        actions={[{ icon: IconRefresh, label: L('Rafraîchir', 'Refresh'), onPress: load }]}
      />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {loading && !register && <Loading variant="fill" />}

      {!loading && !register && (
        <EmptyState
          icon={IconCash}
          title={L('Aucune caisse ouverte', 'No open register')}
          description={L('Ouvrez votre caisse depuis l’onglet Caisse pour voir vos statistiques.',
                         'Open your register from the Caisse tab to see your stats.')}
        />
      )}

      {register && stats && (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        >
          {/* Hero CA généré */}
          <View style={[styles.hero, { borderColor: colors.success, backgroundColor: colors.surface }]}>
            <Text style={[styles.heroLabel, { color: colors.textMuted }]}>
              {L('CHIFFRE D’AFFAIRES GÉNÉRÉ', 'REVENUE GENERATED')}
            </Text>
            <Text style={[styles.heroValue, { color: colors.success }]}>
              {stats.totalSales.toLocaleString(lang)}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              {stats.txCount} {L('transactions', 'transactions')} · {L('caisse ouverte', 'register open')} {stats.durationHours}h
            </Text>
          </View>

          {/* Refunds box */}
          {stats.refundCount > 0 && (
            <View style={[styles.alertBox, { borderColor: colors.warning, backgroundColor: colors.warningBg }]}>
              <IconAlert size={18} color={colors.warning} />
              <Text style={{ color: colors.warning, marginLeft: 8, flex: 1 }}>
                {L(`${stats.refundCount} remboursement(s) traité(s) — ${stats.totalRefund.toLocaleString(lang)}`,
                    `${stats.refundCount} refund(s) processed — ${stats.totalRefund.toLocaleString(lang)}`)}
              </Text>
            </View>
          )}

          {/* Breakdown par méthode */}
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {L('PAR MÉTHODE DE PAIEMENT', 'BY PAYMENT METHOD')}
            </Text>
            {Object.keys(stats.byMethod).length === 0 ? (
              <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 8 }}>
                {L('Pas encore de transaction.', 'No transaction yet.')}
              </Text>
            ) : (
              Object.entries(stats.byMethod).map(([method, amount]) => {
                const pct = stats.totalSales > 0 ? amount / stats.totalSales : 0;
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

          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
            <IconTrendUp size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {L('Vitesse moyenne', 'Average speed')}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                {stats.durationHours > 0
                  ? L(`${(stats.txCount / stats.durationHours).toFixed(1)} transactions / heure`,
                      `${(stats.txCount / stats.durationHours).toFixed(1)} transactions / hour`)
                  : L('—', '—')}
              </Text>
            </View>
          </View>

          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
            {L('Les statistiques semaine/mois (historique) seront disponibles prochainement.',
                'Week/month historical stats will be available soon.')}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  banner:    { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  hero:      { padding: 16, borderRadius: 14, borderWidth: 1, borderLeftWidth: 4 },
  heroLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  heroValue: { fontSize: 28, fontWeight: '900', marginTop: 4 },
  section:   { padding: 14, borderRadius: 12, borderWidth: 1 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  payRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  alertBox:  { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1 },
});
