/**
 * AdminFleetScreen — Vue flotte mobile pour l'admin tenant.
 *
 * Source : GET /api/tenants/:tid/analytics/fleet-summary (existant L1).
 * Retourne : { total, byStatus: { active, maintenance, offline },
 *              underutilized: [{ busId, plate, util7d, tripCount7d }],
 *              underutilizedThreshold }
 *
 * Affiche :
 *   - 3 KPI cards (actifs / maintenance / hors service)
 *   - Top 5 véhicules sous-utilisés sur 7j
 *
 * Pour le détail d'un bus + photos, drill via tap → AdminFleetDetail (futur,
 * v1 affiche un Alert avec le plate / id pour copier-coller dans l'admin web).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, StyleSheet, RefreshControl, Alert,
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
import { IconTruck, IconRefresh, IconWarn, IconOk, IconAlert } from '../ui/icons';

interface FleetSummary {
  total: number;
  byStatus: {
    active:      number;
    maintenance: number;
    offline:     number;
  };
  underutilized: Array<{
    busId:         string;
    plateNumber:   string | null;
    model:         string | null;
    tripCount7d:   number;
    utilization7d: number;
  }>;
  underutilizedThreshold: number;
}

export function AdminFleetScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const lang = (user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [data, setData] = useState<FleetSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      setError(null);
      const res = await apiGet<FleetSummary>(
        `/api/tenants/${tenantId}/analytics/fleet-summary`,
        { skipAuthRedirect: true },
      );
      setData(res ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      <ScreenHeader
        title={L('Flotte', 'Fleet')}
        subtitle={data ? `${data.total} ${L('véhicules', 'vehicles')}` : undefined}
        onBack={() => nav.goBack()}
        actions={[{ icon: IconRefresh, label: L('Rafraîchir', 'Refresh'), onPress: refresh }]}
      />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {loading && !data && <Loading variant="fill" />}

      {error && !data && (
        <EmptyState
          icon={IconWarn}
          title={L('Erreur', 'Error')}
          description={error}
          action={{ label: L('Réessayer', 'Retry'), onPress: refresh }}
        />
      )}

      {data && (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        >
          {/* 3 KPI status */}
          <View style={styles.kpiGrid}>
            <KpiBlock icon={IconOk}    label={L('Actifs', 'Active')}            value={data.byStatus.active}      tone={colors.success} colors={colors} />
            <KpiBlock icon={IconAlert} label={L('Maintenance', 'Maintenance')} value={data.byStatus.maintenance} tone={colors.warning} colors={colors} alert={data.byStatus.maintenance > 0} />
            <KpiBlock icon={IconWarn}  label={L('Hors service', 'Offline')}    value={data.byStatus.offline}     tone={colors.danger}  colors={colors} alert={data.byStatus.offline > 0} />
          </View>

          {/* Sous-utilisés */}
          <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              {L('SOUS-UTILISÉS (7 jours)', 'UNDERUTILIZED (7 days)')}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 8 }}>
              {L(`Seuil : ${(data.underutilizedThreshold * 100).toFixed(0)}% de remplissage moyen`,
                  `Threshold: ${(data.underutilizedThreshold * 100).toFixed(0)}% avg fill`)}
            </Text>

            {data.underutilized.length === 0 ? (
              <Text style={{ color: colors.success, fontSize: 13, fontWeight: '600' }}>
                {L('✓ Aucun véhicule sous-utilisé.', '✓ No underutilized vehicle.')}
              </Text>
            ) : (
              data.underutilized.map((b) => (
                <Pressable
                  key={b.busId}
                  onPress={() => Alert.alert(
                    b.plateNumber ?? L('Sans plaque', 'No plate'),
                    `${b.model ?? ''}\n${b.tripCount7d} ${L('trajets / 7j', 'trips / 7d')}\n${(b.utilization7d * 100).toFixed(1)}% ${L('rempl. moy.', 'avg fill')}`,
                  )}
                  accessibilityRole="button"
                  accessibilityLabel={b.plateNumber ?? b.busId}
                  style={({ pressed }) => [
                    styles.busRow,
                    { borderTopColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <IconTruck size={18} color={colors.warning} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                      {b.plateNumber ?? L('Sans plaque', 'No plate')}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11 }} numberOfLines={1}>
                      {b.model ?? '—'} · {b.tripCount7d} {L('trajets', 'trips')}
                    </Text>
                  </View>
                  <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 14 }}>
                    {(b.utilization7d * 100).toFixed(0)}%
                  </Text>
                </Pressable>
              ))
            )}
          </View>

          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
            {L('Détail bus, photos et maintenance planifiée sur le portail web.',
                'Bus details, photos and scheduled maintenance on the web portal.')}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function KpiBlock({
  icon: Icon, label, value, tone, alert, colors,
}: {
  icon: typeof IconOk;
  label: string;
  value: number;
  tone: string;
  alert?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
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
      <Icon size={20} color={tone} />
      <Text style={[styles.kpiValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.kpiLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner:  { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  kpiGrid: { flexDirection: 'row', gap: 8 },
  kpi:     { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: 'flex-start', gap: 4 },
  kpiValue:{ fontSize: 22, fontWeight: '800' },
  kpiLabel:{ fontSize: 11 },

  section: { padding: 14, borderRadius: 12, borderWidth: 1 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 4 },
  busRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
