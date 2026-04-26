import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, StyleSheet, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

interface TodaySummary {
  today: {
    revenue:            number;
    ticketsSold:        number;
    parcelsRegistered:  number;
    openIncidents:      number;
    openRegisters:      number;
    discrepancyCount:   number;
    activeTrips:        number;
    fillRate:           number;
    fillRateTripsCount: number;
  };
  thresholds?: {
    incident:    number;
    discrepancy: number;
    fillRate:    number;
  };
}

/**
 * Dashboard admin tenant — vue rapide mobile (le pouls du jour).
 *   - 8 KPIs structurés : CA, trajets actifs, billets, colis, taux rempl.,
 *     incidents, caisses ouvertes, anomalies caisse.
 *   - Cartes de navigation : Charts, SAV, Trajets, Incidents, Équipes.
 *   - Pas de configuration tenant lourde (Workflow Studio, IAM, intégrations) —
 *     tout cela reste sur le web.
 */
export function AdminHomeScreen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const navigation = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [data,    setData]    = useState<TodaySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<TodaySummary>(
        `/api/tenants/${tenantId}/analytics/today-summary`,
        { skipAuthRedirect: true },
      );
      setData(res ?? null);
    } catch {
      // fallback : essayer l'endpoint léger /kpis si today-summary échoue (perm,
      // ancien backend). On reconstruit un payload minimal pour la home.
      try {
        const k = await apiGet<{
          ticketsToday:     number;
          parcelsToday:     number;
          openIncidents:    number;
          openRegisters:    number;
          discrepancyCount: number;
        }>(`/api/tenants/${tenantId}/analytics/kpis`, { skipAuthRedirect: true });
        if (k) {
          setData({
            today: {
              revenue:            0,
              ticketsSold:        k.ticketsToday,
              parcelsRegistered:  k.parcelsToday,
              openIncidents:      k.openIncidents,
              openRegisters:      k.openRegisters,
              discrepancyCount:   k.discrepancyCount,
              activeTrips:        0,
              fillRate:           0,
              fillRateTripsCount: 0,
            },
          });
        } else {
          setData(null);
        }
      } catch {
        setData(null);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function onPullRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const today = data?.today;
  const thresholds = data?.thresholds;

  // Calcul des badges d'alerte (vs seuils tenant)
  const incidentAlert    = today && thresholds && today.openIncidents    >= thresholds.incident;
  const discrepancyAlert = today && thresholds && today.discrepancyCount >= thresholds.discrepancy;
  const fillRateAlert    = today && thresholds && today.fillRateTripsCount > 0 && today.fillRate < thresholds.fillRate;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: colors.text }]}>TransLog — Admin</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
            {user?.name ?? user?.email}
          </Text>
        </View>
        <Pressable onPress={logout} accessibilityRole="button" style={styles.logoutBtn}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>⎋</Text>
        </Pressable>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
      >
        {loading && !data && <ActivityIndicator color={colors.primary} />}

        {/* CA jour : KPI vedette pleine largeur */}
        <View style={[styles.heroKpi, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
          <Text style={[styles.heroLabel, { color: colors.textMuted }]}>
            {L('Chiffre d’affaires aujourd’hui', 'Revenue today')}
          </Text>
          <Text style={[styles.heroValue, { color: colors.primary }]}>
            {today ? formatMoney(today.revenue, lang) : '—'}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>
            {today
              ? L(`${today.activeTrips} trajets actifs · ${today.ticketsSold} billets · ${today.parcelsRegistered} colis`,
                  `${today.activeTrips} active trips · ${today.ticketsSold} tickets · ${today.parcelsRegistered} parcels`)
              : ''}
          </Text>
        </View>

        {/* Grille 6 KPIs (3×2) */}
        <View style={styles.grid}>
          <KpiCard
            label={L('Trajets', 'Trips')}
            value={today?.activeTrips ?? '—'}
            color={colors.primary}
            colors={colors}
          />
          <KpiCard
            label={L('Taux rempl.', 'Fill rate')}
            value={today && today.fillRateTripsCount > 0 ? `${Math.round(today.fillRate * 100)}%` : '—'}
            color={fillRateAlert ? colors.warning : colors.success}
            colors={colors}
            alert={fillRateAlert}
          />
          <KpiCard
            label={L('Incidents', 'Incidents')}
            value={today?.openIncidents ?? '—'}
            color={incidentAlert ? colors.danger : colors.warning}
            colors={colors}
            alert={incidentAlert}
          />
          <KpiCard
            label={L('Caisses ouv.', 'Open tills')}
            value={today?.openRegisters ?? '—'}
            color={colors.success}
            colors={colors}
          />
          <KpiCard
            label={L('Billets', 'Tickets')}
            value={today?.ticketsSold ?? '—'}
            color={colors.primary}
            colors={colors}
          />
          <KpiCard
            label={L('Anomalies caisse', 'Cash issues')}
            value={today?.discrepancyCount ?? '—'}
            color={discrepancyAlert ? colors.danger : colors.textMuted}
            colors={colors}
            alert={discrepancyAlert}
          />
        </View>

        {/* Cartes de navigation */}
        <NavCard
          colors={colors}
          icon="📊"
          tone={colors.primary}
          title={L('Graphes & analytics', 'Charts & analytics')}
          subtitle={L('7j billets · revenus 30j · top routes · incidents', '7d tickets · 30d revenue · top routes · incidents')}
          onPress={() => navigation.navigate('AdminCharts')}
        />

        <NavCard
          colors={colors}
          icon="🚦"
          tone={(today?.openIncidents ?? 0) > 0 ? colors.warning : colors.success}
          title={L('Trajets en cours (live)', 'Live trips')}
          subtitle={L('Polling 10s · états retards / à l’heure / suspendus', 'Polling 10s · delayed / on-time / held states')}
          onPress={() => navigation.navigate('AdminLive')}
        />

        <NavCard
          colors={colors}
          icon="🛣"
          tone={colors.primary}
          title={L('Trajets J ± 7', 'Trips J ± 7')}
          subtitle={L('Date picker · suspendre · annuler · retard majeur', 'Date picker · suspend · cancel · major delay')}
          onPress={() => navigation.navigate('Trajets')}
        />

        <NavCard
          colors={colors}
          icon="🚌"
          tone={colors.success}
          title={L('Flotte', 'Fleet')}
          subtitle={L('Actifs · maintenance · sous-utilisés 7j', 'Active · maintenance · underutilized 7d')}
          onPress={() => navigation.navigate('AdminFleet')}
        />

        <NavCard
          colors={colors}
          icon="📅"
          tone={colors.primary}
          title={L('Planning', 'Planning')}
          subtitle={L('Calendrier hebdo · ressources · chauffeurs au repos', 'Weekly calendar · resources · resting drivers')}
          onPress={() => navigation.navigate('AdminPlanning')}
        />

        <NavCard
          colors={colors}
          icon="💰"
          tone={colors.success}
          title={L('Finances', 'Finances')}
          subtitle={L('CA temps réel · audit caisses · remboursements · billets', 'Real-time revenue · cash audit · refunds · tickets')}
          onPress={() => navigation.navigate('AdminFinances')}
        />

        <NavCard
          colors={colors}
          icon="🚨"
          tone={incidentAlert ? colors.danger : colors.warning}
          title={L('Incidents', 'Incidents')}
          subtitle={L('Triage SOS et signalements en cours', 'Triage SOS and live reports')}
          badge={today?.openIncidents}
          onPress={() => navigation.navigate('Incidents')}
        />

        <NavCard
          colors={colors}
          icon="🛠"
          tone={colors.warning}
          title={L('SAV & remboursements', 'SAV & refunds')}
          subtitle={L('Valider/rejeter remboursements et réclamations clients', 'Approve/reject refunds and customer claims')}
          onPress={() => navigation.navigate('AdminSav')}
        />

        <NavCard
          colors={colors}
          icon="👥"
          tone={colors.success}
          title={L('Équipes', 'Teams')}
          subtitle={L('Staff par agence & rôle — suspendre/réactiver', 'Staff by agency & role — suspend/reactivate')}
          onPress={() => navigation.navigate('Équipes')}
        />

        <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 24, fontSize: 11 }}>
          {L('Configuration avancée (workflows, IAM, intégrations) sur le tableau de bord web.',
             'Advanced configuration (workflows, IAM, integrations) on the web dashboard.')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatMoney(amount: number, lang: string): string {
  try {
    return amount.toLocaleString(lang, { maximumFractionDigits: 0 });
  } catch {
    return String(amount);
  }
}

function KpiCard({
  label, value, color, alert, colors,
}: {
  label: string;
  value: number | string;
  color: string;
  alert?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[
      styles.kpi,
      {
        borderColor: alert ? color : colors.border,
        backgroundColor: colors.surface,
        borderLeftWidth: 4,
        borderLeftColor: color,
      },
    ]}>
      <Text style={[styles.kpiValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {String(value)}
      </Text>
      <Text style={[styles.kpiLabel, { color: colors.textMuted }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function NavCard({
  colors, icon, tone, title, subtitle, onPress, badge,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  icon: string;
  tone: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.navCard,
        {
          borderColor: tone,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={{ fontSize: 22 }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.navTitle, { color: tone }]} numberOfLines={1}>{title}</Text>
          {typeof badge === 'number' && badge > 0 && (
            <View style={[styles.navBadge, { backgroundColor: tone }]}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Text style={{ color: tone, fontSize: 18, fontWeight: '700' }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  h1:        { fontSize: 20, fontWeight: '800' },
  logoutBtn: { padding: 12, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:    { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8 },

  heroKpi:   { padding: 16, borderRadius: 14, borderWidth: 1, borderLeftWidth: 4 },
  heroLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600' },
  heroValue: { fontSize: 28, fontWeight: '900', marginTop: 4 },

  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi:       {
    flexBasis:    '31%',
    flexGrow:     1,
    padding:      10,
    borderRadius: 10,
    borderWidth:  1,
    minHeight:    66,
  },
  kpiValue:  { fontSize: 18, fontWeight: '800' },
  kpiLabel:  { fontSize: 11, marginTop: 2 },

  navCard:   {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
    padding:       14,
    borderRadius:  12,
    borderWidth:   1,
  },
  navTitle:  { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  navBadge:  { paddingHorizontal: 6, minWidth: 20, height: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
