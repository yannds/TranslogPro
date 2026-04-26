/**
 * CashierTicketsScreen — Liste des billets récents émis par l'agence
 * et action one-tap d'annulation.
 *
 * Cas d'usage :
 *   - Vente erronée (mauvais siège, mauvaise date) → annuler tout de suite,
 *     remboursement instantané ou refund-request (selon politique tenant).
 *   - Demande client à la sortie de la file → cancel rapide, le caissier
 *     refait une vente dans le bon trajet.
 *
 * Endpoints :
 *   - GET  /api/tenants/:tid/tickets?status=CONFIRMED  (TICKET_READ_AGENCY)
 *   - POST /api/tenants/:tid/tickets/:id/cancel        (TICKET_CANCEL_AGENCY)
 *
 * Sécurité :
 *   - Confirmation obligatoire (Alert.prompt avec motif ≥ 3 chars).
 *   - Idempotency-Key déterministe ticketId+action (anti-double-clic).
 *   - Refus offline (cancel ne passe pas en outbox — politique métier).
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

interface Ticket {
  id:            string;
  passengerName: string;
  passengerPhone: string | null;
  seatNumber:    string | null;
  fareClass:     string;
  pricePaid:     number;
  status:        string;
  createdAt:     string;
  trip?: {
    departureScheduled: string;
    route?: {
      origin?:      { name: string } | null;
      destination?: { name: string } | null;
    } | null;
  } | null;
}

const CANCELLABLE_STATUSES = ['CREATED', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN'];

export function CashierTicketsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [items, setItems]     = useState<Ticket[]>([]);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      // Sans tripId, le serveur retourne les billets de l'agence (scope agency
      // forcé pour CASHIER). On filtre côté client par status cancellable.
      const res = await apiGet<Ticket[]>(
        `/api/tenants/${tenantId}/tickets?status=CONFIRMED`,
        { skipAuthRedirect: true },
      );
      setItems(res ?? []);
    } catch {
      setItems([]);
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

  function askCancel(tk: Ticket) {
    if (!online) {
      Alert.alert(L('Réseau requis', 'Network required'),
        L('L’annulation ne passe pas en file d’attente.', 'Cancel cannot be queued.'));
      return;
    }
    Alert.prompt(
      L('Annuler ce billet ?', 'Cancel this ticket?'),
      L(`${tk.passengerName} · ${tk.pricePaid} — saisissez le motif (≥ 3 chars).`,
        `${tk.passengerName} · ${tk.pricePaid} — enter reason (≥ 3 chars).`),
      [
        { text: L('Garder', 'Keep'), style: 'cancel' },
        {
          text: L('Annuler le billet', 'Cancel ticket'),
          style: 'destructive',
          onPress: async (reason?: string) => {
            const r = (reason ?? '').trim();
            if (r.length < 3) {
              Alert.alert(L('Motif requis', 'Reason required'));
              return;
            }
            setBusyId(tk.id);
            try {
              await apiPost(
                `/api/tenants/${tenantId}/tickets/${tk.id}/cancel`,
                { reason: r },
                {
                  skipAuthRedirect: true,
                  headers: { 'Idempotency-Key': `ticket-cancel:${tk.id}` },
                },
              );
              setItems(prev => prev.filter(x => x.id !== tk.id));
            } catch (e) {
              Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
      'plain-text',
    );
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter(tk => CANCELLABLE_STATUSES.includes(tk.status))
      .filter(tk => {
        if (!q) return true;
        return (
          tk.passengerName.toLowerCase().includes(q) ||
          (tk.passengerPhone ?? '').toLowerCase().includes(q) ||
          (tk.seatNumber ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [items, search]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Billets émis', 'Issued tickets')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={L('Rechercher (nom, téléphone, siège)', 'Search (name, phone, seat)')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={L('Rechercher un billet', 'Search a ticket')}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      {loading && items.length === 0 && (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}

      <FlatList
        data={visible}
        keyExtractor={(tk) => tk.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        ListEmptyComponent={!loading ? (
          <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
            {L('Aucun billet annulable.', 'No cancellable ticket.')}
          </Text>
        ) : null}
        renderItem={({ item }) => (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                {item.passengerName}
              </Text>
              <Text style={{ color: colors.primary, fontWeight: '800' }}>
                {item.pricePaid.toLocaleString(lang)}
              </Text>
            </View>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
              {item.trip?.route?.origin?.name ?? '—'} → {item.trip?.route?.destination?.name ?? '—'}
              {item.seatNumber ? ` · ${L('Siège', 'Seat')} ${item.seatNumber}` : ''}
              {' · '}{item.fareClass}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
              {item.trip?.departureScheduled
                ? new Date(item.trip.departureScheduled).toLocaleString(lang, {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  })
                : '—'}
            </Text>
            <Pressable
              onPress={() => askCancel(item)}
              disabled={busyId === item.id}
              accessibilityRole="button"
              accessibilityLabel={L(`Annuler ${item.passengerName}`, `Cancel ${item.passengerName}`)}
              style={({ pressed }) => [
                styles.cancelBtn,
                {
                  borderColor: colors.danger,
                  opacity: pressed || busyId === item.id ? 0.6 : 1,
                },
              ]}
            >
              <Text style={{ color: colors.danger, fontWeight: '700' }}>
                {busyId === item.id ? L('Annulation…', 'Cancelling…') : L('Annuler le billet', 'Cancel ticket')}
              </Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:      { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:        { fontSize: 18, fontWeight: '800' },
  banner:    { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  input:     {
    height:        44,
    borderWidth:   1,
    borderRadius:  10,
    paddingHorizontal: 12,
    fontSize:      14,
  },
  card:      { padding: 14, borderRadius: 12, borderWidth: 1 },
  cancelBtn: {
    marginTop:     10,
    minHeight:     44,
    borderRadius:  8,
    borderWidth:   1,
    alignItems:    'center',
    justifyContent:'center',
  },
});
