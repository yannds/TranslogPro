import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, Pressable, ScrollView, StyleSheet, ActivityIndicator, TextInput, Alert,
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

// Pas de magic number dans le render.
const MAX_RECENT_TRIPS = 20;

interface TripRow {
  id:                 string;
  status:             string;
  departureScheduled: string;
  arrivalScheduled:   string;
  route?: {
    origin?:      { name: string };
    destination?: { name: string };
  };
  _count?: { travelers?: number };
}

/**
 * Écran Agent de quai — scan billet + signature manifest.
 *
 * MVP v0.1 :
 *   - Saisie manuelle du jeton QR (fallback sans camera).
 *   - POST /tenants/:tid/tickets/validate côté serveur (scope agency).
 *   - Liste des manifests récents.
 *
 * Offline : validation de billet mise en file si pas de réseau (le serveur
 * applique l'idempotency-key côté scan).
 */
export function QuaiHomeScreen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const navigation = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const [qrToken, setQrToken] = useState('');
  const { toast, show: showFeedback } = useScanFeedback();
  const [busy, setBusy] = useState(false);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Mode scan : check-in par défaut. Toggle board visible uniquement si
  // perm+blueprint autorisent le SCAN_BOARD à cet agent.
  const [mode, setMode] = useState<'check-in' | 'board'>('check-in');
  const [caps, setCaps] = useState<{ canCheckIn: boolean; canBoard: boolean } | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    void apiGet<{ canCheckIn: boolean; canBoard: boolean }>(
      `/api/tenants/${tenantId}/scan/capabilities`,
      { skipAuthRedirect: true },
    ).then(setCaps).catch(() => setCaps({ canCheckIn: true, canBoard: false }));
  }, [tenantId]);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      // Pas de table Manifest : on liste les trips récents (scope agency via backend).
      const params = 'status=BOARDING&status=IN_PROGRESS&status=COMPLETED';
      const res = await apiGet<TripRow[]>(
        `/api/tenants/${tenantId}/trips?${params}`,
        { skipAuthRedirect: true },
      );
      setTrips([...res]
        .sort((a, b) => new Date(b.departureScheduled).getTime() - new Date(a.departureScheduled).getTime())
        .slice(0, MAX_RECENT_TRIPS));
    } catch { /* offline */ }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  /**
   * Scan unique depuis la home agent quai — route vers le blueprint Traveler
   * via `/scan/ticket` → `nextAction` → `flight-deck/check-in|board`. L'ancien
   * chemin `/tickets/verify-qr` ne passait que par le blueprint Ticket, ce qui
   * laissait `Traveler.status` inchangé et faisait que les écrans quai/bus
   * n'affichaient jamais les scans. Alignement fait ici sur les 3 autres
   * écrans scan mobile (BoardingScan, QuaiBulkScan, ParcelScan).
   */
  async function scanTicket(overrideToken?: string) {
    const raw = (overrideToken ?? qrToken).trim();
    if (!raw) {
      showFeedback({ kind: 'warning', title: '⚠ Jeton requis', subtitle: 'Scannez ou collez le QR du billet.' });
      return;
    }
    // Extrait id ou q-token depuis une URL /verify/ticket/:id?q=TOKEN.
    const code = (() => {
      const m = raw.match(/\/verify\/ticket\/([^/?]+)(?:\?q=([^&]+))?/);
      return m ? (m[2] ? decodeURIComponent(m[2]) : decodeURIComponent(m[1])) : raw;
    })();

    setBusy(true);
    try {
      if (!online) {
        await enqueueMutation({
          tenantId,
          kind: 'scan.ticket.offline',
          method: 'POST',
          url: `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(code)}&intent=${mode}`,
          body: {},
          context: { code },
          idempotencyKey: `scan-ticket:${code}`,
        });
        showFeedback({ kind: 'info', title: '⏳ En file', subtitle: 'Scan enverra à reconnexion.' });
        setQrToken('');
        return;
      }

      const lookupUrl = `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(code)}&intent=${mode}`;
      const lookup = await apiGet<{
        ticket: { id: string; passengerName: string };
        trip:   { id: string } | null;
        nextAction: 'CHECK_IN' | 'BOARD' | 'ALREADY_CHECKED_IN' | 'ALREADY_BOARDED' | 'TICKET_CANCELLED' | 'TICKET_EXPIRED' | 'TICKET_PENDING';
      }>(lookupUrl, { skipAuthRedirect: true });

      if (lookup.nextAction === 'ALREADY_CHECKED_IN') { showFeedback({ kind: 'info', title: 'ℹ Déjà enregistré', subtitle: lookup.ticket.passengerName }); setQrToken(''); return; }
      if (lookup.nextAction === 'ALREADY_BOARDED') { showFeedback({ kind: 'warning', title: '⚠ Déjà embarqué', subtitle: lookup.ticket.passengerName }); setQrToken(''); return; }
      if (lookup.nextAction === 'TICKET_CANCELLED') { showFeedback({ kind: 'error', title: '✕ Billet annulé' }); return; }
      if (lookup.nextAction === 'TICKET_EXPIRED')   { showFeedback({ kind: 'error', title: '✕ Billet expiré' }); return; }
      if (lookup.nextAction === 'TICKET_PENDING')   { showFeedback({ kind: 'error', title: '✕ Paiement non finalisé' }); return; }
      if (!lookup.trip)                             { showFeedback({ kind: 'error', title: '✕ Trajet introuvable' }); return; }

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
      setQrToken('');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e));
      showFeedback({ kind: 'error', title: '✕ Refusé', subtitle: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.h1, { color: colors.text }]}>TransLog — Agent de quai</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{user?.name ?? user?.email}</Text>
        </View>
        <Pressable onPress={logout} accessibilityRole="button" style={styles.logoutBtn}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>⎋</Text>
        </Pressable>
      </View>

      {/* Feedback scan — visible + vibration + beep web. Auto-dismiss 2s. */}
      <ScanToastBanner toast={toast} />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <View style={styles.quickRow}>
        <Pressable
          onPress={() => navigation.navigate('QuaiBulkScan')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.quickBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>⚡ Scan rafale</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('QuaiManifest')}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.quickBtn,
            { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>📄 Manifest GPS</Text>
        </Pressable>
      </View>

      {/* Actions colis — hub, retrait, dispute (2026-04-19) */}
      <View style={[styles.quickRow, { marginTop: -4 }]}>
        <Pressable
          onPress={() => navigation.navigate('QuaiParcelActions')}
          accessibilityRole="button"
          accessibilityLabel="Actions colis — hub, retrait, contestation"
          style={({ pressed }) => [
            styles.quickBtn,
            { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>📦 Actions colis</Text>
        </Pressable>
      </View>

      <View style={[styles.card, { margin: 16, borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.label, { color: colors.text }]}>Valider un billet (scan unique)</Text>

        {/* Toggle check-in / board — visible uniquement si perm + blueprint
            autorisent les deux. Sinon l'agent reste en mode check-in. */}
        {caps?.canCheckIn && caps?.canBoard && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 10 }}>
            <Pressable
              onPress={() => setMode('check-in')}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === 'check-in' }}
              style={{
                flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: mode === 'check-in' ? colors.primary : colors.surface,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: mode === 'check-in' ? colors.primaryFg : colors.text, fontWeight: '700', fontSize: 13 }}>
                ✓ Check-in
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setMode('board')}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === 'board' }}
              style={{
                flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: mode === 'board' ? colors.primary : colors.surface,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: mode === 'board' ? colors.primaryFg : colors.text, fontWeight: '700', fontSize: 13 }}>
                → Embarquement
              </Text>
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={() => setScannerOpen(true)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Scanner un QR code"
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: colors.primary, opacity: busy || pressed ? 0.7 : 1, marginBottom: 8 },
          ]}
        >
          <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>Scanner un QR</Text>
        </Pressable>

        <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 6 }}>
          ou collez le jeton :
        </Text>

        <TextInput
          value={qrToken}
          onChangeText={setQrToken}
          placeholder="Coller le jeton QR"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          accessibilityLabel="Jeton QR"
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        <Pressable
          onPress={() => { void scanTicket(); }}
          disabled={busy}
          style={({ pressed }) => [
            styles.btnGhost,
            { borderColor: colors.border, opacity: busy || pressed ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {busy ? 'Validation…' : 'Valider (saisie manuelle)'}
          </Text>
        </Pressable>
      </View>

      <QrScanner
        visible={scannerOpen}
        onScanned={(data) => {
          setScannerOpen(false);
          setQrToken(data);
          // Validation immédiate : on passe explicitement le jeton pour éviter
          // le problème de closure sur setState.
          void scanTicket(data);
        }}
        onClose={() => setScannerOpen(false)}
      />

      <Text style={[styles.h2, { color: colors.text, paddingHorizontal: 16 }]}>Trajets r&eacute;cents</Text>

      {loading && <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {!loading && trips.length === 0 && (
          <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 16 }}>
            Aucun trajet en embarquement.
          </Text>
        )}
        {trips.map((tr) => (
          <View key={tr.id} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {tr.route?.origin?.name ?? '?'} → {tr.route?.destination?.name ?? '?'}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {tr.status} · {new Date(tr.departureScheduled).toLocaleTimeString()}
                {typeof tr._count?.travelers === 'number' ? ` · ${tr._count.travelers} pax` : ''}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  h1:        { fontSize: 20, fontWeight: '800' },
  h2:        { fontSize: 16, fontWeight: '700' },
  logoutBtn: { padding: 12, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:    { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8 },
  label:     { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  btn:       { marginTop: 10, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnGhost:  { marginTop: 8, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  card:      { padding: 14, borderRadius: 12, borderWidth: 1 },
  row:       { padding: 12, borderRadius: 10, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between' },
  quickRow:  { flexDirection: 'row', marginHorizontal: 16, gap: 8 },
  quickBtn:  { flex: 1, height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
