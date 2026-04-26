/**
 * CustomerMyItemsScreen — Onglets "Mes billets" + "Mes colis" pour le client.
 *
 * Endpoints authentifiés :
 *   - GET /tickets/my   (TICKET_READ_OWN)
 *   - GET /parcels/my   (PARCEL_READ_OWN)
 *
 * Tickets : affiche QR + statut + voyage ; tap ouvre la modale QR plein écran.
 * Colis   : affiche tracking code + statut + timeline simplifiée.
 *
 * Hors-ligne : snapshot — QR lisible en cache (les QR sont signés HMAC côté
 * serveur ; ils ne changent pas tant que le ticket est CONFIRMED). Aucune
 * mutation sur cet écran.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

type Tab = 'tickets' | 'parcels';

// Affichage du token signé : on l'expose en intégralité pour que l'agent
// puisse le saisir en fallback manuel dans QuaiHome (sinon HMAC invalide).
// Une future itération (Chantier-Expo53) ajoutera le rendu QR via
// `react-native-qrcode-svg` (réutilisera react-native-svg déjà installé).

interface Ticket {
  id:             string;
  passengerName:  string;
  seatNumber:     string | null;
  status:         string;
  qrCode:         string | null;
  pricePaid:      number;
  createdAt:      string;
  trip?: {
    departureScheduled: string;
    route?: { origin?: { name: string }; destination?: { name: string } };
  };
}

interface Parcel {
  id:           string;
  trackingCode: string;
  status:       string;
  description:  string | null;
  createdAt:    string;
  currentLocation?: string | null;
  recipient?: {
    name:  string | null;
    phone: string | null;
  };
}

export function CustomerMyItemsScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tab, setTab]               = useState<Tab>('tickets');
  const [tickets, setTickets]       = useState<Ticket[]>([]);
  const [parcels, setParcels]       = useState<Parcel[]>([]);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [qrOpen, setQrOpen]         = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [tk, pc] = await Promise.all([
        apiGet<Ticket[]>(`/api/tenants/${tenantId}/tickets/my`, { skipAuthRedirect: true }),
        apiGet<Parcel[]>(`/api/tenants/${tenantId}/parcels/my`, { skipAuthRedirect: true }),
      ]);
      setTickets(tk ?? []);
      setParcels(pc ?? []);
    } catch { /* offline : snapshot précédent */ }
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

  function ticketStatusColor(s: string) {
    if (s === 'CONFIRMED' || s === 'BOARDED' || s === 'CHECKED_IN') return colors.success;
    if (s === 'CANCELLED' || s === 'EXPIRED') return colors.danger;
    return colors.textMuted;
  }

  function parcelStatusColor(s: string) {
    if (s === 'DELIVERED') return colors.success;
    if (s === 'CANCELLED' || s === 'RETURNED') return colors.danger;
    return colors.primary;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Mes documents', 'My items')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => setTab('tickets')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'tickets' }}
          style={[styles.tab, tab === 'tickets' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
        >
          <Text style={{ color: tab === 'tickets' ? colors.primary : colors.textMuted, fontWeight: '700' }}>
            {L(`Billets (${tickets.length})`, `Tickets (${tickets.length})`)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('parcels')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'parcels' }}
          style={[styles.tab, tab === 'parcels' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
        >
          <Text style={{ color: tab === 'parcels' ? colors.primary : colors.textMuted, fontWeight: '700' }}>
            {L(`Colis (${parcels.length})`, `Parcels (${parcels.length})`)}
          </Text>
        </Pressable>
      </View>

      {loading && tickets.length + parcels.length === 0 && (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}

      {tab === 'tickets' && (
        <FlatList
          data={tickets}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? (
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
              {L('Aucun billet pour le moment.', 'No ticket yet.')}
            </Text>
          ) : null}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => item.qrCode && setQrOpen(item)}
              accessibilityRole="button"
              style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {item.trip?.route?.origin?.name ?? '?'} → {item.trip?.route?.destination?.name ?? '?'}
                </Text>
                <Text style={{ color: ticketStatusColor(item.status), fontWeight: '800', fontSize: 11 }}>
                  {item.status}
                </Text>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
                {item.trip?.departureScheduled
                  ? new Date(item.trip.departureScheduled).toLocaleString(lang, {
                      weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })
                  : '—'}
                {item.seatNumber ? ` · ${L('Siège', 'Seat')} ${item.seatNumber}` : ''}
              </Text>
              {item.qrCode && (
                <Text style={{ color: colors.primary, fontSize: 12, marginTop: 6, fontWeight: '700' }}>
                  📱 {L('Afficher QR', 'Show QR')} ›
                </Text>
              )}
            </Pressable>
          )}
        />
      )}

      {tab === 'parcels' && (
        <FlatList
          data={parcels}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? (
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
              {L('Aucun colis pour le moment.', 'No parcel yet.')}
            </Text>
          ) : null}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {item.trackingCode}
                </Text>
                <Text style={{ color: parcelStatusColor(item.status), fontWeight: '800', fontSize: 11 }}>
                  {item.status}
                </Text>
              </View>
              {item.description && (
                <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }} numberOfLines={2}>
                  {item.description}
                </Text>
              )}
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
                {L('Destinataire', 'Recipient')} : {item.recipient?.name ?? '—'}
                {item.recipient?.phone ? ` · ${item.recipient.phone}` : ''}
              </Text>
              {item.currentLocation && (
                <Text style={{ color: colors.primary, fontSize: 12, marginTop: 4 }}>
                  📍 {item.currentLocation}
                </Text>
              )}
            </View>
          )}
        />
      )}

      {/* ── Modale QR plein écran ──────────────────────────────────────── */}
      <Modal
        visible={qrOpen !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setQrOpen(null)}
      >
        <View style={styles.qrBackdrop}>
          <View style={[styles.qrModal, { backgroundColor: colors.background }]}>
            {qrOpen && (
              <>
                <Text style={[styles.h1, { color: colors.text, textAlign: 'center' }]}>
                  {qrOpen.trip?.route?.origin?.name ?? '?'} → {qrOpen.trip?.route?.destination?.name ?? '?'}
                </Text>
                <Text style={{ color: colors.textMuted, textAlign: 'center', marginBottom: 16 }}>
                  {qrOpen.passengerName}
                  {qrOpen.seatNumber ? ` · ${L('Siège', 'Seat')} ${qrOpen.seatNumber}` : ''}
                </Text>
                {qrOpen.qrCode && (
                  <View style={{
                    alignSelf: 'center',
                    padding: 16,
                    backgroundColor: '#fff',
                    borderRadius: 12,
                    maxWidth: '100%',
                  }}>
                    <Text
                      accessibilityLabel="QR token"
                      selectable
                      style={{
                        color: '#000',
                        fontFamily: 'Courier',
                        fontSize: 12,
                        textAlign: 'center',
                      }}
                    >
                      {qrOpen.qrCode}
                    </Text>
                  </View>
                )}
                <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 16, fontSize: 12 }}>
                  {L('Présentez ce QR à l\'agent de quai.', 'Show this QR to the gate agent.')}
                </Text>
                <Pressable
                  onPress={() => setQrOpen(null)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.closeBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                    {L('Fermer', 'Close')}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:      { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:        { fontSize: 18, fontWeight: '800' },
  banner:    { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  tabs:      { flexDirection: 'row', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  tab:       { paddingVertical: 12, paddingHorizontal: 12, minHeight: 44 },
  card:      { padding: 14, borderRadius: 12, borderWidth: 1 },
  qrBackdrop:{ flex: 1, backgroundColor: 'rgba(15,23,42,0.85)', justifyContent: 'center', padding: 24 },
  qrModal:   { padding: 24, borderRadius: 16 },
  closeBtn:  { marginTop: 20, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
