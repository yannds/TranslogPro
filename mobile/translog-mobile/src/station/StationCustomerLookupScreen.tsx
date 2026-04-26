/**
 * StationCustomerLookupScreen — Recherche client + ses billets/colis pour
 * l'agent de gare en mobilité (lookup support sans devoir basculer sur le web).
 *
 * Flux :
 *   1. Saisie phone OU nom (≥ 3 chars) → liste customers (CRM)
 *   2. Tap sur un customer → liste de ses billets récents (≤ 90j) avec actions
 *      one-tap : annuler (penalty éventuelle), demander remboursement.
 *
 * Endpoints :
 *   - GET /api/tenants/:tid/crm/customers?page&limit  (CRM_READ_TENANT)
 *   - GET /api/tenants/:tid/crm/customers/:userId    (CRM_READ_TENANT)
 *   - POST /api/tenants/:tid/tickets/:id/cancel       (TICKET_CANCEL_AGENCY)
 *   - POST /api/tenants/:tid/tickets/:id/refund-request
 *
 * Sécurité :
 *   - Recherche limite côté client (3 chars min) — la pagination du serveur
 *     fait l'autre half du tri.
 *   - Cancel/refund : confirmation modale + Idempotency-Key déterministe.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert, TextInput,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { useI18n } from '../i18n/useI18n';

interface Customer {
  id:           string;
  userId?:      string | null;
  phoneE164?:   string | null;
  email?:       string | null;
  name?:        string | null;
  ticketsCount?: number;
  parcelsCount?: number;
  totalSpent?:  number;
  segment?:     string | null;
  lastActivityAt?: string | null;
}

interface CustomerDetail extends Customer {
  recentTickets?: Array<{
    id:         string;
    status:     string;
    pricePaid:  number;
    createdAt:  string;
    seatNumber: string | null;
    trip?: {
      departureScheduled: string;
      route?: {
        origin?:      { name: string } | null;
        destination?: { name: string } | null;
      } | null;
    } | null;
  }>;
}

const CANCELLABLE = ['CREATED', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN'];

export function StationCustomerLookupScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [search, setSearch]       = useState('');
  const [list,   setList]         = useState<Customer[]>([]);
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected]   = useState<CustomerDetail | null>(null);
  const [detailLoad, setDetailLoad] = useState(false);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<{ items?: Customer[]; data?: Customer[] } | Customer[]>(
        `/api/tenants/${tenantId}/crm/customers?page=1&limit=50`,
        { skipAuthRedirect: true },
      );
      const items =
        Array.isArray(res) ? res :
        Array.isArray((res as any)?.items) ? (res as any).items :
        Array.isArray((res as any)?.data)  ? (res as any).data  :
        [];
      setList(items as Customer[]);
    } catch {
      setList([]);
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

  async function openDetail(c: Customer) {
    setDetailLoad(true);
    setSelected(c as CustomerDetail);
    try {
      const userKey = c.userId ?? c.id;
      const det = await apiGet<CustomerDetail>(
        `/api/tenants/${tenantId}/crm/customers/${userKey}`,
        { skipAuthRedirect: true },
      );
      if (det) setSelected(det);
    } catch {
      // garde l'objet partiel sélectionné
    } finally {
      setDetailLoad(false);
    }
  }

  function askCancel(ticketId: string, label: string) {
    if (!online) {
      Alert.alert(L('Réseau requis', 'Network required'));
      return;
    }
    Alert.prompt(
      L('Annuler ce billet ?', 'Cancel this ticket?'),
      `${label} — ${L('motif (≥ 3 chars)', 'reason (≥ 3 chars)')}`,
      [
        { text: L('Garder', 'Keep'), style: 'cancel' },
        {
          text: L('Annuler', 'Cancel'),
          style: 'destructive',
          onPress: async (reason?: string) => {
            const r = (reason ?? '').trim();
            if (r.length < 3) {
              Alert.alert(L('Motif requis', 'Reason required'));
              return;
            }
            await mutate(ticketId, 'cancel', { reason: r });
          },
        },
      ],
      'plain-text',
    );
  }

  function askRefund(ticketId: string, label: string) {
    if (!online) {
      Alert.alert(L('Réseau requis', 'Network required'));
      return;
    }
    Alert.alert(
      L('Demander un remboursement ?', 'Request refund?'),
      `${label} — ${L('le service appliquera la pénalité éventuelle.',
        'service will apply applicable penalty.')}`,
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Demander', 'Request'),
          onPress: () => mutate(ticketId, 'refund-request', { reason: 'CLIENT_CANCEL' }),
        },
      ],
    );
  }

  async function mutate(ticketId: string, action: 'cancel' | 'refund-request', body: Record<string, unknown>) {
    setBusyTicketId(ticketId);
    try {
      await apiPost(
        `/api/tenants/${tenantId}/tickets/${ticketId}/${action}`,
        body,
        {
          skipAuthRedirect: true,
          headers: { 'Idempotency-Key': `ticket-${action}:${ticketId}` },
        },
      );
      // refresh detail
      if (selected) await openDetail(selected);
    } catch (e) {
      Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusyTicketId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 3) return list;
    return list.filter(c =>
      (c.name      ?? '').toLowerCase().includes(q) ||
      (c.phoneE164 ?? '').toLowerCase().includes(q) ||
      (c.email     ?? '').toLowerCase().includes(q),
    );
  }, [list, search]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => (selected ? setSelected(null) : nav.goBack())} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]} numberOfLines={1}>
          {selected ? (selected.name ?? L('Détail client', 'Customer detail')) : L('Recherche client', 'Customer lookup')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {/* ── Liste ─────────────────────────────────────────────────────── */}
      {!selected && (
        <>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={L('Nom, téléphone ou email (≥ 3 chars)', 'Name, phone or email (≥ 3 chars)')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={L('Rechercher un client', 'Search a customer')}
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
              ]}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </View>

          {loading && list.length === 0 && (
            <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
          )}

          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
            ListEmptyComponent={!loading ? (
              <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                {search.trim().length < 3
                  ? L('Tapez au moins 3 caractères pour filtrer.', 'Type at least 3 characters to filter.')
                  : L('Aucun client trouvé.', 'No customer found.')}
              </Text>
            ) : null}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => openDetail(item)}
                accessibilityRole="button"
                accessibilityLabel={item.name ?? item.phoneE164 ?? item.email ?? 'customer'}
                style={({ pressed }) => [
                  styles.card,
                  { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                  {item.name ?? L('Sans nom', 'Unnamed')}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {[item.phoneE164, item.email].filter(Boolean).join(' · ') || '—'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                  {typeof item.ticketsCount === 'number' && (
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>🎫 {item.ticketsCount}</Text>
                  )}
                  {typeof item.parcelsCount === 'number' && (
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>📦 {item.parcelsCount}</Text>
                  )}
                  {item.segment && (
                    <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>
                      {item.segment}
                    </Text>
                  )}
                </View>
              </Pressable>
            )}
          />
        </>
      )}

      {/* ── Detail customer + tickets ─────────────────────────────────── */}
      {selected && (
        <FlatList
          data={selected.recentTickets ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          ListHeaderComponent={
            <View style={[styles.detailHeader, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>
                {selected.name ?? L('Sans nom', 'Unnamed')}
              </Text>
              {selected.phoneE164 && (
                <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }} selectable>
                  📞 {selected.phoneE164}
                </Text>
              )}
              {selected.email && (
                <Text style={{ color: colors.textMuted, fontSize: 13 }} selectable>
                  ✉ {selected.email}
                </Text>
              )}
              {(typeof selected.ticketsCount === 'number' || typeof selected.totalSpent === 'number') && (
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>
                  {typeof selected.ticketsCount === 'number' ? `${selected.ticketsCount} ${L('billets', 'tickets')}` : ''}
                  {typeof selected.totalSpent === 'number' ? ` · ${selected.totalSpent.toLocaleString(lang)}` : ''}
                </Text>
              )}
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 8, fontWeight: '600', letterSpacing: 0.4 }}>
                {L('BILLETS RÉCENTS', 'RECENT TICKETS')}
              </Text>
              {detailLoad && <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />}
            </View>
          }
          ListEmptyComponent={!detailLoad ? (
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
              {L('Aucun billet récent.', 'No recent ticket.')}
            </Text>
          ) : null}
          renderItem={({ item }) => {
            const cancellable = CANCELLABLE.includes(item.status);
            return (
              <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                    {item.trip?.route?.origin?.name ?? '—'} → {item.trip?.route?.destination?.name ?? '—'}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700' }}>
                    {item.status}
                  </Text>
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
                  {item.trip?.departureScheduled
                    ? new Date(item.trip.departureScheduled).toLocaleString(lang, {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })
                    : '—'}
                  {item.seatNumber ? ` · ${L('Siège', 'Seat')} ${item.seatNumber}` : ''}
                  {' · '}{item.pricePaid.toLocaleString(lang)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  {cancellable && (
                    <Pressable
                      onPress={() => askCancel(item.id, item.trip?.route?.origin?.name ?? item.id)}
                      disabled={busyTicketId === item.id}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.btnOutline,
                        { borderColor: colors.danger, opacity: pressed || busyTicketId === item.id ? 0.6 : 1 },
                      ]}
                    >
                      <Text style={{ color: colors.danger, fontWeight: '700' }}>
                        {L('Annuler', 'Cancel')}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => askRefund(item.id, item.trip?.route?.origin?.name ?? item.id)}
                    disabled={busyTicketId === item.id}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.btnOutline,
                      { borderColor: colors.warning, opacity: pressed || busyTicketId === item.id ? 0.6 : 1 },
                    ]}
                  >
                    <Text style={{ color: colors.warning, fontWeight: '700' }}>
                      {L('Remboursement', 'Refund')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:      { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:        { fontSize: 18, fontWeight: '800', flex: 1 },
  banner:    { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  input:     { height: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 14 },
  card:      { padding: 14, borderRadius: 12, borderWidth: 1 },
  detailHeader: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  btnOutline:{ flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
