/**
 * ParcelScanScreen — Scan chargement colis au départ + manifest trip.
 *
 * Flux :
 *   - Liste des colis attendus via le trip (shipments.parcels)
 *   - Scan QR = extraction trackingCode → GET /parcels/track/:code pour le résoudre
 *   - POST /parcels/:id/scan { action: 'LOAD', stationId } avec idempotency-key
 *   - Quand tout chargé : POST /manifests/trips/:tripId pour générer le manifest
 *
 * Sécurité : PARCEL_SCAN_AGENCY + MANIFEST_GENERATE_AGENCY (perms driver OK).
 * Offline : toutes les mutations via outbox avec idempotency-key par parcelId.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, Alert, StyleSheet, ActivityIndicator, TextInput,
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

type ParcelNextAction = 'LOAD' | 'ARRIVE' | 'DELIVER' | 'ALREADY_LOADED' | 'ALREADY_DELIVERED' | 'CANCELLED' | 'NEEDS_SHIPMENT' | 'PACK';

interface ParcelLookupResponse {
  parcel:     { id: string; trackingCode: string; status: string; destinationCity: string | null; weight: number };
  trip:       { id: string; routeLabel: string } | null;
  nextAction: ParcelNextAction;
}

interface ParcelRow {
  id:             string;
  trackingCode:   string;
  status:         string;
  weight?:        number;
  destination?:   { id: string; name: string } | null;
  senderCustomerId?: string | null;
}

/** URL QR parcel publique = `/verify/parcel/:trackingCode`. */
function parseParcelCode(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/\/verify\/parcel\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : trimmed;
}

interface TripWithShipments {
  route?: { origin?: { id: string } };
  shipments?: Array<{ parcels: ParcelRow[] }>;
}

