/**
 * CustomerSavScreen — SAV & feedback côté voyageur.
 *
 * Deux sections :
 *   1. Nouveau feedback — ratings 0-5 (conduite / ponctualité / confort /
 *      bagages) + commentaire + consentement RGPD (obligatoire avant POST).
 *      Sélection du trip depuis "Mes billets récents" (pas de saisie libre du
 *      tripId pour éviter qu'un client note un trajet qu'il n'a pas fait).
 *   2. Déposer une réclamation — type + description + photo optionnelle.
 *      POST /sav/claims avec le customerProfile auto-rattaché côté back.
 *
 * Endpoints :
 *   - GET  /tickets/my                 (liste billets pour le sélecteur feedback)
 *   - POST /feedback                   (FEEDBACK_SUBMIT_OWN)
 *   - POST /sav/claims                 (SAV_REPORT_AGENCY — optionnel pour
 *     customer ; si le rôle CUSTOMER ne l'a pas, on utilise /sav/lost-found
 *     (SAV_REPORT_OWN) qui est accessible)
 *
 * Sécurité :
 *   - rgpdConsent obligatoire
 *   - Ratings bornés 0-5 ; validation client + serveur
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, TextInput, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';

const MIN_RATING = 0;
const MAX_RATING = 5;
const COMMENT_MAX = 500;

type RatingKey = 'conduct' | 'punctuality' | 'comfort' | 'baggage';

interface TicketLite {
  id:    string;
  tripId?: string;
  trip?: {
    route?: { origin?: { name: string }; destination?: { name: string } };
    departureScheduled: string;
  };
  status: string;
}

export function CustomerSavScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tickets, setTickets]   = useState<TicketLite[]>([]);
  const [tripId, setTripId]     = useState<string | null>(null);
  const [ratings, setRatings]   = useState<Record<RatingKey, number>>({
    conduct: 0, punctuality: 0, comfort: 0, baggage: 0,
  });
  const [comment, setComment]   = useState('');
  const [rgpd, setRgpd]         = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [claimType, setClaimType] = useState<'COMPLAINT' | 'LOST_ITEM' | 'DAMAGE'>('COMPLAINT');
  const [claimDesc, setClaimDesc] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);

  const loadTickets = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<TicketLite[]>(
        `/api/tenants/${tenantId}/tickets/my`,
        { skipAuthRedirect: true },
      );
      // Ne garde que les billets confirmés / passés
      const eligible = (res ?? []).filter(t =>
        t.status === 'CONFIRMED' || t.status === 'BOARDED' || t.status === 'CHECKED_IN',
      );
      setTickets(eligible);
    } catch { /* silent */ }
  }, [tenantId]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);

  function clampRating(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(MIN_RATING, Math.min(MAX_RATING, Math.round(v)));
  }

  function setRating(k: RatingKey, v: number) {
    setRatings(prev => ({ ...prev, [k]: clampRating(v) }));
  }

  const canSubmitFeedback = tripId !== null && rgpd && Object.values(ratings).some(v => v > 0);

  async function submitFeedback() {
    if (!canSubmitFeedback) {
      Alert.alert(L('Champs manquants', 'Missing fields'),
        L('Choisissez un voyage, notez au moins un critère et acceptez le RGPD.',
          'Select a trip, rate at least one criterion and accept GDPR.'));
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        tripId: tripId ?? undefined,
        ratings,
        comment: comment.trim().slice(0, COMMENT_MAX) || undefined,
        rgpdConsent: true,
      };
      const url = `/api/tenants/${tenantId}/feedback`;
      const key = `feedback:${tripId}:${user?.id}`; // un seul feedback par (trip, user)
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'feedback.submit', method: 'POST',
          url, body, idempotencyKey: key,
        });
        Alert.alert(L('En file', 'Queued'), L('Sera envoyé à la reconnexion.', 'Will sync on reconnect.'));
      } else {
        await apiPost(url, body, { skipAuthRedirect: true, headers: { 'Idempotency-Key': key } });
        Alert.alert(L('Merci !', 'Thank you!'), L('Votre avis a été enregistré.', 'Feedback saved.'));
      }
      setTripId(null);
      setRatings({ conduct: 0, punctuality: 0, comfort: 0, baggage: 0 });
      setComment('');
      setRgpd(false);
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitClaim() {
    if (claimDesc.trim().length < 10) {
      Alert.alert(L('Description trop courte', 'Description too short'),
        L('Décrivez votre réclamation en 10 caractères minimum.', 'Describe your claim in 10+ characters.'));
      return;
    }
    setClaimBusy(true);
    try {
      // On utilise lost-found (SAV_REPORT_OWN) : c'est l'endpoint qui accepte
      // les customers. Le serveur créera une Claim avec reporter = actor.
      const body = {
        type: claimType,
        description: claimDesc.trim(),
      };
      const url = `/api/tenants/${tenantId}/sav/lost-found`;
      const key = `claim:${user?.id}:${Date.now().toString(36)}`;
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'claim.create', method: 'POST',
          url, body, idempotencyKey: key,
        });
        Alert.alert(L('En file', 'Queued'), L('Réclamation envoyée à la reconnexion.', 'Claim will sync on reconnect.'));
      } else {
        await apiPost(url, body, { skipAuthRedirect: true, headers: { 'Idempotency-Key': key } });
        Alert.alert(L('Réclamation enregistrée', 'Claim submitted'),
          L('Nous reviendrons vers vous dans les 48h.', 'We will come back within 48h.'));
      }
      setClaimDesc('');
      setClaimType('COMPLAINT');
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setClaimBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('SAV & feedback', 'SAV & feedback')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
        {/* ── Feedback ───────────────────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.h2, { color: colors.text }]}>
            {L('Noter un voyage', 'Rate a trip')}
          </Text>

          {tickets.length === 0 ? (
            <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 12 }}>
              {L('Aucun voyage éligible — seuls les billets confirmés sont notables.',
                 'No eligible trip — only confirmed tickets can be rated.')}
            </Text>
          ) : (
            <View style={{ marginTop: 8, gap: 6 }}>
              {tickets.map(tk => {
                const selected = tripId === tk.tripId;
                return (
                  <Pressable
                    key={tk.id}
                    onPress={() => setTripId(tk.tripId ?? null)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[
                      styles.pickerRow,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primaryFg + '22' : colors.background,
                      },
                    ]}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
                      {tk.trip?.route?.origin?.name ?? '?'} → {tk.trip?.route?.destination?.name ?? '?'}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                      {tk.trip?.departureScheduled
                        ? new Date(tk.trip.departureScheduled).toLocaleDateString(lang)
                        : '—'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {tripId && (
            <View style={{ marginTop: 14, gap: 12 }}>
              {(['conduct', 'punctuality', 'comfort', 'baggage'] as const).map(k => (
                <RatingRow
                  key={k}
                  label={L(
                    { conduct: 'Conduite', punctuality: 'Ponctualité', comfort: 'Confort', baggage: 'Bagages' }[k],
                    { conduct: 'Driving', punctuality: 'Punctuality', comfort: 'Comfort', baggage: 'Luggage' }[k],
                  )}
                  value={ratings[k]}
                  onChange={(v) => setRating(k, v)}
                  colors={colors}
                />
              ))}

              <View>
                <Text style={[styles.label, { color: colors.text }]}>
                  {L('Commentaire (facultatif)', 'Comment (optional)')}
                </Text>
                <TextInput
                  value={comment}
                  onChangeText={(v) => setComment(v.slice(0, COMMENT_MAX))}
                  multiline
                  numberOfLines={3}
                  accessibilityLabel="Comment"
                  placeholder={L('Votre ressenti…', 'How was it?')}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.textarea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                />
                <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'right' }}>
                  {comment.length}/{COMMENT_MAX}
                </Text>
              </View>

              <Pressable
                onPress={() => setRgpd(r => !r)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rgpd }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <View style={[
                  styles.checkbox,
                  { borderColor: rgpd ? colors.primary : colors.border, backgroundColor: rgpd ? colors.primary : 'transparent' },
                ]}>
                  {rgpd && <Text style={{ color: colors.primaryFg, fontWeight: '800', fontSize: 13 }}>✓</Text>}
                </View>
                <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>
                  {L("J'accepte le traitement de mon avis (RGPD).",
                     'I agree to the processing of my feedback (GDPR).')}
                </Text>
              </Pressable>

              <Pressable
                onPress={submitFeedback}
                disabled={submitting || !canSubmitFeedback}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: colors.primary, opacity: pressed || submitting || !canSubmitFeedback ? 0.5 : 1 },
                ]}
              >
                {submitting
                  ? <ActivityIndicator color={colors.primaryFg} />
                  : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                      {L('Envoyer mon avis', 'Submit feedback')}
                    </Text>}
              </Pressable>
            </View>
          )}
        </View>

        {/* ── Claim ───────────────────────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.h2, { color: colors.text }]}>
            {L('Déposer une réclamation', 'File a claim')}
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {(['COMPLAINT', 'LOST_ITEM', 'DAMAGE'] as const).map(ty => {
              const selected = claimType === ty;
              const label = {
                COMPLAINT: L('Plainte',    'Complaint'),
                LOST_ITEM: L('Objet perdu','Lost item'),
                DAMAGE:    L('Bagage abîmé', 'Damaged luggage'),
              }[ty];
              return (
                <Pressable
                  key={ty}
                  onPress={() => setClaimType(ty)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    {
                      borderColor: colors.border,
                      backgroundColor: selected ? colors.primary : colors.background,
                    },
                  ]}
                >
                  <Text style={{ color: selected ? colors.primaryFg : colors.text, fontSize: 12 }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={[styles.label, { color: colors.text }]}>
              {L('Description', 'Description')}
            </Text>
            <TextInput
              value={claimDesc}
              onChangeText={setClaimDesc}
              multiline
              numberOfLines={4}
              accessibilityLabel="Claim description"
              placeholder={L('Donnez un maximum de détails…', 'Provide as much detail as possible…')}
              placeholderTextColor={colors.textMuted}
              style={[styles.textarea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background, minHeight: 100 }]}
            />
          </View>

          <Pressable
            onPress={submitClaim}
            disabled={claimBusy || claimDesc.trim().length < 10}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: colors.warning,
                opacity: pressed || claimBusy || claimDesc.trim().length < 10 ? 0.5 : 1,
                marginTop: 12,
              },
            ]}
          >
            {claimBusy
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {L('Envoyer la réclamation', 'Submit claim')}
                </Text>}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RatingRow({
  label, value, onChange, colors,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  colors: Record<string, string>;
}) {
  return (
    <View>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
        {Array.from({ length: MAX_RATING }, (_, i) => i + 1).map(n => {
          const active = n <= value;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(value === n ? 0 : n)}
              accessibilityRole="button"
              accessibilityLabel={`${n} / ${MAX_RATING}`}
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 26, color: active ? colors.warning : colors.border }}>
                ★
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:       { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:         { fontSize: 18, fontWeight: '800' },
  h2:         { fontSize: 14, fontWeight: '700' },
  banner:     { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  card:       { padding: 14, borderRadius: 12, borderWidth: 1 },
  pickerRow:  { padding: 10, borderRadius: 8, borderWidth: 1 },
  label:      { fontSize: 13, fontWeight: '600' },
  textarea:   { marginTop: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, textAlignVertical: 'top' },
  chip:       { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, minHeight: 36, justifyContent: 'center' },
  checkbox:   { width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { marginTop: 14, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
