/**
 * StationSellTicketScreen — Vente native billet depuis la gare avec paiement
 * Mobile Money complet (STK push + polling).
 *
 * Flux :
 *   1. Trip         : choix du départ du jour (cache offline)
 *   2. Passager     : nom, téléphone, classe, bagage ; téléphone sert aussi
 *                     de cible MoMo par défaut
 *   3. Paiement     : CASH | MOBILE_MONEY | CARD
 *   4. Si MoMo      : POST /payments/intents → affichage instruction client +
 *                     polling GET /payments/intents/:id toutes les PAY_POLL_MS
 *                     jusqu'à SUCCEEDED | FAILED | EXPIRED
 *   5. Confirm      : POST /tickets/batch/confirm (idempotency-key déterministe)
 *   6. Impression   : queuePrint(buildTicketReceipt)
 *
 * Sécurité :
 *   - Idempotency-Key déterministe client côté intent ET confirm → anti double-vente
 *   - Polling borné (PAY_POLL_MAX_MS) : au-delà, on force FAILED côté UI
 *   - CASH nécessite une caisse ouverte (vérifié serveur via recordTransaction)
 *   - Pas de magic number : constantes en haut du fichier
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { queuePrint } from '../printer/printer.queue';
import { buildTicketReceipt, DEFAULT_RECEIPT_WIDTH } from '../printer/templates';

// ── Constantes (zéro magic number) ───────────────────────────────────────────
type FareClass     = 'STANDARD' | 'CONFORT' | 'VIP' | 'STANDING';
type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'CARD';
type IntentStatus  = 'CREATED' | 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | string;

const STEP_COUNT      = 3;
const PAY_POLL_MS     = 3_000;         // intervalle polling MoMo
const PAY_POLL_MAX_MS = 180_000;       // 3 min avant abandon UI (serveur peut garder l'intent)
const PHONE_MIN_LEN   = 6;
const NAME_MIN_LEN    = 2;

const FARE_OPTIONS: { id: FareClass; fr: string; en: string }[] = [
  { id: 'STANDARD', fr: 'Standard', en: 'Standard' },
  { id: 'CONFORT',  fr: 'Confort',  en: 'Comfort'  },
  { id: 'VIP',      fr: 'VIP',      en: 'VIP'      },
  { id: 'STANDING', fr: 'Debout',   en: 'Standing' },
];

const PAYMENT_OPTIONS: { id: PaymentMethod; fr: string; en: string; hint_fr: string; hint_en: string }[] = [
  { id: 'CASH',         fr: 'Espèces',      en: 'Cash',
    hint_fr: 'Vérifier la monnaie et remettre un reçu imprimé.',
    hint_en: 'Count change and hand over a printed receipt.' },
  { id: 'MOBILE_MONEY', fr: 'Mobile Money', en: 'Mobile Money',
    hint_fr: 'Le client recevra une invite sur le numéro fourni.',
    hint_en: 'Customer will receive a prompt on the provided phone.' },
  { id: 'CARD',         fr: 'Carte',        en: 'Card',
    hint_fr: 'Utiliser le TPE ; marquer comme payé une fois approuvé.',
    hint_en: 'Use the POS terminal ; mark paid once approved.' },
];

interface TripItem {
  id:                 string;
  departureScheduled: string;
  status:             string;
  route?: { id: string; origin?: { id: string; name: string }; destination?: { id: string; name: string } };
}

interface BatchTicketsRes {
  tickets: { id: string; pricePaid: number }[];
  pricingSummary: { grandTotal: number; currency: string };
}

interface IntentRes {
  intentId:    string;
  status:      IntentStatus;
  amount:      number;
  currency:    string;
  paymentUrl?: string;
  expiresAt:   string;
}

export function StationSellTicketScreen() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [step, setStep]             = useState(1);
  const [trips, setTrips]           = useState<TripItem[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const [name, setName]             = useState('');
  const [phone, setPhone]           = useState('');
  const [fareClass, setFareClass]   = useState<FareClass>('STANDARD');
  const [payment, setPayment]       = useState<PaymentMethod>('CASH');

  const [openRegisterId, setOpenRegisterId] = useState<string | null>(null);
  const [busy, setBusy]             = useState(false);

  // État MoMo polling
  const [momoIntent, setMomoIntent] = useState<IntentRes | null>(null);
  const [momoStatus, setMomoStatus] = useState<IntentStatus | null>(null);
  const pollStopRef                 = useRef<{ cancelled: boolean }>({ cancelled: false });

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoadingTrips(true);
    try {
      const qs = 'status=PLANNED&status=OPEN&status=BOARDING';
      const items = await apiGet<TripItem[]>(
        `/api/tenants/${tenantId}/trips?${qs}`,
        { skipAuthRedirect: true },
      );
      setTrips([...items].sort((a, b) =>
        new Date(a.departureScheduled).getTime() - new Date(b.departureScheduled).getTime(),
      ));
    } catch { /* offline */ }
    finally { setLoadingTrips(false); }

    try {
      const reg = await apiGet<{ id: string } | null>(
        `/api/tenants/${tenantId}/cashier/registers/me/open`,
        { skipAuthRedirect: true },
      );
      setOpenRegisterId(reg?.id ?? null);
    } catch { setOpenRegisterId(null); }
  }, [tenantId]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => () => { pollStopRef.current.cancelled = true; }, []);

  const selectedTrip = useMemo(
    () => trips.find(t => t.id === selectedTripId) ?? null,
    [trips, selectedTripId],
  );

  function canGoNext(): boolean {
    if (step === 1) return Boolean(selectedTripId);
    if (step === 2) return name.trim().length >= NAME_MIN_LEN && phone.trim().length >= PHONE_MIN_LEN;
    return true;
  }

  function resetAll() {
    setStep(1); setSelectedTripId(null);
    setName(''); setPhone('');
    setFareClass('STANDARD'); setPayment('CASH');
    setMomoIntent(null); setMomoStatus(null);
    pollStopRef.current.cancelled = true;
    pollStopRef.current = { cancelled: false };
  }

  // ── Création + polling MoMo ──────────────────────────────────────────────
  async function runMoMoFlow(ticketIds: string[], amount: number, currency: string): Promise<'OK' | 'FAIL'> {
    // Une seule intent par ticketIds via idempotency-key déterministe
    const idempotencyKey = `momo-intent:${ticketIds.sort().join(',')}`;
    setMomoStatus('CREATED');
    try {
      const intent = await apiPost<IntentRes>(
        `/api/tenants/${tenantId}/payments/intents`,
        {
          entityType:     'TICKET',
          entityId:       ticketIds[0],
          subtotal:       amount, // le serveur calcule les taxes
          method:         'MOBILE_MONEY',
          currency,
          idempotencyKey,
          customerPhone:  phone.trim(),
          customerName:   name.trim(),
          description:    `Ticket(s) ${ticketIds.join(', ')}`,
        },
        { skipAuthRedirect: true },
      );
      setMomoIntent(intent);
      setMomoStatus(intent.status);

      // Polling borné
      const deadline = Date.now() + PAY_POLL_MAX_MS;
      pollStopRef.current = { cancelled: false };
      while (!pollStopRef.current.cancelled && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, PAY_POLL_MS));
        if (pollStopRef.current.cancelled) return 'FAIL';
        try {
          const fresh = await apiGet<IntentRes & { attempts?: unknown[] }>(
            `/api/tenants/${tenantId}/payments/intents/${intent.intentId}`,
            { skipAuthRedirect: true },
          );
          setMomoStatus(fresh.status);
          if (fresh.status === 'SUCCEEDED') return 'OK';
          if (fresh.status === 'FAILED' || fresh.status === 'EXPIRED' || fresh.status === 'CANCELLED') return 'FAIL';
        } catch { /* transient — on retente */ }
      }
      setMomoStatus('EXPIRED');
      return 'FAIL';
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
      setMomoStatus('FAILED');
      return 'FAIL';
    }
  }

  async function confirmSale() {
    if (!selectedTrip) return;
    setBusy(true);
    try {
      // 1. Crée les billets PENDING_PAYMENT
      const batchRes = await apiPost<BatchTicketsRes>(
        `/api/tenants/${tenantId}/tickets/batch`,
        {
          tripId: selectedTrip.id,
          passengers: [{
            passengerName:      name.trim(),
            passengerPhone:     phone.trim(),
            fareClass,
            alightingStationId: selectedTrip.route?.destination?.id ?? '',
          }],
        },
        { skipAuthRedirect: true },
      );
      const ticketIds = batchRes.tickets.map(tk => tk.id);

      // 2. Si MoMo → intent + polling ; bloque la confirm si non succédée.
      if (payment === 'MOBILE_MONEY') {
        const outcome = await runMoMoFlow(
          ticketIds,
          batchRes.pricingSummary.grandTotal,
          batchRes.pricingSummary.currency,
        );
        if (outcome !== 'OK') {
          Alert.alert(
            L('Paiement non abouti', 'Payment not completed'),
            L(
              'Le billet est resté en attente. Vous pouvez réessayer ou annuler.',
              'Ticket kept pending. You can retry or cancel.',
            ),
          );
          return;
        }
      }

      // 3. Confirm ticketing (génère QR)
      const confirmBody = {
        ticketIds,
        paymentMethod:  payment,
        cashRegisterId: payment === 'CASH' ? openRegisterId : null,
      };
      const idempotencyKey = `sell-station:${ticketIds.sort().join(',')}`;
      await apiPost(
        `/api/tenants/${tenantId}/tickets/batch/confirm`,
        confirmBody,
        { skipAuthRedirect: true, headers: { 'Idempotency-Key': idempotencyKey } },
      );

      // 4. Impression reçu (queue locale)
      await queuePrint(buildTicketReceipt({
        tenantName:    user?.email ?? 'TransLog',
        ticketId:      ticketIds[0],
        passengerName: name.trim(),
        origin:        selectedTrip.route?.origin?.name ?? '',
        destination:   selectedTrip.route?.destination?.name ?? '',
        departure:     selectedTrip.departureScheduled,
        pricePaid:     batchRes.pricingSummary.grandTotal,
        currency:      batchRes.pricingSummary.currency,
        lang:          lang === 'en' ? 'en' : 'fr',
      }, DEFAULT_RECEIPT_WIDTH));

      Alert.alert(
        L('Billet confirmé', 'Ticket confirmed'),
        L('Reçu envoyé à l\'imprimante.', 'Receipt sent to printer.'),
      );
      resetAll();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function cancelMoMoPolling() {
    pollStopRef.current.cancelled = true;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable
          onPress={() => nav.goBack()}
          accessibilityRole="button"
          style={styles.back}
        >
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: colors.text }]}>
            {L('Vendre un billet', 'Sell ticket')}
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

      {!openRegisterId && step === 3 && payment === 'CASH' && (
        <View style={[styles.banner, { backgroundColor: colors.dangerBg }]}>
          <Text style={{ color: colors.danger }}>
            {L('Ouvrez votre caisse avant une vente espèces.', 'Open your register before selling cash.')}
          </Text>
        </View>
      )}

      {/* ── Overlay MoMo polling ────────────────────────────────────────────── */}
      {momoStatus && momoStatus !== 'SUCCEEDED' && (
        <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1 }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>
            {L('Paiement Mobile Money en cours', 'Mobile Money payment in progress')}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {L('Statut', 'Status')} : {momoStatus}
          </Text>
          <Pressable
            onPress={cancelMoMoPolling}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cancelBtn,
              { borderColor: colors.danger, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={{ color: colors.danger, fontWeight: '700' }}>
              {L('Annuler l\'attente', 'Cancel waiting')}
            </Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {step === 1 && (
          <StepTrip
            trips={trips}
            loading={loadingTrips}
            selectedTripId={selectedTripId}
            onSelect={setSelectedTripId}
            lang={lang === 'en' ? 'en' : 'fr'}
          />
        )}
        {step === 2 && (
          <StepPassenger
            lang={lang === 'en' ? 'en' : 'fr'}
            name={name} setName={setName}
            phone={phone} setPhone={setPhone}
            fareClass={fareClass} setFareClass={setFareClass}
          />
        )}
        {step === 3 && (
          <StepPayment
            lang={lang === 'en' ? 'en' : 'fr'}
            method={payment} setMethod={setPayment}
          />
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <Pressable
          onPress={() => setStep(s => Math.max(1, s - 1))}
          disabled={step === 1 || busy}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, opacity: pressed || busy || step === 1 ? 0.5 : 1 },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {L('Retour', 'Back')}
          </Text>
        </Pressable>
        {step < STEP_COUNT ? (
          <Pressable
            onPress={() => setStep(s => Math.min(STEP_COUNT, s + 1))}
            disabled={!canGoNext() || busy}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.btnPrimary,
              { backgroundColor: colors.primary, opacity: pressed || busy || !canGoNext() ? 0.5 : 1 },
            ]}
          >
            <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
              {L('Suivant', 'Next')}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={confirmSale}
            disabled={busy || (!online && payment !== 'CASH')}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.btnPrimary,
              { backgroundColor: colors.primary, opacity: pressed || busy ? 0.5 : 1 },
            ]}
          >
            {busy
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

// ─── Steps ───────────────────────────────────────────────────────────────
function StepTrip({
  trips, loading, selectedTripId, onSelect, lang,
}: {
  trips: TripItem[]; loading: boolean;
  selectedTripId: string | null; onSelect: (id: string) => void;
  lang: 'fr' | 'en';
}) {
  const { colors } = useTheme();
  if (loading) return <ActivityIndicator color={colors.primary} />;
  if (trips.length === 0) {
    return (
      <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 16 }}>
        {lang === 'en' ? 'No scheduled trip.' : 'Aucun trajet planifié.'}
      </Text>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {trips.map(tr => {
        const selected = selectedTripId === tr.id;
        return (
          <Pressable
            key={tr.id}
            onPress={() => onSelect(tr.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.card,
              {
                borderColor:     selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primaryFg + '22' : colors.surface,
                opacity:         pressed ? 0.9 : 1,
              },
            ]}
          >
            <Text style={{ color: colors.text, fontWeight: '700' }}>
              {tr.route?.origin?.name ?? '?'} → {tr.route?.destination?.name ?? '?'}
            </Text>
            <Text style={{ color: colors.textMuted, marginTop: 2, fontSize: 13 }}>
              {new Date(tr.departureScheduled).toLocaleString(lang, {
                hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
              })} · {tr.status}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StepPassenger({
  lang, name, setName, phone, setPhone, fareClass, setFareClass,
}: {
  lang: 'fr' | 'en';
  name: string; setName: (s: string) => void;
  phone: string; setPhone: (s: string) => void;
  fareClass: FareClass; setFareClass: (f: FareClass) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <View>
        <Text style={[styles.label, { color: colors.text }]}>
          {lang === 'en' ? 'Passenger name *' : 'Nom du passager *'}
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel="Passenger name"
          placeholder={lang === 'en' ? 'Full name' : 'Nom complet'}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
        />
      </View>
      <View>
        <Text style={[styles.label, { color: colors.text }]}>
          {lang === 'en' ? 'Phone *' : 'Téléphone *'}
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
      <View>
        <Text style={[styles.label, { color: colors.text }]}>
          {lang === 'en' ? 'Fare class' : 'Classe'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {FARE_OPTIONS.map(o => (
            <Pressable
              key={o.id}
              onPress={() => setFareClass(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: fareClass === o.id }}
              style={[
                styles.chip,
                {
                  borderColor: colors.border,
                  backgroundColor: fareClass === o.id ? colors.primary : colors.surface,
                },
              ]}
            >
              <Text style={{ color: fareClass === o.id ? colors.primaryFg : colors.text }}>
                {lang === 'en' ? o.en : o.fr}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function StepPayment({
  lang, method, setMethod,
}: {
  lang: 'fr' | 'en';
  method: PaymentMethod; setMethod: (m: PaymentMethod) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.label, { color: colors.text }]}>
        {lang === 'en' ? 'Payment method' : 'Moyen de paiement'}
      </Text>
      <View style={{ gap: 6 }}>
        {PAYMENT_OPTIONS.map(o => {
          const selected = method === o.id;
          return (
            <Pressable
              key={o.id}
              onPress={() => setMethod(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[
                styles.card,
                {
                  borderColor:     selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primaryFg + '22' : colors.surface,
                },
              ]}
            >
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {lang === 'en' ? o.en : o.fr}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                {lang === 'en' ? o.hint_en : o.hint_fr}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:      { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:        { fontSize: 18, fontWeight: '800' },
  banner:    { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8, gap: 6 },
  card:      { padding: 14, borderRadius: 10, borderWidth: 1 },
  label:     { fontSize: 13, fontWeight: '600' },
  input:     { marginTop: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  chip:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, minHeight: 44, justifyContent: 'center' },
  footer:    { flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: 1 },
  btn:       { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnPrimary:{ flex: 2, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { height: 40, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
});
