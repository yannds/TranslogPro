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

interface Kpis {
  ticketsToday?:     number;
  parcelsToday?:     number;
  openIncidents?:    number;
  openRegisters?:    number;
  discrepancyCount?: number;
}

/**
 * Dashboard admin tenant — vue rapide mobile.
 *   - KPIs du jour (endpoint `/analytics/kpis` si dispo, sinon zéros).
 *   - Liste des clôtures DISCREPANCY récentes (visibilité audit caisse).
 */
export function AdminHomeScreen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const navigation = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const [kpis,    setKpis]    = useState<Kpis>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    // Best-effort : le backend peut ne pas avoir l'endpoint analytics/kpis ;
    // on reste silencieux en cas d'échec pour ne pas bloquer l'écran.
    try {
      const k = await apiGet<Kpis>(
        `/api/tenants/${tenantId}/analytics/kpis`,
        { skipAuthRedirect: true },
      );
      setKpis(k ?? {});
    } catch {
      setKpis({});
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.h1, { color: colors.text }]}>TransLog — Admin</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{user?.name ?? user?.email}</Text>
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
        {loading && <ActivityIndicator color={colors.primary} />}

        <View style={styles.grid}>
          <KpiCard label="Billets (j)"    value={kpis.ticketsToday ?? '—'}    color={colors.primary}   fg={colors.primaryFg} surface={colors.surface} border={colors.border} text={colors.text} muted={colors.textMuted} />
          <KpiCard label="Colis (j)"      value={kpis.parcelsToday ?? '—'}    color={colors.primary}   fg={colors.primaryFg} surface={colors.surface} border={colors.border} text={colors.text} muted={colors.textMuted} />
          <KpiCard label="Incidents ouv." value={kpis.openIncidents ?? '—'}   color={colors.warning}   fg={'white'}          surface={colors.surface} border={colors.border} text={colors.text} muted={colors.textMuted} />
          <KpiCard label="Caisses ouv."   value={kpis.openRegisters ?? '—'}   color={colors.success}   fg={'white'}          surface={colors.surface} border={colors.border} text={colors.text} muted={colors.textMuted} />
        </View>

        <Pressable
          onPress={() => navigation.navigate('AdminCharts')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.card,
            { borderColor: colors.primary, backgroundColor: colors.surface, marginTop: 8, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.h2, { color: colors.primary }]}>📊 Graphes détaillés ›</Text>
          <Text style={{ color: colors.textMuted, marginTop: 2, fontSize: 12 }}>
            Tickets 7j · Revenus 30j · Top routes · Incidents par sévérité
          </Text>
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('AdminSav')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.card,
            { borderColor: colors.warning, backgroundColor: colors.surface, marginTop: 8, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.h2, { color: colors.warning }]}>🛠  SAV & remboursements ›</Text>
          <Text style={{ color: colors.textMuted, marginTop: 2, fontSize: 12 }}>
            Valider/rejeter remboursements et réclamations clients.
          </Text>
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('AdminTeams')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.card,
            { borderColor: colors.success, backgroundColor: colors.surface, marginTop: 8, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.h2, { color: colors.success }]}>👥  Équipes ›</Text>
          <Text style={{ color: colors.textMuted, marginTop: 2, fontSize: 12 }}>
            Staff par agence & rôle — suspendre/réactiver.
          </Text>
        </Pressable>

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface, marginTop: 8 }]}>
          <Text style={[styles.h2, { color: colors.text }]}>Audit caisses</Text>
          <Text style={{ color: colors.textMuted, marginTop: 2 }}>
            {typeof kpis.discrepancyCount === 'number'
              ? `${kpis.discrepancyCount} clôture(s) avec écart sur les 30 derniers jours.`
              : 'Utilisez le dashboard web pour le détail (/admin/reports).'}
          </Text>
        </View>

        <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 24, fontSize: 12 }}>
          Le rapport complet (graphes, CSV, filtres) reste sur le web — cette vue donne le pouls du jour.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function KpiCard({
  label, value, color, fg, surface, border, text, muted,
}: { label: string; value: number | string; color: string; fg: string; surface: string; border: string; text: string; muted: string }) {
  return (
    <View style={[styles.kpi, { borderColor: border, backgroundColor: surface }]}>
      <View style={[styles.dot, { backgroundColor: color }]}>
        <Text style={{ color: fg, fontWeight: '700', fontSize: 10 }}>●</Text>
      </View>
      <Text style={[styles.kpiValue, { color: text }]}>{String(value)}</Text>
      <Text style={[styles.kpiLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  h1:        { fontSize: 20, fontWeight: '800' },
  h2:        { fontSize: 15, fontWeight: '700' },
  logoutBtn: { padding: 12, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:    { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8 },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi:       { flexBasis: '48%', padding: 14, borderRadius: 12, borderWidth: 1 },
  dot:       { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  kpiValue:  { fontSize: 22, fontWeight: '800' },
  kpiLabel:  { fontSize: 12 },
  card:      { padding: 14, borderRadius: 12, borderWidth: 1 },
});