export function ParcelScanScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const { tripId } = (useRoute().params ?? {}) as { tripId?: string };
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [originStationId, setOriginStationId] = useState<string | null>(null);
  const [parcels, setParcels] = useState<ParcelRow[]>([]);
  const [loaded, setLoaded]   = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualCode, setManualCode]   = useState('');
  const { toast, show: showFeedback } = useScanFeedback();

  const refresh = useCallback(async () => {
    if (!tenantId || !tripId) return;
    try {
      const trip = await apiGet<TripWithShipments>(
        `/api/tenants/${tenantId}/trips/${tripId}`,
        { skipAuthRedirect: true },
      );
      setOriginStationId(trip.route?.origin?.id ?? null);
      const all = (trip.shipments ?? []).flatMap(s => s.parcels);
      setParcels(all);
      setLoaded(new Set(all.filter(p => p.status === 'IN_TRANSIT' || p.status === 'AT_HUB').map(p => p.id)));
    } catch { /* offline : on garde */ }
  }, [tenantId, tripId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  /**
   * Scan d'un colis — délègue la décision de l'action au blueprint via
   * `/scan/parcel?code=X`. Auparavant on forçait toujours `LOAD`, ce qui
   * générait des 400 sur les colis déjà en transit / livrés. Maintenant :
   *   - AT_ORIGIN / PACKED  → LOAD
   *   - LOADED / IN_TRANSIT → ARRIVE (si le chauffeur scanne à destination)
   *   - ARRIVED             → DELIVER
   *   - DELIVERED / CANCELLED → refus avec feedback clair
   *
   * La transition passe par `/parcels/:id/scan` qui est déjà branché au
   * WorkflowEngine (blueprint Parcel). Zéro hardcode d'état côté client.
   */
  async function scanParcel(raw: string) {
    if (!originStationId) {
      showFeedback({ kind: 'error', title: L('✕ Gare manquante', '✕ Missing station'), subtitle: L('Gare d\'origine du trip introuvable.', 'Origin station missing on trip.') });
      return;
    }
    const code = parseParcelCode(raw);
    setBusy(true);
    try {
      // Offline : on ne peut pas faire le lookup ; on enqueue une action LOAD
      // par défaut (la plus fréquente pour un chauffeur au départ). Le rejeu
      // backend appliquera ou rejettera selon le blueprint.
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'parcel.scan.offline', method: 'POST',
          url:  `/api/tenants/${tenantId}/scan/parcel?code=${encodeURIComponent(code)}`,
          body: {}, idempotencyKey: `scan-parcel:${code}`,
        });
        showFeedback({ kind: 'info', title: L('⏳ En file', '⏳ Queued'), subtitle: L('Scan différé.', 'Will sync on reconnect.') });
        return;
      }

      // 1. Lookup via /scan/parcel : résout le parcel + propose nextAction
      const lookupUrl = `/api/tenants/${tenantId}/scan/parcel?code=${encodeURIComponent(code)}`;
      const lookup = await apiGet<ParcelLookupResponse>(lookupUrl, { skipAuthRedirect: true });

      // 2. Refus métier avant transition (feedback clair, aucun 400 tenté).
      if (lookup.nextAction === 'ALREADY_DELIVERED') {
        showFeedback({ kind: 'warning', title: L('⚠ Déjà livré', '⚠ Already delivered'), subtitle: lookup.parcel.trackingCode });
        return;
      }
      if (lookup.nextAction === 'ALREADY_LOADED') {
        showFeedback({ kind: 'info', title: L('⏳ Déjà chargé', '⏳ Already loaded'), subtitle: L('Attend le départ du bus', 'Waiting for bus departure') });
        return;
      }
      if (lookup.nextAction === 'NEEDS_SHIPMENT') {
        showFeedback({ kind: 'warning', title: L('📋 À regrouper', '📋 Needs shipment'), subtitle: L('Ajouter à un shipment avant le chargement', 'Add to shipment before loading') });
        return;
      }
      if (lookup.nextAction === 'CANCELLED') {
        showFeedback({ kind: 'error', title: L('✕ Colis hors circuit', '✕ Parcel out of flow'), subtitle: L('Annulé / perdu / endommagé', 'Cancelled / lost / damaged') });
        return;
      }
      if (lookup.nextAction === 'PACK') {
        showFeedback({ kind: 'warning', title: L('⚠ Pas prêt', '⚠ Not ready'), subtitle: L('Colis pas encore emballé.', 'Parcel not packed yet.') });
        return;
      }

      // 3. Transition via /parcels/:id/scan (WorkflowEngine).
      const parcelId = lookup.parcel.id;
      const url = `/api/tenants/${tenantId}/parcels/${parcelId}/scan`;
      const body = { action: lookup.nextAction, stationId: originStationId };
      const key = `parcel-scan:${parcelId}:${lookup.nextAction}`;
      await apiPost(url, body, { skipAuthRedirect: true, headers: { 'Idempotency-Key': key } });

      // 4. Sync local + feedback.
      setLoaded(prev => new Set(prev).add(parcelId));
      const label = lookup.nextAction === 'LOAD'    ? L('Chargé', 'Loaded')
                  : lookup.nextAction === 'ARRIVE'  ? L('Arrivée validée', 'Arrival confirmed')
                  : lookup.nextAction === 'DELIVER' ? L('Livré', 'Delivered')
                  :                                   lookup.nextAction;
      showFeedback({ kind: 'success', title: `✓ ${label}`, subtitle: lookup.parcel.trackingCode });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e));
      showFeedback({ kind: 'error', title: L('✕ Erreur', '✕ Error'), subtitle: msg });
    } finally {
      setBusy(false);
    }
  }

  async function generateManifest() {
    setBusy(true);
    try {
      const url = `/api/tenants/${tenantId}/manifests/trips/${tripId}`;
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'manifest.generate', method: 'POST',
          url, body: {}, idempotencyKey: `manifest-generate:${tripId}`,
        });
        Alert.alert(L('En file', 'Queued'), L('Manifest sera généré à la reconnexion.', 'Manifest will be generated on reconnect.'));
      } else {
        await apiPost(url, {}, { skipAuthRedirect: true });
        Alert.alert(L('Manifest généré', 'Manifest generated'), L('Vous pouvez le signer.', 'You can sign it now.'));
      }
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const counters = useMemo(() => ({
    total:  parcels.length,
    loaded: parcels.filter(p => loaded.has(p.id)).length,
  }), [parcels, loaded]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: colors.text }]}>
            {L('Chargement colis', 'Parcel loading')}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {counters.loaded} / {counters.total} {L('chargés', 'loaded')}
          </Text>
        </View>
      </View>

      {/* Feedback scan (banner + vibration + beep web) */}
      <ScanToastBanner toast={toast} />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <View style={{ padding: 16, gap: 10 }}>
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
            {L('Scanner un colis', 'Scan a parcel')}
          </Text>
        </Pressable>

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>
            {L('Ou saisir un code de suivi :', 'Or enter a tracking code:')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={manualCode}
              onChangeText={setManualCode}
              autoCapitalize="characters"
              placeholder="TRK-…"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background, flex: 1 }]}
            />
            <Pressable
              onPress={() => { const c = manualCode.trim(); if (c) { setManualCode(''); void scanParcel(c); } }}
              disabled={busy || !manualCode.trim()}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.smallBtn,
                { backgroundColor: colors.primary, opacity: busy || !manualCode.trim() || pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {loading && parcels.length === 0 && <ActivityIndicator color={colors.primary} />}

      <FlatList
        data={parcels}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 8 }}
        ListEmptyComponent={
          !loading ? (
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 16 }}>
              {L('Aucun colis attendu pour ce trajet.', 'No parcel expected for this trip.')}
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const done = loaded.has(item.id);
          return (
            <View
              style={[
                styles.row,
                {
                  borderColor: done ? colors.success : colors.border,
                  backgroundColor: done ? colors.successBg : colors.surface,
                },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                  {item.trackingCode}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  → {item.destination?.name ?? '?'}
                  {item.weight ? ` · ${item.weight} kg` : ''}
                </Text>
              </View>
              <Text style={{
                color: done ? colors.success : colors.textMuted,
                fontSize: 11, fontWeight: '800',
              }}>
                {done ? L('CHARGÉ', 'LOADED') : item.status}
              </Text>
            </View>
          );
        }}
      />

      <View style={styles.footer}>
        <Pressable
          onPress={generateManifest}
          disabled={busy || parcels.length === 0}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: colors.primary, opacity: busy || parcels.length === 0 || pressed ? 0.5 : 1 },
          ]}
        >
          {busy
            ? <ActivityIndicator color={colors.primaryFg} />
            : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                {L('Générer le manifest', 'Generate manifest')}
              </Text>}
        </Pressable>
      </View>

      <QrScanner
        visible={scannerOpen}
        onScanned={(data) => { setScannerOpen(false); void scanParcel(data); }}
        onClose={() => setScannerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:         { fontSize: 18, fontWeight: '800' },
  back:       { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:     { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  scanBtn:    { height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  card:       { padding: 14, borderRadius: 12, borderWidth: 1 },
  input:      { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  smallBtn:   { minHeight: 44, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  row:        { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, gap: 10 },
  footer:     { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: 'transparent' },
  primaryBtn: { height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
