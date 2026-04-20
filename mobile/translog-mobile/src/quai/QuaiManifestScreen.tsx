/**
 * QuaiManifestScreen — Génération + signature géolocalisée du manifest trip.
 *
 * Flux :
 *   1. Choisir trip (status BOARDING | IN_PROGRESS | COMPLETED)
 *   2. Générer manifest : POST /manifests/trips/:tripId { kind: 'ALL' }
 *      → idempotent côté back : renvoie l'existant si déjà créé.
 *   3. Capturer GPS (opt-in)
 *   4. Signer (SignaturePad)
 *   5. POST /manifests/:id/sign  — la signature SVG inclut un geo-stamp dans
 *      un commentaire XML pour audit (pas de modif schema Prisma requise).
 *
 * Offline :
 *   - generate() + sign() partent en outbox (idempotency-key sur manifestId)
 *     mais la signature requiert un manifestId connu ; si aucun manifest n'a
 *     encore été généré online, on bloque la signature offline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import * as Location from 'expo-location';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';
import { SignaturePad, type SignaturePadRef } from '../manifests/SignaturePad';
import { LiveManifestPanel } from '../ui/LiveManifestPanel';

// Borne coordonnées GPS — évite qu'un device HS écrive 999°.
const LAT_MIN = -90;   const LAT_MAX = 90;
const LNG_MIN = -180;  const LNG_MAX = 180;

interface TripItem {
  id:                 string;
  departureScheduled: string;
  status:             string;
  route?: { origin?: { name: string }; destination?: { name: string } };
}

interface Manifest {
  id:                   string;
  tripId:               string;
  status:               string;
  kind?:                string;
  passengerCount:       number;
  parcelCount:          number;
  signedAt:             string | null;
  signatureSvg:         string | null;
  storageKey?:          string | null;
  signedPdfStorageKey?: string | null;
}

function validCoord(v: number, min: number, max: number): boolean {
  return Number.isFinite(v) && v >= min && v <= max;
}

function embedGeoStamp(
  svg: string,
  gps: { lat: number; lng: number } | null,
  actorId: string,
): string {
  // On injecte un commentaire XML juste après la balise <svg …> — audit trail
  // sans modifier le rendu. Le service de signature borne la taille du SVG à
  // 256 KB côté back, l'ajout (~100 chars) est négligeable.
  const stamp = [
    `geo:${gps ? `${gps.lat.toFixed(5)},${gps.lng.toFixed(5)}` : 'none'}`,
    `ts:${new Date().toISOString()}`,
    `actor:${actorId}`,
  ].join(' ');
  const inject = `<!-- ${stamp} -->`;
  const match = svg.match(/<svg[^>]*>/);
  if (!match) return svg + inject;
  const tagEnd = match.index! + match[0].length;
  return svg.slice(0, tagEnd) + inject + svg.slice(tagEnd);
}

export function QuaiManifestScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const padRef = useRef<SignaturePadRef>(null);

  const [trips, setTrips]             = useState<TripItem[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [manifest, setManifest]       = useState<Manifest | null>(null);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [signing, setSigning]         = useState(false);
  const [gps, setGps]                 = useState<{ lat: number; lng: number } | null>(null);
  const [capturing, setCapturing]     = useState(false);
  const [hasInk, setHasInk]           = useState(false);

  const loadTrips = useCallback(async () => {
    if (!tenantId) return;
    setLoadingTrips(true);
    try {
      const res = await apiGet<TripItem[]>(
        `/api/tenants/${tenantId}/trips?status=BOARDING&status=IN_PROGRESS&status=COMPLETED`,
        { skipAuthRedirect: true },
      );
      setTrips([...res].sort((a, b) =>
        new Date(b.departureScheduled).getTime() - new Date(a.departureScheduled).getTime(),
      ));
    } catch { /* offline */ }
    finally { setLoadingTrips(false); }
  }, [tenantId]);

  useEffect(() => { void loadTrips(); }, [loadTrips]);

  async function selectTrip(tripId: string) {
    setSelectedTripId(tripId);
    setManifest(null);
    padRef.current?.clear(); setHasInk(false);
    // Charge manifest existant si déjà généré
    try {
      const existing = await apiGet<Manifest[]>(
        `/api/tenants/${tenantId}/manifests/trips/${tripId}`,
        { skipAuthRedirect: true },
      );
      const all = existing.find(m => m.status !== 'REJECTED') ?? null;
      setManifest(all);
    } catch { /* pas de manifest pré-existant */ }
  }

  /**
   * Ouvre le PDF figé du manifeste signé. Le backend renvoie une URL S3 signée
   * (validité courte) — on la passe à Linking pour que le viewer natif (Safari
   * iOS / Chrome Android / browser sur Web) prenne le relais.
   *
   * Pré-condition : manifest.signedPdfStorageKey != null. Le bouton est masqué
   * sinon. Si la régénération PDF a foiré (le service la fait en best-effort),
   * un POST /backfill-signed-pdfs côté admin la relance.
   */
  async function downloadManifest() {
    if (!manifest?.id) return;
    try {
      const Linking = await import('react-native').then(m => m.Linking);
      const res = await apiGet<string | { downloadUrl?: string }>(
        `/api/tenants/${tenantId}/manifests/${manifest.id}/download`,
        { skipAuthRedirect: true },
      );
      const url = typeof res === 'string' ? res : res?.downloadUrl;
      if (!url) {
        Alert.alert(L('PDF indisponible', 'PDF unavailable'),
          L('Le PDF figé n\'est pas encore généré. Réessayez dans un instant.',
            'The signed PDF is not yet generated. Try again in a moment.'));
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert(L('Erreur téléchargement', 'Download error'),
        e instanceof Error ? e.message : String(e));
    }
  }

  async function generateManifest() {
    if (!selectedTripId) return;
    setGenerating(true);
    try {
      const m = await apiPost<Manifest>(
        `/api/tenants/${tenantId}/manifests/trips/${selectedTripId}`,
        { kind: 'ALL' },
        { skipAuthRedirect: true },
      );
      setManifest(m);
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function captureGps() {
    setCapturing(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(L('Permission refusée', 'Permission denied'),
          L('Activez la géolocalisation dans les réglages.', 'Enable location in settings.'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (!validCoord(lat, LAT_MIN, LAT_MAX) || !validCoord(lng, LNG_MIN, LNG_MAX)) {
        Alert.alert('GPS', L('Coordonnées invalides.', 'Invalid coordinates.'));
        return;
      }
      setGps({ lat, lng });
    } catch (e) {
      Alert.alert('GPS', e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  }

  async function signManifest() {
    if (!manifest) return;
    const raw = padRef.current?.toSvg();
    if (!raw) {
      Alert.alert(L('Signature vide', 'Signature empty'));
      return;
    }
    const stamped = embedGeoStamp(raw, gps, user?.id ?? 'unknown');
    setSigning(true);
    try {
      const url = `/api/tenants/${tenantId}/manifests/${manifest.id}/sign`;
      const body = { signatureSvg: stamped };
      const key = `manifest-sign:${manifest.id}`;
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'manifest.sign', method: 'POST',
          url, body, idempotencyKey: key,
        });
        Alert.alert(L('En file', 'Queued'), L('Signature à la reconnexion.', 'Will sync on reconnect.'));
      } else {
        await apiPost(url, body, { skipAuthRedirect: true, headers: { 'Idempotency-Key': key } });
        Alert.alert(L('Manifest signé', 'Manifest signed'),
          gps ? L(`Position ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)} embarquée.`,
                   `GPS ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)} embedded.`)
              : L('Signé sans GPS.', 'Signed without GPS.'));
      }
      padRef.current?.clear(); setHasInk(false);
      setManifest(m => m ? { ...m, status: 'SIGNED', signedAt: new Date().toISOString(), signatureSvg: stamped } : m);
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setSigning(false);
    }
  }

  const tripSelected = trips.find(t => t.id === selectedTripId);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Manifest signé', 'Signed manifest')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* ── Sélection trip ───────────────────────────────────────────── */}
        {!selectedTripId && (
          <>
            <Text style={[styles.h2, { color: colors.text }]}>
              {L('Choisissez un trajet', 'Select a trip')}
            </Text>
            {loadingTrips && <ActivityIndicator color={colors.primary} />}
            {trips.map((tr) => (
              <Pressable
                key={tr.id}
                onPress={() => selectTrip(tr.id)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.card,
                  { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.9 : 1 },
                ]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {tr.route?.origin?.name ?? '?'} → {tr.route?.destination?.name ?? '?'}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                  {new Date(tr.departureScheduled).toLocaleString(lang, {
                    hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
                  })} · {tr.status}
                </Text>
              </Pressable>
            ))}
          </>
        )}

        {/* ── Trip sélectionné ─────────────────────────────────────────── */}
        {selectedTripId && (
          <>
            <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {tripSelected?.route?.origin?.name ?? '?'} → {tripSelected?.route?.destination?.name ?? '?'}
              </Text>
              <Pressable
                onPress={() => { setSelectedTripId(null); setManifest(null); }}
                accessibilityRole="button"
                style={{ marginTop: 4 }}
              >
                <Text style={{ color: colors.primary, fontSize: 12 }}>
                  ← {L('Changer', 'Change')}
                </Text>
              </Pressable>
            </View>

            {/* ── Manifest temps réel (compteurs + listes pax + colis) ──
                Même source que BusScreen / QuaiScreen / PageQuaiManifest web.
                Polling 5s — l'agent voit en direct qui est déjà scanné et
                quels colis sont chargés, AVANT de décider de signer. */}
            <LiveManifestPanel
              tenantId={tenantId}
              tripId={selectedTripId}
              lang={lang === 'en' ? 'en' : 'fr'}
            />

            {/* ── Manifest status ───────────────────────────────────────── */}
            {manifest ? (
              <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.h2, { color: colors.text }]}>
                  {L('Manifest', 'Manifest')}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }}>
                  {L('Statut', 'Status')} : {manifest.status}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                  {L('Passagers', 'Passengers')} : {manifest.passengerCount}
                  {' · '}
                  {L('Colis', 'Parcels')} : {manifest.parcelCount}
                </Text>
                {manifest.signedAt && (
                  <Text style={{ color: colors.success, fontSize: 12, marginTop: 4 }}>
                    {L('Signé', 'Signed')} {new Date(manifest.signedAt).toLocaleString(lang)}
                  </Text>
                )}

                {/* Preuve visuelle — affichage de la signature SVG après commit.
                    Sans ce rendu, le pad est vidé après signature et la
                    section signature est masquée → l'utilisateur perçoit
                    que sa signature a "disparu". On la garde visible comme
                    attestation. Le SVG vient soit de la sign() locale (état
                    optimiste), soit du serveur après reload (toDto inclut
                    signatureSvg depuis 2026-04-19). */}
                {manifest.status === 'SIGNED' && manifest.signatureSvg && (
                  <View style={[styles.signatureBox, { borderColor: colors.border, backgroundColor: '#ffffff' }]}>
                    <SvgXml xml={manifest.signatureSvg} width="100%" height={120} />
                  </View>
                )}

                {/* Téléchargement PDF — visible dès qu'un PDF figé existe.
                    Si le manifeste vient juste d'être signé et que la
                    génération PDF tarde (queue, retries), on affiche un état
                    "PDF en préparation" plutôt qu'un bouton mort. */}
                {manifest.status === 'SIGNED' && (
                  manifest.signedPdfStorageKey ? (
                    <Pressable
                      onPress={downloadManifest}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        { backgroundColor: colors.primary, marginTop: 10, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                        📄  {L('Voir / télécharger le PDF', 'View / download PDF')}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>
                      ⏳ {L('PDF en préparation… (réessayer dans 1 min)',
                            'PDF being generated… (retry in 1 min)')}
                    </Text>
                  )
                )}
              </View>
            ) : (
              <Pressable
                onPress={generateManifest}
                disabled={generating || !online}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: colors.primary, opacity: pressed || generating || !online ? 0.6 : 1 },
                ]}
              >
                {generating
                  ? <ActivityIndicator color={colors.primaryFg} />
                  : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                      {L('Générer le manifest', 'Generate manifest')}
                    </Text>}
              </Pressable>
            )}

            {/* ── Signature (seulement si manifest généré et non signé) ──── */}
            {manifest && manifest.status !== 'SIGNED' && (
              <>
                <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={[styles.h2, { color: colors.text }]}>
                    {L('Position GPS', 'GPS location')}
                  </Text>
                  <Pressable
                    onPress={captureGps}
                    disabled={capturing}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.ghostBtn,
                      { borderColor: colors.border, opacity: pressed || capturing ? 0.6 : 1 },
                    ]}
                  >
                    {capturing
                      ? <ActivityIndicator color={colors.primary} />
                      : <Text style={{ color: colors.text, fontWeight: '600' }}>
                          {gps
                            ? L('Mettre à jour position', 'Refresh location')
                            : L('Capturer ma position (optionnel)', 'Capture my location (optional)')}
                        </Text>}
                  </Pressable>
                  {gps && (
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>
                      {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
                    </Text>
                  )}
                </View>

                <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={[styles.h2, { color: colors.text, marginBottom: 6 }]}>
                    {L('Signature', 'Signature')}
                  </Text>
                  <SignaturePad ref={padRef} onChange={setHasInk} background="#ffffff" />
                  <Pressable
                    onPress={() => { padRef.current?.clear(); setHasInk(false); }}
                    accessibilityRole="button"
                    style={[styles.ghostBtn, { borderColor: colors.border }]}
                  >
                    <Text style={{ color: colors.text }}>{L('Effacer', 'Clear')}</Text>
                  </Pressable>
                </View>

                <Pressable
                  onPress={signManifest}
                  disabled={signing || !hasInk}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: colors.primary, opacity: signing || !hasInk || pressed ? 0.6 : 1 },
                  ]}
                >
                  {signing
                    ? <ActivityIndicator color={colors.primaryFg} />
                    : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                        {L('Signer le manifest', 'Sign manifest')}
                      </Text>}
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:       { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:         { fontSize: 18, fontWeight: '800' },
  h2:         { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  banner:     { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  card:       { padding: 14, borderRadius: 12, borderWidth: 1, gap: 4 },
  ghostBtn:   { marginTop: 8, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  primaryBtn: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  signatureBox: { marginTop: 10, borderRadius: 10, borderWidth: 1, padding: 8, minHeight: 130, alignItems: 'center', justifyContent: 'center' },
});
