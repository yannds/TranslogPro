/**
 * QuaiBulkScanScreen — Mode "rafale" pour le contrôle d'embarquement.
 *
 * Contexte :
 *   - L'agent de quai scanne en continu 50-200 billets/jour.
 *   - Fermer/rouvrir la caméra après chaque scan est trop lent.
 *   - Pas de magic number : délais de toast + debounce explicites.
 *
 * Flux :
 *   - La caméra reste active.
 *   - Chaque scan → POST /tickets/verify-qr (ou outbox si offline)
 *   - Toast de résultat (success/fail) affiché brièvement
 *   - Historique local des 20 derniers scans (réussis + refusés)
 *   - Compteur OK / KO live
 *
 * Anti-double scan : le token scanné est mémorisé pendant SCAN_DEDUP_MS. Tant
 *   que le token est en cache, la même valeur est ignorée.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, SafeAreaView, Pressable, StyleSheet, FlatList, Modal,
} from 'react-native';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';
import { QrScanner } from '../ui/QrScanner';
import { useScanFeedback, ScanToastBanner, type ScanFeedbackKind } from '../ui/ScanFeedback';

const SCAN_DEDUP_MS      = 3_000;   // ignore le même token pendant 3s
const TOAST_DURATION_MS  = 1_800;
const HISTORY_LIMIT      = 20;

interface ScanResult {
  id:         string;
  at:         number;
  outcome:    'OK' | 'KO' | 'QUEUED';
  message:    string;
}

export function QuaiBulkScanScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const routeParams = (useRoute().params ?? {}) as { defaultIntent?: 'check-in' | 'board' };
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [scannerOpen, setScannerOpen] = useState(true);
  const [history, setHistory]         = useState<ScanResult[]>([]);
  const [ok, setOk]                   = useState(0);
  const [ko, setKo]                   = useState(0);
  // Type scanné — billet (passagers) OU colis. Pas de magic dépendant de
  // routeParam : par défaut on prend `defaultType` ou 'ticket'. Le toggle Type
  // est toujours rendu (l'agent / chauffeur enchaîne sans quitter l'écran).
  const [scanType, setScanType] = useState<'ticket' | 'parcel'>(
    ((useRoute().params ?? {}) as { defaultType?: 'ticket' | 'parcel' }).defaultType ?? 'ticket',
  );
  // Mode action ticket : check-in (gare) | board (bus). Ignoré quand scanType=parcel.
  const [mode, setMode] = useState<'check-in' | 'board'>(routeParams.defaultIntent ?? 'check-in');
  const [caps, setCaps] = useState<{ canCheckIn: boolean; canBoard: boolean } | null>(null);

  const recentTokens = useRef<Map<string, number>>(new Map());
  const { toast, show } = useScanFeedback();
  // Modal de confirmation sortie (cross-platform : Alert.alert ne fonctionne
  // pas fiablement sur Expo Web, et un window.confirm brouille l'UX sur natif).
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    void apiGet<{ canCheckIn: boolean; canBoard: boolean }>(
      `/api/tenants/${tenantId}/scan/capabilities`,
      { skipAuthRedirect: true },
    ).then(setCaps).catch(() => setCaps({ canCheckIn: true, canBoard: false }));
  }, [tenantId]);

  /**
   * Raccourci sémantique : map le type de retour au `ScanFeedbackKind`.
   * Le vibrato + le beep changent en conséquence (ok/warning/error).
   */
  function showToast(msg: string, okFlag: boolean, kind?: ScanFeedbackKind) {
    show({ kind: kind ?? (okFlag ? 'success' : 'error'), title: msg, durationMs: TOAST_DURATION_MS });
  }

  /**
   * Extrait un code exploitable depuis n'importe quel format QR :
   * - URL publique `/verify/{ticket|parcel}/:id?q=TOKEN` → renvoie TOKEN
   * - URL sans q → renvoie id
   * - Token brut ou id direct → renvoie tel quel
   *
   * Le même format de QR sert aux 2 entités, le préfixe d'URL change
   * (ticket vs parcel) mais on extrait l'identifiant de la même façon.
   */
  function parseQrToken(raw: string): string {
    const trimmed = raw.trim();
    const withQ   = trimmed.match(/\/verify\/(?:ticket|parcel)\/[^?]+\?q=([^&]+)/);
    if (withQ) return decodeURIComponent(withQ[1]);
    const idOnly  = trimmed.match(/\/verify\/(?:ticket|parcel)\/([^/?]+)/);
    if (idOnly) return decodeURIComponent(idOnly[1]);
    return trimmed;
  }

  /**
   * Scan rafale ticket : mappe `nextAction` du lookup `/scan/ticket` vers la
   * bonne transition Traveler (CHECK_IN ou BOARD).
   */
  async function handleTicketScan(code: string, id: string, now: number) {
    if (!online) {
      await enqueueMutation({
        tenantId, kind: 'scan.ticket.offline', method: 'POST',
        url:  `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(code)}&intent=${mode}`,
        body: {}, idempotencyKey: `scan-ticket:${code}`,
      });
      setHistory(prev => [{ id, at: now, outcome: 'QUEUED' as const, message: L('Mis en file', 'Queued') }, ...prev].slice(0, HISTORY_LIMIT));
      showToast(L('En file — resync bientôt', 'Queued — syncs soon'), true);
      return;
    }

    const lookupUrl = `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(code)}&intent=${mode}`;
    const lookup = await apiGet<{
      ticket:   { id: string; passengerName: string };
      trip:     { id: string } | null;
      nextAction: 'CHECK_IN' | 'BOARD' | 'ALREADY_CHECKED_IN' | 'ALREADY_BOARDED' | 'TICKET_CANCELLED' | 'TICKET_EXPIRED' | 'TICKET_PENDING';
    }>(lookupUrl, { skipAuthRedirect: true });

    if (lookup.nextAction === 'ALREADY_CHECKED_IN') {
      setHistory(prev => [{ id, at: now, outcome: 'OK' as const, message: L('Déjà enregistré', 'Already checked in') }, ...prev].slice(0, HISTORY_LIMIT));
      showToast(L('ℹ Déjà enregistré', 'ℹ Already checked in'), true, 'info');
      return;
    }
    if (lookup.nextAction === 'ALREADY_BOARDED') {
      setHistory(prev => [{ id, at: now, outcome: 'KO' as const, message: L('Déjà embarqué', 'Already boarded') }, ...prev].slice(0, HISTORY_LIMIT));
      showToast(L('⚠ Déjà embarqué', '⚠ Already boarded'), false, 'warning');
      return;
    }
    if (lookup.nextAction === 'TICKET_CANCELLED' || lookup.nextAction === 'TICKET_EXPIRED' || lookup.nextAction === 'TICKET_PENDING') {
      const msg = lookup.nextAction === 'TICKET_CANCELLED' ? L('Annulé', 'Cancelled')
                : lookup.nextAction === 'TICKET_EXPIRED'   ? L('Expiré', 'Expired')
                :                                            L('En attente', 'Pending');
      setKo(n => n + 1);
      setHistory(prev => [{ id, at: now, outcome: 'KO' as const, message: msg }, ...prev].slice(0, HISTORY_LIMIT));
      showToast(`✗ ${msg}`, false);
      return;
    }

    const tripIdFromLookup = lookup.trip?.id;
    if (!tripIdFromLookup) {
      setKo(n => n + 1);
      showToast(L('✗ Trajet inconnu', '✗ Unknown trip'), false);
      return;
    }

    const txUrl = lookup.nextAction === 'CHECK_IN'
      ? `/api/tenants/${tenantId}/flight-deck/trips/${tripIdFromLookup}/passengers/${lookup.ticket.id}/check-in`
      : `/api/tenants/${tenantId}/flight-deck/trips/${tripIdFromLookup}/passengers/${lookup.ticket.id}/board`;
    const method = lookup.nextAction === 'CHECK_IN' ? 'POST' : 'PATCH';
    const idempotencyKey = `${lookup.nextAction === 'CHECK_IN' ? 'check-in' : 'board'}:${lookup.ticket.id}`;

    if (method === 'POST') {
      await apiPost(txUrl, {}, { skipAuthRedirect: true, headers: { 'Idempotency-Key': idempotencyKey } });
    } else {
      await (await import('../api/client')).apiPatch(txUrl, {}, { skipAuthRedirect: true, headers: { 'Idempotency-Key': idempotencyKey } });
    }

    setOk(n => n + 1);
    const label = lookup.nextAction === 'CHECK_IN' ? L('Enregistré', 'Checked in') : L('Embarqué', 'Boarded');
    setHistory(prev => [{ id, at: now, outcome: 'OK' as const, message: `${label} — ${lookup.ticket.passengerName}` }, ...prev].slice(0, HISTORY_LIMIT));
    showToast(`✓ ${label}`, true);
  }

  /**
   * Scan rafale colis : `/scan/parcel` lookup → mappe `nextAction` (LOAD /
   * ARRIVE / DELIVER / ALREADY_*) vers `POST /parcels/:id/scan { action }`.
   * Le backend rejette LOAD si `Trip.freightClosedAt` est posé.
   */
  async function handleParcelScan(code: string, id: string, now: number) {
    if (!online) {
      await enqueueMutation({
        tenantId, kind: 'scan.parcel.offline', method: 'POST',
        url:  `/api/tenants/${tenantId}/scan/parcel?code=${encodeURIComponent(code)}`,
        body: {}, idempotencyKey: `scan-parcel:${code}`,
      });
      setHistory(prev => [{ id, at: now, outcome: 'QUEUED' as const, message: L('Mis en file', 'Queued') }, ...prev].slice(0, HISTORY_LIMIT));
      showToast(L('En file — resync bientôt', 'Queued — syncs soon'), true);
      return;
    }

    const lookupUrl = `/api/tenants/${tenantId}/scan/parcel?code=${encodeURIComponent(code)}`;
    const lookup = await apiGet<{
      parcel: { id: string; trackingCode: string };
      nextAction: 'LOAD' | 'ARRIVE' | 'DELIVER' | 'ALREADY_LOADED' | 'ALREADY_DELIVERED' | 'CANCELLED' | 'NEEDS_SHIPMENT' | 'PACK';
    }>(lookupUrl, { skipAuthRedirect: true });

    // Cas idempotents / refus métier — pas d'appel transition.
    if (lookup.nextAction === 'ALREADY_LOADED') {
      setHistory(prev => [{ id, at: now, outcome: 'OK' as const, message: L('Déjà chargé', 'Already loaded') }, ...prev].slice(0, HISTORY_LIMIT));
      showToast(L('ℹ Déjà chargé', 'ℹ Already loaded'), true, 'info');
      return;
    }
    if (lookup.nextAction === 'ALREADY_DELIVERED') {
      setHistory(prev => [{ id, at: now, outcome: 'OK' as const, message: L('Déjà livré', 'Already delivered') }, ...prev].slice(0, HISTORY_LIMIT));
      showToast(L('ℹ Déjà livré', 'ℹ Already delivered'), true, 'info');
      return;
    }
    if (lookup.nextAction === 'CANCELLED' || lookup.nextAction === 'NEEDS_SHIPMENT' || lookup.nextAction === 'PACK') {
      const msg = lookup.nextAction === 'CANCELLED'      ? L('Annulé / perdu', 'Cancelled / lost')
                : lookup.nextAction === 'NEEDS_SHIPMENT' ? L('Pas de shipment', 'No shipment')
                :                                          L('À empaqueter', 'To pack');
      setKo(n => n + 1);
      setHistory(prev => [{ id, at: now, outcome: 'KO' as const, message: msg }, ...prev].slice(0, HISTORY_LIMIT));
      showToast(`✗ ${msg}`, false);
      return;
    }

    // Transition exécutable.
    const action = lookup.nextAction; // LOAD | ARRIVE | DELIVER
    const txUrl = `/api/tenants/${tenantId}/parcels/${lookup.parcel.id}/scan`;
    await apiPost(txUrl, { action }, {
      skipAuthRedirect: true,
      headers: { 'Idempotency-Key': `parcel-${action.toLowerCase()}:${lookup.parcel.id}` },
    });

    setOk(n => n + 1);
    const label = action === 'LOAD'    ? L('Chargé', 'Loaded')
                : action === 'ARRIVE'  ? L('Arrivé', 'Arrived')
                :                        L('Livré', 'Delivered');
    setHistory(prev => [{ id, at: now, outcome: 'OK' as const, message: `${label} — ${lookup.parcel.trackingCode}` }, ...prev].slice(0, HISTORY_LIMIT));
    showToast(`✓ ${label}`, true);
  }

  const onScanned = useCallback(async (token: string) => {
    const tk = token.trim();
    if (!tk) return;

    // Dedup : même token vu récemment ?
    const now = Date.now();
    const last = recentTokens.current.get(tk);
    if (last && now - last < SCAN_DEDUP_MS) return;
    recentTokens.current.set(tk, now);

    const code = parseQrToken(tk);
    const id = `${now}-${tk.slice(-6)}`;

    try {
      if (scanType === 'parcel') {
        await handleParcelScan(code, id, now);
      } else {
        await handleTicketScan(code, id, now);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e));
      setKo(n => n + 1);
      setHistory(prev => [{ id, at: now, outcome: 'KO' as const, message: msg }, ...prev].slice(0, HISTORY_LIMIT));
      showToast(`✗ ${msg}`, false);
    }
  }, [tenantId, online, mode, scanType]);

  /**
   * Retour arrière — demande confirmation si des scans ont été faits.
   *
   * Cross-platform : on utilise un <Modal /> React Native (fonctionne sur
   * iOS/Android/Web sans dépendre du polyfill de Alert.alert qui est cassé
   * sur Expo Web). Sans scans, retour direct sans confirmation.
   */
  function handleExit() {
    if (ok + ko === 0) {
      nav.goBack();
      return;
    }
    setExitConfirmOpen(true);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={handleExit} accessibilityRole="button" style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: colors.text }]}>
            {scanType === 'parcel' ? L('Scan rafale colis', 'Bulk parcel scan') : L('Scan rafale', 'Bulk scan')}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {L('OK', 'OK')} : {ok}  ·  {L('Refus', 'Refused')} : {ko}
          </Text>
        </View>
        <Pressable
          onPress={() => setScannerOpen(s => !s)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.toggleBtn,
            { backgroundColor: scannerOpen ? colors.primary : colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={{ color: scannerOpen ? colors.primaryFg : colors.text, fontWeight: '700' }}>
            {scannerOpen ? L('Pause', 'Pause') : L('Reprendre', 'Resume')}
          </Text>
        </Pressable>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {/* Toggle Type — Billet vs Colis. Toujours rendu : un agent quai ou
          chauffeur enchaîne fréquemment les deux dans la même session
          (passagers PUIS colis avant départ). Les deux scans utilisent le
          même bandeau caméra ; on bascule juste l'endpoint cible. */}
      <View style={styles.modeRow}>
        <Pressable
          onPress={() => setScanType('ticket')}
          accessibilityRole="radio"
          accessibilityState={{ selected: scanType === 'ticket' }}
          style={[
            styles.modeBtn,
            {
              backgroundColor: scanType === 'ticket' ? colors.primary : colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={{ color: scanType === 'ticket' ? colors.primaryFg : colors.text, fontWeight: '700', fontSize: 13 }}>
            🎫 {L('Billets', 'Tickets')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setScanType('parcel')}
          accessibilityRole="radio"
          accessibilityState={{ selected: scanType === 'parcel' }}
          style={[
            styles.modeBtn,
            {
              backgroundColor: scanType === 'parcel' ? colors.primary : colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={{ color: scanType === 'parcel' ? colors.primaryFg : colors.text, fontWeight: '700', fontSize: 13 }}>
            📦 {L('Colis', 'Parcels')}
          </Text>
        </Pressable>
      </View>

      {/* Toggle Check-in / Board — visible seulement si scanType=ticket ET perm
          + blueprint autorisent les deux. Par défaut check-in (UX agent gare). */}
      {scanType === 'ticket' && caps?.canCheckIn && caps?.canBoard && (
        <View style={styles.modeRow}>
          <Pressable
            onPress={() => setMode('check-in')}
            accessibilityRole="radio"
            accessibilityState={{ selected: mode === 'check-in' }}
            style={[
              styles.modeBtn,
              {
                backgroundColor: mode === 'check-in' ? colors.primary : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={{ color: mode === 'check-in' ? colors.primaryFg : colors.text, fontWeight: '700', fontSize: 13 }}>
              ✓ {L('Check-in gare', 'Gate check-in')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('board')}
            accessibilityRole="radio"
            accessibilityState={{ selected: mode === 'board' }}
            style={[
              styles.modeBtn,
              {
                backgroundColor: mode === 'board' ? colors.primary : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={{ color: mode === 'board' ? colors.primaryFg : colors.text, fontWeight: '700', fontSize: 13 }}>
              → {L('Embarquement', 'Boarding')}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Feedback scan unifié (vibration + beep web + banner) */}
      <ScanToastBanner toast={toast} />

      <Text style={[styles.h2, { color: colors.text, paddingHorizontal: 16 }]}>
        {L('Historique (20 derniers)', 'History (last 20)')}
      </Text>

      <FlatList
        data={history}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, gap: 6 }}
        ListEmptyComponent={
          <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 16 }}>
            {L('Aucun scan pour le moment.', 'No scan yet.')}
          </Text>
        }
        renderItem={({ item }) => {
          const colorMap = {
            OK:     { bg: colors.successBg, fg: colors.success },
            KO:     { bg: colors.dangerBg,  fg: colors.danger  },
            QUEUED: { bg: colors.warningBg, fg: colors.warning },
          } as const;
          const c = colorMap[item.outcome];
          return (
            <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={[styles.dot, { backgroundColor: c.bg, borderColor: c.fg }]}>
                <Text style={{ color: c.fg, fontWeight: '800', fontSize: 11 }}>{item.outcome}</Text>
              </View>
              <Text style={{ color: colors.text, fontSize: 12, flex: 1 }} numberOfLines={2}>
                {item.message}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                {new Date(item.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        }}
      />

      <QrScanner
        visible={scannerOpen}
        onScanned={onScanned}
        onClose={() => setScannerOpen(false)}
        persistent
      />

      {/* Modal de confirmation sortie — cross-platform fiable, remplace
          Alert.alert qui est cassé sur Expo Web. */}
      <Modal
        visible={exitConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setExitConfirmOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {L('Quitter le mode rafale ?', 'Exit bulk mode?')}
            </Text>
            <Text style={[styles.modalBody, { color: colors.textMuted }]}>
              {L(
                `${ok + ko} scans — l'historique sera perdu à la prochaine ouverture.`,
                `${ok + ko} scans — history is lost on next open.`,
              )}
            </Text>
            <View style={styles.modalRow}>
              <Pressable
                onPress={() => setExitConfirmOpen(false)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {L('Annuler', 'Cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setExitConfirmOpen(false); nav.goBack(); }}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: colors.danger, borderColor: colors.danger, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {L('Quitter', 'Exit')}
                </Text>
              </Pressable>
            </View>
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
  h2:        { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 4 },
  toggleBtn: { paddingHorizontal: 12, height: 40, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modeRow:   { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 8 },
  modeBtn:   { flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard:     { width: '100%', maxWidth: 420, borderRadius: 16, borderWidth: 1, padding: 20, gap: 14 },
  modalTitle:    { fontSize: 16, fontWeight: '800' },
  modalBody:     { fontSize: 14, lineHeight: 20 },
  modalRow:      { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtn:      { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  banner:    { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  toast:     { marginHorizontal: 16, padding: 12, borderRadius: 8, borderWidth: 1 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, borderWidth: 1 },
  dot:       { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
});
