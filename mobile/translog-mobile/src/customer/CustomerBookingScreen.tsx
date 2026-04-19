/**
 * CustomerBookingScreen — Réservation complète pour le voyageur authentifié.
 *
 * 4 étapes :
 *   1. Recherche : origine, destination, date (ISO), pax
 *   2. Sélection trajet (liste résultats)
 *   3. Passager + siège (seatmap — carte 2D simple, sélectionne siège libre)
 *   4. Paiement : CASH au guichet | MOBILE_MONEY | CARD
 *      → POST /public/:slug/portal/booking
 *      → Redirection `paymentUrl` si fourni ; sinon polling côté serveur
 *        (le booking endpoint crée un PaymentIntent automatiquement).
 *
 * Sécurité :
 *   - Endpoints publics (slug-based, rate-limited côté back)
 *   - Pas de magic number : STEP_COUNT + PAX bornes + polling bornes
 *   - Idempotency natif via rate-limit + tripId+passengers[].phone unique côté back
 *
 * i18n : FR + EN inline ; autres locales → TODO.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

// Bornes
const STEP_COUNT    = 4;
const MIN_PAX       = 1;
const MAX_PAX       = 9;
const NAME_MIN_LEN  = 2;
const PHONE_MIN_LEN = 6;

type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'CARD';

interface Station { id: string; name: string; city: string | null; }
interface TripHit {
  id:                 string;
  departureScheduled: string;
  arrivalScheduled:   string;
  price:              number;
  currency:           string;
  route: { origin: { name: string }; destination: { name: string } };
  bus:  { model: string | null; plate: string };
  seatsAvailable:     number;
}
interface Seat {
  row: number;
  col: number;
  label: string;
  occupied: boolean;
}
interface SeatmapRes {
  capacity: number;
  layout: Seat[]; // peut être simplifié — on tolère une grille 4 cols
}
interface BookingRes {
  bookingId:   string;
  ticketIds:   string[];
  paymentUrl:  string | null;
  status:      string;
}

export function CustomerBookingScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const slug = user?.tenantSlug ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  // État wizard
  const [step, setStep] = useState(1);

  // Step 1 : recherche
  const [stations, setStations]   = useState<Station[]>([]);
  const [originId, setOriginId]   = useState<string | null>(null);
  const [destId, setDestId]       = useState<string | null>(null);
  const [date, setDate]           = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [pax, setPax]             = useState(1);

  // Step 2 : résultats
  const [trips, setTrips]         = useState<TripHit[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  // Step 3 : passager + seatmap
  const [seatmap, setSeatmap]     = useState<SeatmapRes | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [phone, setPhone]         = useState('');

  // Step 4 : paiement
  const [payment, setPayment]     = useState<PaymentMethod>('MOBILE_MONEY');
  const [submitting, setSubmitting] = useState(false);

  const loadStations = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await apiGet<Station[]>(
        `/api/public/${slug}/portal/stations`,
        { skipAuthRedirect: true },
      );
      setStations(res ?? []);
    } catch { /* silent */ }
  }, [slug]);

  useEffect(() => { void loadStations(); }, [loadStations]);

  const selectedTrip = useMemo(() => trips.find(t => t.id === selectedTripId) ?? null, [trips, selectedTripId]);

  async function searchTrips() {
    if (!originId || !destId) return;
    setSearching(true);
    try {
      const qs = new URLSearchParams({
        origin:      originId,
        destination: destId,
        date,
        pax: String(pax),
      });
      const res = await apiGet<TripHit[]>(
        `/api/public/${slug}/portal/trips/search?${qs.toString()}`,
        { skipAuthRedirect: true },
      );
      setTrips(res ?? []);
      setStep(2);
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  async function loadSeatmap(tripId: string) {
    try {
      const res = await apiGet<SeatmapRes>(
        `/api/public/${slug}/portal/trips/${tripId}/seats`,
        { skipAuthRedirect: true },
      );
      setSeatmap(res ?? { capacity: 0, layout: [] });
    } catch { setSeatmap({ capacity: 0, layout: [] }); }
  }

  async function confirmBooking() {
    if (!selectedTrip) return;
    setSubmitting(true);
    try {
      const body = {
        tripId: selectedTrip.id,
        passengers: [{
          firstName:          firstName.trim(),
          lastName:           lastName.trim(),
          phone:              phone.trim(),
          email:              user?.email ?? null,
          wantsSeatSelection: Boolean(selectedSeat),
          seatNumber:         selectedSeat ?? undefined,
        }],
        paymentMethod: payment,
      };
      const res = await apiPost<BookingRes>(
        `/api/public/${slug}/portal/booking`,
        body,
        { skipAuthRedirect: true },
      );
      if (res.paymentUrl) {
        Alert.alert(
          L('Paiement', 'Payment'),
          L(`Suivez l'instruction envoyée sur ${phone}.`, `Follow the prompt sent to ${phone}.`),
        );
      } else {
        Alert.alert(
          L('Réservation confirmée', 'Booking confirmed'),
          L(`Billet ${res.ticketIds[0].slice(-8)} — présentez-vous 30 min avant le départ.`,
            `Ticket ${res.ticketIds[0].slice(-8)} — be at the station 30 min before departure.`),
        );
      }
      nav.goBack();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function canNext(): boolean {
    if (step === 1) return Boolean(originId && destId && date && pax >= MIN_PAX && pax <= MAX_PAX);
    if (step === 2) return Boolean(selectedTripId);
    if (step === 3) return firstName.trim().length >= NAME_MIN_LEN
      && lastName.trim().length >= NAME_MIN_LEN
      && phone.trim().length >= PHONE_MIN_LEN;
    return true;
  }

  async function nextStep() {
    if (step === 1) { await searchTrips(); return; }
    if (step === 2 && selectedTripId) { await loadSeatmap(selectedTripId); setStep(3); return; }
    setStep(s => Math.min(STEP_COUNT, s + 1));
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: colors.text }]}>
            {L('Réserver', 'Book a trip')}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {L(`Étape ${step}/${STEP_COUNT}`, `Step ${step}/${STEP_COUNT}`)}
          </Text>
        </View>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {!slug && (
        <View style={[styles.banner, { backgroundColor: colors.dangerBg }]}>
          <Text style={{ color: colors.danger }}>
            {L('Tenant slug manquant — reconnectez-vous.', 'Missing tenant slug — please re-login.')}
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* ── STEP 1 ────────────────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <StationPicker
              label={L('Départ', 'Origin')}
              stations={stations}
              value={originId}
              onChange={setOriginId}
              colors={colors}
            />
            <StationPicker
              label={L('Arrivée', 'Destination')}
              stations={stations.filter(s => s.id !== originId)}
              value={destId}
              onChange={setDestId}
              colors={colors}
            />
            <View>
              <Text style={[styles.label, { color: colors.text }]}>
                {L('Date (YYYY-MM-DD)', 'Date (YYYY-MM-DD)')}
              </Text>
              <TextInput
                value={date}
                onChangeText={setDate}
                autoCapitalize="none"
                accessibilityLabel="Date"
                placeholder="2026-05-01"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
              />
            </View>
            <View>
              <Text style={[styles.label, { color: colors.text }]}>
                {L('Passagers', 'Passengers')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Pressable
                  onPress={() => setPax(p => Math.max(MIN_PAX, p - 1))}
                  accessibilityRole="button"
                  style={[styles.stepBtn, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.text, fontSize: 20 }}>−</Text>
                </Pressable>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, minWidth: 40, textAlign: 'center' }}>
                  {pax}
                </Text>
                <Pressable
                  onPress={() => setPax(p => Math.min(MAX_PAX, p + 1))}
                  accessibilityRole="button"
                  style={[styles.stepBtn, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.text, fontSize: 20 }}>+</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}

        {/* ── STEP 2 ────────────────────────────────────────────────────── */}
        {step === 2 && (
          <>
            {searching && <ActivityIndicator color={colors.primary} />}
            {!searching && trips.length === 0 && (
              <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                {L('Aucun trajet trouvé.', 'No trip found.')}
              </Text>
            )}
            {trips.map(tr => {
              const selected = selectedTripId === tr.id;
              return (
                <Pressable
                  key={tr.id}
                  onPress={() => setSelectedTripId(tr.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.card,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primaryFg + '22' : colors.surface,
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {tr.route.origin.name} → {tr.route.destination.name}
                    </Text>
                    <Text style={{ color: colors.primary, fontWeight: '800' }}>
                      {tr.price.toLocaleString(lang)} {tr.currency}
                    </Text>
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                    {new Date(tr.departureScheduled).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                    {' → '}
                    {new Date(tr.arrivalScheduled).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                    {' · '} {tr.bus.model ?? tr.bus.plate}
                    {' · '} {tr.seatsAvailable} {L('places', 'seats')}
                  </Text>
                </Pressable>
              );
            })}
          </>
        )}

        {/* ── STEP 3 ────────────────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <View>
              <Text style={[styles.label, { color: colors.text }]}>
                {L('Prénom *', 'First name *')}
              </Text>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                accessibilityLabel="First name"
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
              />
            </View>
            <View>
              <Text style={[styles.label, { color: colors.text }]}>
                {L('Nom *', 'Last name *')}
              </Text>
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                accessibilityLabel="Last name"
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
              />
            </View>
            <View>
              <Text style={[styles.label, { color: colors.text }]}>
                {L('Téléphone *', 'Phone *')}
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                accessibilityLabel="Phone"
                placeholder="+242 …"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
              />
            </View>

            {seatmap && seatmap.layout.length > 0 && (
              <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.label, { color: colors.text, marginBottom: 8 }]}>
                  {L('Siège (optionnel)', 'Seat (optional)')} {selectedSeat ? `— ${selectedSeat}` : ''}
                </Text>
                <SeatGrid
                  layout={seatmap.layout}
                  selected={selectedSeat}
                  onSelect={setSelectedSeat}
                  colors={colors}
                />
              </View>
            )}
          </>
        )}

        {/* ── STEP 4 ────────────────────────────────────────────────────── */}
        {step === 4 && (
          <>
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {selectedTrip?.route.origin.name} → {selectedTrip?.route.destination.name}
              </Text>
              {selectedTrip && (
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                  {new Date(selectedTrip.departureScheduled).toLocaleString(lang)}
                </Text>
              )}
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 20, marginTop: 10 }}>
                {(selectedTrip?.price ?? 0).toLocaleString(lang)} {selectedTrip?.currency ?? ''}
              </Text>
            </View>
            <Text style={[styles.label, { color: colors.text }]}>
              {L('Moyen de paiement', 'Payment method')}
            </Text>
            {(['MOBILE_MONEY', 'CARD', 'CASH'] as const).map(m => {
              const selected = payment === m;
              const labels = {
                MOBILE_MONEY: { fr: 'Mobile Money', en: 'Mobile Money', hint_fr: 'Invite envoyée sur votre tel.', hint_en: 'Prompt sent to your phone.' },
                CARD:         { fr: 'Carte bancaire', en: 'Credit card', hint_fr: 'Page de paiement sécurisée.', hint_en: 'Secure payment page.' },
                CASH:         { fr: 'Au guichet',    en: 'At counter',  hint_fr: 'Payez à la gare avant le départ.', hint_en: 'Pay at the station before departure.' },
              }[m];
              return (
                <Pressable
                  key={m}
                  onPress={() => setPayment(m)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.card,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primaryFg + '22' : colors.surface,
                    },
                  ]}
                >
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {lang === 'en' ? labels.en : labels.fr}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    {lang === 'en' ? labels.hint_en : labels.hint_fr}
                  </Text>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* ── Footer nav ──────────────────────────────────────────────────── */}
      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <Pressable
          onPress={() => setStep(s => Math.max(1, s - 1))}
          disabled={step === 1 || submitting}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, opacity: pressed || submitting || step === 1 ? 0.5 : 1 },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {L('Retour', 'Back')}
          </Text>
        </Pressable>
        {step < STEP_COUNT ? (
          <Pressable
            onPress={nextStep}
            disabled={!canNext() || submitting || searching}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.btnPrimary,
              { backgroundColor: colors.primary, opacity: pressed || !canNext() || submitting || searching ? 0.5 : 1 },
            ]}
          >
            {searching
              ? <ActivityIndicator color={colors.primaryFg} />
              : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                  {L('Suivant', 'Next')}
                </Text>}
          </Pressable>
        ) : (
          <Pressable
            onPress={confirmBooking}
            disabled={submitting}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.btnPrimary,
              { backgroundColor: colors.primary, opacity: pressed || submitting ? 0.5 : 1 },
            ]}
          >
            {submitting
              ? <ActivityIndicator color={colors.primaryFg} />
              : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                  {L('Confirmer', 'Confirm')}
                </Text>}
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── SubComponents ─────────────────────────────────────────────────────────

function StationPicker({
  label, stations, value, onChange, colors,
}: {
  label: string;
  stations: Station[];
  value: string | null;
  onChange: (id: string) => void;
  colors: Record<string, string>;
}) {
  return (
    <View>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingVertical: 4 }}
      >
        {stations.map(s => {
          const selected = value === s.id;
          return (
            <Pressable
              key={s.id}
              onPress={() => onChange(s.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[
                styles.chip,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.surface,
                },
              ]}
            >
              <Text style={{ color: selected ? colors.primaryFg : colors.text }}>
                {s.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SeatGrid({
  layout, selected, onSelect, colors,
}: {
  layout: Seat[];
  selected: string | null;
  onSelect: (label: string | null) => void;
  colors: Record<string, string>;
}) {
  // Organise par ligne pour le rendu en grille
  const rows = new Map<number, Seat[]>();
  for (const s of layout) {
    if (!rows.has(s.row)) rows.set(s.row, []);
    rows.get(s.row)!.push(s);
  }
  const sorted = Array.from(rows.entries()).sort(([a], [b]) => a - b);

  return (
    <View style={{ gap: 6 }}>
      {sorted.map(([rowNum, seats]) => (
        <View key={rowNum} style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
          {seats.sort((a, b) => a.col - b.col).map(s => {
            const isSel = selected === s.label;
            const bg =
              s.occupied ? colors.dangerBg :
              isSel      ? colors.primary :
              colors.surface;
            const fg =
              s.occupied ? colors.danger :
              isSel      ? colors.primaryFg :
              colors.text;
            return (
              <Pressable
                key={s.label}
                onPress={() => !s.occupied && onSelect(isSel ? null : s.label)}
                disabled={s.occupied}
                accessibilityRole="button"
                accessibilityLabel={`Seat ${s.label}${s.occupied ? ' occupied' : ''}`}
                style={[
                  styles.seat,
                  { backgroundColor: bg, borderColor: s.occupied ? colors.danger : isSel ? colors.primary : colors.border },
                ]}
              >
                <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:       { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:         { fontSize: 18, fontWeight: '800' },
  banner:     { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8 },
  label:      { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  input:      { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  card:       { padding: 14, borderRadius: 10, borderWidth: 1 },
  chip:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, minHeight: 40, justifyContent: 'center' },
  stepBtn:    { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footer:     { flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: 1 },
  btn:        { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { flex: 2, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  seat:       { width: 36, height: 36, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
