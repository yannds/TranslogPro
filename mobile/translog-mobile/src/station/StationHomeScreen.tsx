import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';
import { QrScanner } from '../ui/QrScanner';
import { useScanFeedback, ScanToastBanner } from '../ui/ScanFeedback';

interface TripRow {
  id:                 string;
  departureScheduled: string;
  status:             string;
  route?: { origin?: { name: string }; destination?: { name: string } };
}

/**
 * Écran Agent de gare — vue tableau de bord rapide.
 *   - Prochains départs (GET /trips?status=PLANNED|OPEN|BOARDING)
 *   - Bouton "Vendre billet" (redirige vers la vue web desktop tant que le
 *     parcours mobile complet n'est pas implémenté — évite les régressions).
 *   - Bouton "Scanner QR" : placeholder tant que expo-camera n'est pas câblé.
 *
 * Permissions : data.trip.read.tenant OU data.ticket.create.agency côté backend.
 */
export function StationHomeScreen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const navigation = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const { toast, show: showFeedback } = useScanFeedback();

  /**
   * Scan QR en vue station (agent vente / check-in).
   *
   * Avant : POST /tickets/verify-qr (met à jour Ticket.status, ne touche pas
   * Traveler → les écrans quai/bus ne voient rien). Après : GET /scan/ticket
   * → récupère nextAction calculée côté blueprint → appelle flight-deck
   * check-in/board qui passent par WorkflowEngine (transition Traveler
   * proprement auditée, émission d'événements TICKET_BOARDED, etc.).
   */
  async function onQrScanned(data: string) {
    setScannerOpen(false);
    if (!data || !tenantId) return;

    // Extrait l'ID/token depuis une URL /verify/ticket/:id?q=TOKEN sinon brut.
    const code = (() => {
      const m = data.match(/\/verify\/ticket\/([^/?]+)(?:\?q=([^&]+))?/);
      return m ? (m[2] ? decodeURIComponent(m[2]) : decodeURIComponent(m[1])) : data.trim();
    })();

    try {
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'scan.ticket.offline', method: 'POST',
          url: `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(code)}&intent=check-in`,
          body: {}, context: { code },
          idempotencyKey: `scan-ticket:${code}`,
        });
        showFeedback({ kind: 'info', title: '⏳ En file', subtitle: 'Scan enverra à reconnexion.' });
        return;
      }

      // 1. Lookup blueprint-aware
      const lookupUrl = `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(code)}&intent=check-in`;
      const lookup = await apiGet<{
        ticket: { id: string; passengerName: string };
        trip:   { id: string } | null;
        nextAction: 'CHECK_IN' | 'BOARD' | 'ALREADY_CHECKED_IN' | 'ALREADY_BOARDED' | 'TICKET_CANCELLED' | 'TICKET_EXPIRED' | 'TICKET_PENDING';
      }>(lookupUrl, { skipAuthRedirect: true });

      // 2. Refus métier immédiats (warning pour ALREADY_BOARDED, error sinon)
      if (lookup.nextAction === 'ALREADY_CHECKED_IN') {
        showFeedback({ kind: 'info', title: 'ℹ Déjà enregistré', subtitle: lookup.ticket.passengerName });
        return;
      }
      if (lookup.nextAction === 'ALREADY_BOARDED') {
        showFeedback({ kind: 'warning', title: '⚠ Déjà embarqué', subtitle: lookup.ticket.passengerName });
        return;
      }
      if (lookup.nextAction === 'TICKET_CANCELLED') { showFeedback({ kind: 'error', title: '✕ Billet annulé' }); return; }
      if (lookup.nextAction === 'TICKET_EXPIRED')   { showFeedback({ kind: 'error', title: '✕ Billet expiré' }); return; }
      if (lookup.nextAction === 'TICKET_PENDING')   { showFeedback({ kind: 'error', title: '✕ Paiement non finalisé' }); return; }

      if (!lookup.trip) { showFeedback({ kind: 'error', title: '✕ Trajet introuvable' }); return; }

      // 3. Transition via WorkflowEngine (blueprint respecté)
      const txUrl = lookup.nextAction === 'CHECK_IN'
        ? `/api/tenants/${tenantId}/flight-deck/trips/${lookup.trip.id}/passengers/${lookup.ticket.id}/check-in`
        : `/api/tenants/${tenantId}/flight-deck/trips/${lookup.trip.id}/passengers/${lookup.ticket.id}/board`;
      const idempotencyKey = `${lookup.nextAction === 'CHECK_IN' ? 'check-in' : 'board'}:${lookup.ticket.id}`;
      const headers = { 'Idempotency-Key': idempotencyKey };
      if (lookup.nextAction === 'CHECK_IN') {
        await apiPost(txUrl, {}, { skipAuthRedirect: true, headers });
      } else {
        await (await import('../api/client')).apiPatch(txUrl, {}, { skipAuthRedirect: true, headers });
      }
      showFeedback({
        kind: 'success',
        title: lookup.nextAction === 'CHECK_IN' ? '✓ Enregistré en gare' : '✓ Embarqué',
        subtitle: lookup.ticket.passengerName,
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e));
      showFeedback({ kind: 'error', title: '✕ Refusé', subtitle: msg });
    }
  }

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      const params = 'status=PLANNED&status=OPEN&status=BOARDING';
      const res = await apiGet<TripRow[]>(
        `/api/tenants/${tenantId}/trips?${params}`,
        { skipAuthRedirect: true },
      );
      setTrips([...res]
        .sort((a, b) => new Date(a.departureScheduled).getTime() - new Date(b.departureScheduled).getTime())
        .slice(0, 20),
      );
    } catch { /* offline */ }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.h1, { color: colors.text }]}>TransLog — Agent de gare</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{user?.name ?? user?.email}</Text>
        </View>
        <Pressable onPress={logout} accessibilityRole="button" style={styles.logoutBtn}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>⎋</Text>
        </Pressable>
      </View>

      {/* Feedback scan — banner visuel + vibration + beep web. */}
      <ScanToastBanner toast={toast} />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <View style={styles.actionRow}>
        <ActionButton
          label="Vendre un billet"
          color={colors.primary}
          fg={colors.primaryFg}
          onPress={() => navigation.navigate('StationSellTicket')}
        />
        <ActionButton
          label="Scanner un QR"
          color={colors.surface}
          fg={colors.text}
          onPress={() => setScannerOpen(true)}
        />
      </View>
      <View style={[styles.actionRow, { marginTop: 8 }]}>
        <ActionButton
          label="Bagages"
          color={colors.surface}
          fg={colors.text}
          onPress={() => navigation.navigate('StationLuggage')}
        />
        <ActionButton
          label="Info & Ventes du jour"
          color={colors.surface}
          fg={colors.text}
          onPress={() => navigation.navigate('StationBoard')}
        />
      </View>

      <Text style={[styles.h2, { color: colors.text, paddingHorizontal: 16, marginTop: 16 }]}>
        Prochains départs
      </Text>

      {loading && <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {!loading && trips.length === 0 && (
          <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
            Aucun départ imminent.
          </Text>
        )}
        {trips.map((trip) => (
          <View key={trip.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {trip.route?.origin?.name ?? '?'} → {trip.route?.destination?.name ?? '?'}
            </Text>
            <Text style={{ color: colors.textMuted, marginTop: 2 }}>
              {new Date(trip.departureScheduled).toLocaleString(undefined, {
                hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
              })} · {trip.status}
            </Text>
          </View>
        ))}
      </ScrollView>

      <QrScanner
        visible={scannerOpen}
        onScanned={onQrScanned}
        onClose={() => setScannerOpen(false)}
      />
    </SafeAreaView>
  );
}

function ActionButton({
  label, color, fg, onPress,
}: { label: string; color: string; fg: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: color, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={{ color: fg, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  h1:        { fontSize: 20, fontWeight: '800' },
  h2:        { fontSize: 16, fontWeight: '700' },
  logoutBtn: { padding: 12, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:    { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8 },
  actionRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  action:    { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 12 },
  card:      { padding: 12, borderRadius: 10, borderWidth: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
});
