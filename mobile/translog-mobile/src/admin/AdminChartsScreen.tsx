/**
 * AdminChartsScreen — Graphes mobile (natifs, pas de dépendance Chart lib).
 *
 * Sprint A1 : pour rester léger, pas de Victory/Recharts — on dessine des
 * barres en View + flex. Suffisant pour 7/14/30 jours de données.
 *
 * Blocs :
 *   1. Tickets 7 jours — barres verticales (quotidiennes)
 *   2. Revenus 30 jours — total + barres empilées par méthode paiement
 *   3. Top 5 routes (semaine) — liste ordonnée avec barres relatives
 *   4. Incidents ouverts par sévérité — barres horizontales
 *
 * Endpoints :
 *   - GET /analytics/trips?from&to
 *   - GET /analytics/revenue?from&to
 *   - GET /analytics/top-routes?from&to&limit=5
 *   - GET /incidents?status=OPEN  (scope tenant)
 *
 * i18n : FR + EN inline.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, RefreshControl, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

// ── Constantes ──────────────────────────────────────────────────────────────
const DEFAULT_WINDOW_DAYS = 7;
const REVENUE_WINDOW_DAYS = 30;
const TOP_ROUTES_LIMIT    = 5;
const MS_PER_DAY          = 86_400_000;
const BAR_MAX_HEIGHT      = 120;
const BAR_H_MAX_WIDTH_PCT = 100;

interface TicketLite {
  id:         string;
  createdAt:  string;
  status:     string;
  pricePaid?: number;
}

interface RevenueItem {
  type:    string; // TICKET | PARCEL | ...
  _sum:    { amount: number | null };
  _count:  { _all: number };
}

interface TopRoute {
  routeId:  string;
  name:     string;
  tickets:  number;
  revenue:  number;
}

interface Incident {
  id:       string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  status:   string;
  type:     string;
  createdAt:string;
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function AdminChartsScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tickets7d, setTickets7d] = useState<TicketLite[]>([]);
  const [revenue, setRevenue]     = useState<RevenueItem[]>([]);
  const [topRoutes, setTopRoutes] = useState<TopRoute[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const ticketsFrom = isoDaysAgo(DEFAULT_WINDOW_DAYS);
    const revenueFrom = isoDaysAgo(REVENUE_WINDOW_DAYS);
    const to          = endOfToday();
    try {
      const [tk, rv, top, inc] = await Promise.all([
        apiGet<TicketLite[]>(
          `/api/tenants/${tenantId}/tickets?createdSince=${encodeURIComponent(ticketsFrom)}`,
          { skipAuthRedirect: true },
        ),
        apiGet<RevenueItem[]>(
          `/api/tenants/${tenantId}/analytics/revenue?from=${encodeURIComponent(revenueFrom)}&to=${encodeURIComponent(to)}`,
          { skipAuthRedirect: true },
        ),
        apiGet<TopRoute[]>(
          `/api/tenants/${tenantId}/analytics/top-routes?from=${encodeURIComponent(ticketsFrom)}&to=${encodeURIComponent(to)}&limit=${TOP_ROUTES_LIMIT}`,
          { skipAuthRedirect: true },
        ),
        apiGet<Incident[]>(
          `/api/tenants/${tenantId}/incidents?status=OPEN`,
          { skipAuthRedirect: true },
        ),
      ]);
      setTickets7d(tk ?? []);
      setRevenue(rv ?? []);
      setTopRoutes(top ?? []);
      setIncidents(inc ?? []);
    } catch { /* silent */ }
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

  // ── Prépare données dérivées ────────────────────────────────────────────
  const tripsBars = useMemo(() => {
    // Agrège les tickets par jour (local tz), en garantissant 7 jours alignés.
    const counts = new Map<string, number>();
    for (const tk of tickets7d) {
      if (tk.status === 'CANCELLED' || tk.status === 'EXPIRED') continue;
      const iso = tk.createdAt.slice(0, 10);
      counts.set(iso, (counts.get(iso) ?? 0) + 1);
    }
    const days: { date: string; tickets: number }[] = [];
    for (let i = DEFAULT_WINDOW_DAYS - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * MS_PER_DAY);
      d.setHours(0, 0, 0, 0);
      const iso = d.toISOString().slice(0, 10);
      days.push({ date: iso, tickets: counts.get(iso) ?? 0 });
    }
    return days;
  }, [tickets7d]);

  const tripsMax = Math.max(1, ...tripsBars.map(d => d.tickets));
  const revenueTotal = revenue.reduce((s, r) => s + (r._sum.amount ?? 0), 0);
  const revenueMax   = Math.max(1, ...revenue.map(r => r._sum.amount ?? 0));
  const topRoutesMax = Math.max(1, ...topRoutes.map(r => r.tickets));

  const incidentsBySeverity = useMemo(() => {
    const m = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } as Record<string, number>;
    for (const i of incidents) {
      const key = i.severity in m ? i.severity : 'LOW';
      m[key]++;
    }
    return m;
  }, [incidents]);
  const incidentsMax = Math.max(1, ...Object.values(incidentsBySeverity));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Graphes', 'Charts')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
      >
        {loading && <ActivityIndicator color={colors.primary} />}

        {/* ── Tickets 7 jours ───────────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.h2, { color: colors.text }]}>
            {L('Billets — 7 jours', 'Tickets — last 7 days')}
          </Text>
          <View style={styles.chartRow}>
            {tripsBars.map((d) => {
              const h = (d.tickets / tripsMax) * BAR_MAX_HEIGHT;
              return (
                <View key={d.date} style={styles.chartCol}>
                  <Text style={{ color: colors.textMuted, fontSize: 10, marginBottom: 4 }}>
                    {d.tickets}
                  </Text>
                  <View style={{
                    width: '70%',
                    height: Math.max(2, h),
                    backgroundColor: colors.primary,
                    borderTopLeftRadius: 4, borderTopRightRadius: 4,
                  }} />
                  <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4 }}>
                    {new Date(d.date).toLocaleDateString(lang, { weekday: 'short' }).slice(0, 2)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Revenus 30j ──────────────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={[styles.h2, { color: colors.text }]}>
              {L('Revenus — 30 jours', 'Revenue — 30 days')}
            </Text>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>
              {revenueTotal.toLocaleString(lang)}
            </Text>
          </View>
          <View style={{ marginTop: 10, gap: 6 }}>
            {revenue.length === 0 && !loading && (
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {L('Aucun revenu sur la période.', 'No revenue in the window.')}
              </Text>
            )}
            {revenue.map(r => {
              const amount = r._sum.amount ?? 0;
              const pct = Math.round((amount / revenueMax) * BAR_H_MAX_WIDTH_PCT);
              return (
                <View key={r.type}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
                      {r.type} · {r._count._all}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      {amount.toLocaleString(lang)}
                    </Text>
                  </View>
                  <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, marginTop: 2 }}>
                    <View style={{ height: 8, width: `${pct}%`, backgroundColor: colors.primary, borderRadius: 4 }} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Top routes ───────────────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.h2, { color: colors.text }]}>
            {L('Top 5 routes (7j)', 'Top 5 routes (7d)')}
          </Text>
          <View style={{ marginTop: 10, gap: 8 }}>
            {topRoutes.length === 0 && !loading && (
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {L('Aucune route sur la période.', 'No route in the window.')}
              </Text>
            )}
            {topRoutes.map(r => {
              const pct = Math.round((r.tickets / topRoutesMax) * BAR_H_MAX_WIDTH_PCT);
              return (
                <View key={r.routeId}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>
                      {r.tickets}
                    </Text>
                  </View>
                  <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, marginTop: 2 }}>
                    <View style={{ height: 6, width: `${pct}%`, backgroundColor: colors.success, borderRadius: 3 }} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Incidents ouverts ────────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.h2, { color: colors.text }]}>
            {L('Incidents ouverts', 'Open incidents')}
          </Text>
          <View style={{ marginTop: 10, gap: 6 }}>
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(sev => {
              const count = incidentsBySeverity[sev] ?? 0;
              const pct   = Math.round((count / incidentsMax) * BAR_H_MAX_WIDTH_PCT);
              const color =
                sev === 'CRITICAL' ? colors.danger :
                sev === 'HIGH'     ? colors.warning :
                sev === 'MEDIUM'   ? colors.primary :
                colors.textMuted;
              return (
                <View key={sev}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{sev}</Text>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{count}</Text>
                  </View>
                  <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, marginTop: 2 }}>
                    <View style={{ height: 6, width: `${pct}%`, backgroundColor: color, borderRadius: 3 }} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
          {L('Détail complet disponible sur le dashboard web.', 'Full detail available on the web dashboard.')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:   { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:     { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:       { fontSize: 18, fontWeight: '800' },
  h2:       { fontSize: 14, fontWeight: '700' },
  banner:   { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  card:     { padding: 14, borderRadius: 12, borderWidth: 1 },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: BAR_MAX_HEIGHT + 40, marginTop: 10 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
});
