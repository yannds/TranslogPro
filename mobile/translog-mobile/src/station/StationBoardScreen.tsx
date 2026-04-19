/**
 * StationBoardScreen — Tableau de bord gare à 2 onglets :
 *   - Annonces actives (lecture seule — publication réservée aux managers)
 *   - Ventes du jour (tickets créés aujourd'hui)
 *
 * Endpoints :
 *   - GET /announcements?activeOnly=true
 *   - GET /tickets?createdSince=<iso-today> (filtre déjà supporté côté back)
 *
 * Perms :
 *   - ANNOUNCEMENT_READ_AGENCY (déjà accordé aux rôles station)
 *   - TICKET_READ_AGENCY       (idem)
 *
 * UX :
 *   - Compteur total + total revenus en devise tenant
 *   - Tri annonces par priority desc + startsAt desc
 *   - Tri tickets par createdAt desc
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

interface Announcement {
  id:        string;
  title:     string;
  message:   string;
  type:      'INFO' | 'DELAY' | 'CANCELLATION' | 'SECURITY' | 'PROMO' | 'CUSTOM' | string;
  priority:  number;
  startsAt:  string;
  endsAt:    string | null;
  isActive:  boolean;
}

interface Ticket {
  id:             string;
  passengerName:  string;
  pricePaid:      number;
  status:         string;
  paymentMethod:  string | null;
  createdAt:      string;
  fareClass?:     string | null;
  tripId?:        string;
}

type Tab = 'announcements' | 'sales';

export function StationBoardScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tab, setTab]                     = useState<Tab>('announcements');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [tickets, setTickets]             = useState<Ticket[]>([]);
  const [loading, setLoading]             = useState(false);
  const [refreshing, setRefreshing]       = useState(false);

  const loadAnnouncements = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<Announcement[]>(
        `/api/tenants/${tenantId}/announcements?activeOnly=true`,
        { skipAuthRedirect: true },
      );
      setAnnouncements(
        [...res].sort((a, b) =>
          b.priority - a.priority ||
          new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
        ),
      );
    } catch { /* offline : snapshot précédent */ }
  }, [tenantId]);

  const loadTickets = useCallback(async () => {
    if (!tenantId) return;
    try {
      // startOfDay en ISO (locale serveur — pas de TZ shift pour dev)
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const res = await apiGet<Ticket[]>(
        `/api/tenants/${tenantId}/tickets?createdSince=${encodeURIComponent(start.toISOString())}`,
        { skipAuthRedirect: true },
      );
      setTickets([...res].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ));
    } catch { /* offline */ }
  }, [tenantId]);

  const load = useCallback(async () => {
    await Promise.all([loadAnnouncements(), loadTickets()]);
  }, [loadAnnouncements, loadTickets]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const salesTotal = useMemo(
    () => tickets.filter(t => t.status !== 'CANCELLED' && t.status !== 'EXPIRED')
      .reduce((sum, t) => sum + (t.pricePaid ?? 0), 0),
    [tickets],
  );

  const currency = tickets[0] ? ((tickets[0] as unknown) as Record<string, unknown>).currency as string | undefined : undefined;
  const currencyDisplay = currency ?? ''; // backend encodes currency at ticket level (optionnel)

  function announcementTypeStyle(type: string) {
    switch (type) {
      case 'DELAY':        return { bg: colors.warningBg, fg: colors.warning };
      case 'CANCELLATION': return { bg: colors.dangerBg,  fg: colors.danger };
      case 'SECURITY':     return { bg: colors.dangerBg,  fg: colors.danger };
      case 'PROMO':        return { bg: colors.successBg, fg: colors.success };
      default:             return { bg: colors.surface,   fg: colors.primary };
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Gare — Info', 'Station — Info')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => setTab('announcements')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'announcements' }}
          style={[
            styles.tab,
            tab === 'announcements' && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
          ]}
        >
          <Text style={{ color: tab === 'announcements' ? colors.primary : colors.textMuted, fontWeight: '700' }}>
            {L(`Annonces (${announcements.length})`, `Announcements (${announcements.length})`)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('sales')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'sales' }}
          style={[
            styles.tab,
            tab === 'sales' && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
          ]}
        >
          <Text style={{ color: tab === 'sales' ? colors.primary : colors.textMuted, fontWeight: '700' }}>
            {L(`Ventes (${tickets.length})`, `Sales (${tickets.length})`)}
          </Text>
        </Pressable>
      </View>

      {loading && announcements.length + tickets.length === 0 && (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}

      {tab === 'announcements' && (
        <FlatList
          data={announcements}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={
            !loading ? (
              <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                {L('Aucune annonce active.', 'No active announcement.')}
              </Text>
            ) : null
          }
          renderItem={({ item }) => {
            const st = announcementTypeStyle(item.type);
            return (
              <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={{ color: st.fg, fontSize: 10, fontWeight: '800' }}>{item.type}</Text>
                  </View>
                  {item.priority > 0 && (
                    <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '700' }}>
                      P{item.priority}
                    </Text>
                  )}
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginLeft: 'auto' }}>
                    {new Date(item.startsAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <Text style={{ color: colors.text, fontWeight: '700', marginTop: 6 }}>
                  {item.title}
                </Text>
                <Text style={{ color: colors.text, fontSize: 13, marginTop: 4 }}>
                  {item.message}
                </Text>
                {item.endsAt && (
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                    {L('Se termine à', 'Ends at')} {new Date(item.endsAt).toLocaleString(lang, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                  </Text>
                )}
              </View>
            );
          }}
        />
      )}

      {tab === 'sales' && (
        <FlatList
          data={tickets}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListHeaderComponent={
            <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {L('Total du jour', 'Daily total')}
              </Text>
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 20 }}>
                {salesTotal.toLocaleString(lang)} {currencyDisplay}
              </Text>
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                {L('Aucune vente aujourd\'hui.', 'No sale today.')}
              </Text>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                    {item.passengerName}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    {new Date(item.createdAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                    {item.paymentMethod ? ` · ${item.paymentMethod}` : ''}
                    {item.fareClass ? ` · ${item.fareClass}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.primary, fontWeight: '800' }}>
                    {item.pricePaid.toLocaleString(lang)}
                  </Text>
                  <Text style={{
                    color:
                      item.status === 'CONFIRMED' ? colors.success :
                      item.status === 'CANCELLED' ? colors.danger  :
                      colors.textMuted,
                    fontSize: 10, fontWeight: '700',
                  }}>
                    {item.status}
                  </Text>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:  { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:    { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:      { fontSize: 18, fontWeight: '800' },
  banner:  { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  tabs:    { flexDirection: 'row', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  tab:     { paddingVertical: 12, paddingHorizontal: 12, minHeight: 44 },
  card:    { padding: 12, borderRadius: 10, borderWidth: 1 },
  badge:   { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  summary: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
});
