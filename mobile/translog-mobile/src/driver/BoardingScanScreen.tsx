/**
 * BoardingScanScreen — Pointage passagers à l'embarquement via scan QR.
 *
 * Flux :
 *   - Scanner le QR du billet → extraction du ticketId via /tickets/verify-qr
 *     (déjà implémenté côté Quai/Station) puis POST /flight-deck/trips/:tid/passengers/:ticketId/check-in
 *   - Liste live des passagers attendus avec leur statut (CONFIRMED|CHECKED_IN|BOARDED)
 *   - Compteur live : BOARDED / total confirmés
 *
 * Sécurité :
 *   - L'écran utilise TRIP_CHECK_OWN (chauffeur ne check-in que SES passagers)
 *   - Anti-double scan via QrScanner (lock) + idempotency-key déterministe
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, Alert, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';
import { QrScanner } from '../ui/QrScanner';
import { useScanFeedback, ScanToastBanner } from '../ui/ScanFeedback';

interface Passenger {
  ticketId:      string;
  status:        'CONFIRMED' | 'CHECKED_IN' | 'BOARDED' | string;
  passengerName: string;
  seatNumber:    string | null;
  fareClass:     string;
}

export function BoardingScanScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const { tripId } = (useRoute().params ?? {}) as { tripId?: string };
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [list, setList]       = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy]       = useState(false);
  const { toast, show: showFeedback } = useScanFeedback();

  const refresh = useCallback(async () => {
    if (!tenantId || !tripId) return;
    try {
      const res = await apiGet<Passenger[]>(
        `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers`,
        { skipAuthRedirect: true },
      );
      setList(res ?? []);
    } catch { /* offline ou pas de data : on garde l'ancien */ }
  }, [tenantId, tripId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function onPullRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const counters = useMemo(() => {
    const total    = list.length;
    const boarded  = list.filter(p => p.status === 'BOARDED').length;
    const checked  = list.filter(p => p.status === 'CHECKED_IN').length;
    return { total, boarded, checked };
  }, [list]);

  /**
   * Extrait le token de scan depuis n'importe quel format QR supporté :
   *   - URL publique de vérif : `https://.../verify/ticket/:id?q=HMAC`
   *   - Token HMAC brut       : `BASE64URL.SHA256...`
   *   - ID cuid direct        : `cmoxyz...`
   *
   * Le backend `/scan/ticket?code=X` accepte indifféremment l'`id` ou le
   * `qrCode` du ticket — on lui envoie le token brut quand on a une URL, ou
   * l'`id` quand le QR contient directement un id.
   */
  function parseQrToken(raw: string): string {
    const trimmed = raw.trim();
    // URL de vérif publique : on extrait le query param `q=` qui contient le
    // token HMAC (matching sur le backend via `qrCode`).
    const urlMatch = trimmed.match(/\/verify\/ticket\/[^?]+\?q=([^&]+)/);
    if (urlMatch) return decodeURIComponent(urlMatch[1]);
    // ID seul dans le path sans HMAC : on renvoie l'id
    const idOnly = trimmed.match(/\/verify\/ticket\/([^/?]+)/);
    if (idOnly) return decodeURIComponent(idOnly[1]);
    return trimmed;
  }

  /**
   * Handler unique : scan QR → `/scan/ticket` → décide CHECK_IN vs BOARD
   * via `nextAction` → appelle l'endpoint blueprint (WorkflowEngine) → refresh.
   *
   * Remplace l'ancien flow `/tickets/verify-qr` (qui ne touchait que
   * Ticket.status et n'émettait pas de transition Traveler). Avec ce flow,
   * le Traveler est correctement avancé dans le state graph blueprint —
   * les écrans QuaiScreen / BusScreen / manifeste live réagissent.
   */
  async function handleQrScanned(raw: string) {
    setScannerOpen(false);
    if (!raw) return;
    const code = parseQrToken(raw);
    if (!code) return;

    setBusy(true);
    try {
      // Offline : on ne peut pas faire le lookup → on met un CHECK_IN
      // optimiste dans l'outbox pour le 1er scan (comportement identique
      // à l'ancien flow). Le chauffeur re-scannera pour BOARD si besoin.
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'passenger.scan.offline', method: 'POST',
          url:  `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(code)}&intent=board`,
          body: {}, idempotencyKey: `scan-ticket:${code}`,
        });
        Alert.alert(L('En file', 'Queued'), L('Scan différé.', 'Will sync on reconnect.'));
        return;
      }

      const lookupUrl = `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(code)}&intent=board`;
      const lookup = await apiGet<{
        ticket:   { id: string; passengerName: string; seatNumber: string | null };
        trip:     { id: string } | null;
        traveler: { status: string } | null;
        nextAction: 'CHECK_IN' | 'BOARD' | 'ALREADY_CHECKED_IN' | 'ALREADY_BOARDED' | 'TICKET_CANCELLED' | 'TICKET_EXPIRED' | 'TICKET_PENDING';
      }>(lookupUrl, { skipAuthRedirect: true });

      // Garde-fous métier : refus monotoniques — l'UI doit distinguer
      // warning (déjà embarqué, idempotent) vs error (ticket annulé, action
      // refusée). Feedback via ScanFeedback = visible + tactile, pas d'alert.
      if (lookup.nextAction === 'ALREADY_BOARDED') {
        showFeedback({ kind: 'warning', title: L('⚠ Déjà embarqué', '⚠ Already boarded'), subtitle: lookup.ticket.passengerName });
        return;
      }
      if (lookup.nextAction === 'TICKET_CANCELLED') {
        showFeedback({ kind: 'error', title: L('✕ Billet annulé', '✕ Ticket cancelled'), subtitle: lookup.ticket.passengerName });
        return;
      }
      if (lookup.nextAction === 'TICKET_EXPIRED') {
        showFeedback({ kind: 'error', title: L('✕ Billet expiré', '✕ Ticket expired'), subtitle: lookup.ticket.passengerName });
        return;
      }
      if (lookup.nextAction === 'TICKET_PENDING') {
        showFeedback({ kind: 'error', title: L('✕ Paiement en attente', '✕ Payment pending'), subtitle: lookup.ticket.passengerName });
        return;
      }

      const effectiveTripId = lookup.trip?.id ?? tripId;
      if (!effectiveTripId) {
        showFeedback({ kind: 'error', title: L('✕ Trajet introuvable', '✕ Trip not found') });
        return;
      }

      // Appel de l'endpoint blueprint. CHECK_IN / BOARD → Traveler via
      // WorkflowEngine → audit correct → compteurs écrans live.
      const txUrl = lookup.nextAction === 'CHECK_IN'
        ? `/api/tenants/${tenantId}/flight-deck/trips/${effectiveTripId}/passengers/${lookup.ticket.id}/check-in`
        : `/api/tenants/${tenantId}/flight-deck/trips/${effectiveTripId}/passengers/${lookup.ticket.id}/board`;
      const method = lookup.nextAction === 'CHECK_IN' ? 'POST' : 'PATCH';
      const idempotencyKey = `${lookup.nextAction === 'CHECK_IN' ? 'check-in' : 'board'}:${lookup.ticket.id}`;

      if (method === 'POST') {
        await apiPost(txUrl, {}, { skipAuthRedirect: true, headers: { 'idempotency-key': idempotencyKey } });
      } else {
        // PATCH via apiFetch (apiPatch exposé comme helper).
        await (await import('../api/client')).apiPatch(txUrl, {}, { skipAuthRedirect: true, headers: { 'idempotency-key': idempotencyKey } });
      }

      // Sync optimiste + refresh serveur. Le refresh garantit que les
      // compteurs (boarded / checked / total) reflètent la vérité DB —
      // indispensable si le ticket n'était pas dans la liste locale (ex.
      // passager créé à la volée, ou scan fait depuis un autre poste).
      const newStatus: Passenger['status'] = lookup.nextAction === 'CHECK_IN' ? 'CHECKED_IN' : 'BOARDED';
      setList(prev => prev.map(p => p.ticketId === lookup.ticket.id ? { ...p, status: newStatus } : p));
      void refresh();

      showFeedback({
        kind: 'success',
        title: lookup.nextAction === 'CHECK_IN'
          ? L('✓ Enregistré en gare', '✓ Checked in')
          : L('✓ Embarqué', '✓ Boarded'),
        subtitle: `${lookup.ticket.passengerName}${lookup.ticket.seatNumber ? ` · ${L('siège', 'seat')} ${lookup.ticket.seatNumber}` : ''}`,
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e));
      showFeedback({ kind: 'error', title: L('✕ Refusé', '✕ Refused'), subtitle: msg });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Action manuelle depuis la liste — avance d'une étape dans le blueprint.
   * - Si passager encore CONFIRMED → check-in
   * - Si passager CHECKED_IN       → board
   * Même chemin WorkflowEngine que le scan, juste sans décodage QR.
   */
  async function manualBoard(p: Passenger) {
    if (p.status === 'BOARDED') return;
    const action: 'CHECK_IN' | 'BOARD' = p.status === 'CHECKED_IN' ? 'BOARD' : 'CHECK_IN';
    setBusy(true);
    try {
      const url = action === 'CHECK_IN'
        ? `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers/${p.ticketId}/check-in`
        : `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers/${p.ticketId}/board`;
      const method = action === 'CHECK_IN' ? 'POST' : 'PATCH';
      const idempotencyKey = `${action === 'CHECK_IN' ? 'check-in' : 'board'}:${p.ticketId}`;

      if (!online) {
        await enqueueMutation({
          tenantId, kind: `passenger.${action.toLowerCase()}`, method,
          url, body: {}, idempotencyKey,
        });
      } else if (method === 'POST') {
        await apiPost(url, {}, { skipAuthRedirect: true, headers: { 'idempotency-key': idempotencyKey } });
      } else {
        await (await import('../api/client')).apiPatch(url, {}, { skipAuthRedirect: true, headers: { 'idempotency-key': idempotencyKey } });
      }
      const newStatus: Passenger['status'] = action === 'CHECK_IN' ? 'CHECKED_IN' : 'BOARDED';
      setList(prev => prev.map(x => x.ticketId === p.ticketId ? { ...x, status: newStatus } : x));
      void refresh();
      showFeedback({
        kind: 'success',
        title: action === 'CHECK_IN' ? L('✓ Enregistré', '✓ Checked in') : L('✓ Embarqué', '✓ Boarded'),
        subtitle: p.passengerName,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showFeedback({ kind: 'error', title: L('✕ Refusé', '✕ Refused'), subtitle: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: colors.text }]}>
            {L('Embarquement', 'Boarding')}
          </Text>
          {/* Compteurs visuels — incrémentent après chaque scan réussi.
              Gros chiffres, pas de libellé tronqué : l'agent doit voir la
              progression d'un coup d'œil depuis 1m. */}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            <Text style={{ color: colors.success, fontSize: 14, fontWeight: '800' }}>
              {counters.boarded}/{counters.total} {L('à bord', 'boarded')}
            </Text>
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700' }}>
              {counters.checked} {L('en gare', 'in station')}
            </Text>
          </View>
        </View>
      </View>

      {/* Banner de feedback scan — posé en absolute sur tout l'écran, auto-
          dismiss ~2s. Visible + vibration (native) + beep (web). */}
      <ScanToastBanner toast={toast} />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <Pressable
        onPress={() => setScannerOpen(true)}
        disabled={busy}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.scanBtn,
          { backgroundColor: colors.primary, opacity: busy || pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={{ color: colors.primaryFg, fontWeight: '800', fontSize: 16 }}>
          {L('Scanner un billet', 'Scan a ticket')}
        </Text>
      </Pressable>

      {loading && list.length === 0 && <ActivityIndicator style={{ marginTop: 16 }} color={colors.primary} />}

      <FlatList
        data={list}
        keyExtractor={(p) => p.ticketId}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        ListEmptyComponent={
          !loading ? (
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
              {L('Aucun passager confirmé pour ce trajet.', 'No confirmed passenger for this trip.')}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => manualBoard(item)}
            disabled={item.status === 'BOARDED' || busy}
            accessibilityRole="button"
            style={[
              styles.row,
              {
                borderColor: item.status === 'BOARDED' ? colors.success : colors.border,
                backgroundColor: item.status === 'BOARDED' ? colors.successBg : colors.surface,
              },
            ]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                {item.passengerName}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {item.fareClass}{item.seatNumber ? ` · ${L('siège', 'seat')} ${item.seatNumber}` : ''}
              </Text>
            </View>
            <Text style={{
              color: item.status === 'BOARDED' ? colors.success
                : item.status === 'CHECKED_IN' ? colors.primary
                : colors.textMuted,
              fontSize: 11, fontWeight: '800',
            }}>
              {item.status}
            </Text>
          </Pressable>
        )}
      />

      <QrScanner
        visible={scannerOpen}
        onScanned={handleQrScanned}
        onClose={() => setScannerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:       { fontSize: 18, fontWeight: '800' },
  back:     { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:   { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  scanBtn:  { marginHorizontal: 16, marginTop: 8, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  row:      { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, gap: 10 },
});
