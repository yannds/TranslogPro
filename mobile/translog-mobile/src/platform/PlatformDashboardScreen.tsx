/**
 * PlatformDashboardScreen — Dashboard Super-Admin SaaS (mobile).
 *
 * Affiche les KPIs critiques du SaaS lui-même (pas d'un tenant client) :
 *   - Croissance : total tenants, nouveaux MTD, churn 30j
 *   - Revenus : MRR par devise, paiements échoués (PAST_DUE)
 *   - Activité : DAU, MAU
 *   - Ops : support tickets, incidents, DLQ events
 *
 * Source : GET /api/platform/analytics/summary (~1 KB).
 * Permission requise : data.platform.metrics.read.global.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, StyleSheet, RefreshControl,
} from 'react-native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/useI18n';
import { useOnline } from '../offline/useOnline';
import { Loading } from '../ui/Loading';
import { EmptyState } from '../ui/EmptyState';
import {
  IconAlert, IconRefresh, IconWarn, IconBell, IconUserCircle,
} from '../ui/icons';

interface PlatformSummary {
  tenants: {
    total:         number;
    newThisMonth:  number;
    cancelled30d:  number;
    churnRate30d:  number;
  };
  revenue: {
    mrrByCurrency:   Record<string, number>;
    paymentsFailed:  number;
  };
  activity: {
    dau: number;
    mau: number;
  };
  ops: {
    supportTicketsOpen: number;
    incidentsOpen:      number;
    dlqOpen:            number;
  };
  computedAt: string;
}

export function PlatformDashboardScreen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();

  const lang = (user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [data,    setData]    = useState<PlatformSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const res = await apiGet<PlatformSummary>(
        '/api/platform/analytics/summary',
        { skipAuthRedirect: true },
      );
      setData(res ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function onPullRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: colors.text }]}>TransLog Pro</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {L('Console plateforme', 'Platform console')} · {user?.name ?? user?.email}
          </Text>
        </View>
        <Pressable onPress={logout} accessibilityRole="button" style={styles.iconBtn}>
          <IconUserCircle size={24} color={colors.text} />
        </Pressable>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {loading && !data && <Loading variant="fill" />}

      {error && !data && (
        <EmptyState
          icon={IconWarn}
          title={L('Erreur de chargement', 'Loading error')}
          description={error}
          action={{ label: L('Réessayer', 'Retry'), onPress: refresh }}
        />
      )}

      {data && (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        >
          {/* MRR — vedette */}
          <View style={[styles.heroCard, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
            <Text style={[styles.heroLabel, { color: colors.textMuted }]}>
              {L('REVENUS RÉCURRENTS MENSUELS', 'MONTHLY RECURRING REVENUE')}
            </Text>
            {Object.keys(data.revenue.mrrByCurrency).length === 0 ? (
              <Text style={[styles.heroValue, { color: colors.primary }]}>—</Text>
            ) : (
              Object.entries(data.revenue.mrrByCurrency).map(([cur, amount]) => (
                <Text key={cur} style={[styles.heroValue, { color: colors.primary }]}>
                  {Math.round(amount).toLocaleString(lang)} <Text style={{ fontSize: 14 }}>{cur}</Text>
                </Text>
              ))
            )}
            <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
              {data.revenue.paymentsFailed > 0
                ? L(`⚠️ ${data.revenue.paymentsFailed} paiement(s) en échec`, `⚠️ ${data.revenue.paymentsFailed} payment(s) failed`)
                : L('Tous les paiements à jour', 'All payments up to date')}
            </Text>
          </View>

          {/* Grille KPIs */}
          <View style={styles.grid}>
            <Kpi label={L('Tenants', 'Tenants')}     value={data.tenants.total}        colors={colors} tone={colors.primary} />
            <Kpi label={L('Nouveaux MTD', 'New MTD')} value={data.tenants.newThisMonth} colors={colors} tone={colors.success} />
            <Kpi label={L('Churn 30j', 'Churn 30d')}  value={`${(data.tenants.churnRate30d * 100).toFixed(1)}%`} colors={colors} tone={data.tenants.churnRate30d > 0.05 ? colors.danger : colors.success} alert={data.tenants.churnRate30d > 0.05} />
            <Kpi label={L('DAU', 'DAU')}             value={data.activity.dau}         colors={colors} tone={colors.primary} />
            <Kpi label={L('MAU', 'MAU')}             value={data.activity.mau}         colors={colors} tone={colors.primary} />
            <Kpi label={L('Annulés 30j', 'Cancel 30d')} value={data.tenants.cancelled30d} colors={colors} tone={colors.warning} />
          </View>

          {/* Ops alertes */}
          <View style={[styles.opsCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.opsLabel, { color: colors.textMuted }]}>
              {L('OPÉRATIONS', 'OPERATIONS')}
            </Text>
            <OpsRow
              icon={IconBell}
              label={L('Tickets support ouverts', 'Open support tickets')}
              value={data.ops.supportTicketsOpen}
              alert={data.ops.supportTicketsOpen > 5}
              colors={colors}
            />
            <OpsRow
              icon={IconWarn}
              label={L('Incidents ouverts', 'Open incidents')}
              value={data.ops.incidentsOpen}
              alert={data.ops.incidentsOpen > 0}
              colors={colors}
            />
            <OpsRow
              icon={IconAlert}
              label={L('Événements DLQ non résolus', 'Unresolved DLQ events')}
              value={data.ops.dlqOpen}
              alert={data.ops.dlqOpen > 0}
              colors={colors}
            />
          </View>

          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12 }}>
            {L('Mis à jour', 'Updated')} : {new Date(data.computedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
          </Text>

          <Pressable
            onPress={refresh}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.refreshBtn,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <IconRefresh size={16} color={colors.text} />
            <Text style={{ color: colors.text, fontWeight: '600', marginLeft: 6 }}>
              {L('Rafraîchir', 'Refresh')}
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Kpi({
  label, value, colors, tone, alert,
}: {
  label: string;
  value: number | string;
  colors: ReturnType<typeof useTheme>['colors'];
  tone: string;
  alert?: boolean;
}) {
  return (
    <View style={[
      styles.kpi,
      {
        borderColor:     alert ? tone : colors.border,
        backgroundColor: colors.surface,
        borderLeftWidth: 4,
        borderLeftColor: tone,
      },
    ]}>
      <Text style={[styles.kpiValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {String(value)}
      </Text>
      <Text style={[styles.kpiLabel, { color: colors.textMuted }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function OpsRow({
  icon: Icon, label, value, alert, colors,
}: {
  icon: typeof IconBell;
  label: string;
  value: number;
  alert: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.opsRow, { borderTopColor: colors.border }]}>
      <Icon size={18} color={alert ? colors.danger : colors.textMuted} />
      <Text style={{ color: colors.text, flex: 1, marginLeft: 10 }}>{label}</Text>
      <Text style={{
        color: alert ? colors.danger : colors.text,
        fontWeight: '700',
      }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header:  { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  h1:      { fontSize: 20, fontWeight: '800' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  banner:  { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8 },

  heroCard:  { padding: 16, borderRadius: 14, borderWidth: 1, borderLeftWidth: 4 },
  heroLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600' },
  heroValue: { fontSize: 26, fontWeight: '900', marginTop: 4 },

  grid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi:     { flexBasis: '31%', flexGrow: 1, padding: 10, borderRadius: 10, borderWidth: 1, minHeight: 66 },
  kpiValue:{ fontSize: 18, fontWeight: '800' },
  kpiLabel:{ fontSize: 11, marginTop: 2 },

  opsCard: { padding: 14, borderRadius: 12, borderWidth: 1, marginTop: 4 },
  opsLabel:{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 4 },
  opsRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },

  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderWidth: 1, borderRadius: 999, marginTop: 8,
  },
});
