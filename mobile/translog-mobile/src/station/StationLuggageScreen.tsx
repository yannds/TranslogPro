/**
 * StationLuggageScreen — Pesée bagages en gare (pour un trip donné).
 *
 * Flux :
 *   1. Choisir un trip à l'embarquement
 *   2. Liste passagers (depuis /flight-deck/trips/:id/passengers) avec poids existant
 *   3. Tap passager → saisie poids (kg) → PATCH /flight-deck/.../luggage
 *
 * Sécurité :
 *   - Permission LUGGAGE_WEIGH_AGENCY (agent de quai/gare)
 *   - Bornes : 0 ≤ poidsKg ≤ MAX_WEIGHT_KG (évite saisie erronée 9999kg)
 *   - Mode offline : pesée mise en outbox avec idempotency-key (ticketId+kg)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, TextInput, StyleSheet, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';

const MIN_WEIGHT_KG = 0;
const MAX_WEIGHT_KG = 200;

interface TripItem {
  id:                 string;
  departureScheduled: string;
  status:             string;
  route?: { origin?: { name: string }; destination?: { name: string } };
}

interface Passenger {
  id:            string;
  passengerName: string;
  seatNumber:    string | null;
  fareClass:     string | null;
  luggageKg:     number | null;
}

export function StationLuggageScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [trips, setTrips]                 = useState<TripItem[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [passengers, setPassengers]       = useState<Passenger[]>([]);
  const [loading, setLoading]             = useState(false);
  const [editTicket, setEditTicket]       = useState<Passenger | null>(null);
  const [weightStr, setWeightStr]         = useState('');
  const [saving, setSaving]               = useState(false);

  const loadTrips = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await apiGet<TripItem[]>(
        `/api/tenants/${tenantId}/trips?status=PLANNED&status=OPEN&status=BOARDING`,
        { skipAuthRedirect: true },
      );
      setTrips([...res].sort((a, b) =>
        new Date(a.departureScheduled).getTime() - new Date(b.departureScheduled).getTime(),
      ));
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, [tenantId]);

  const loadPassengers = useCallback(async (tripId: string) => {
    if (!tenantId || !tripId) return;
    try {
      const res = await apiGet<Passenger[]>(
        `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers`,
        { skipAuthRedirect: true },
      );
      setPassengers(res ?? []);
    } catch { setPassengers([]); }
  }, [tenantId]);

  useEffect(() => { void loadTrips(); }, [loadTrips]);
  useEffect(() => {
    if (selectedTripId) void loadPassengers(selectedTripId);
  }, [selectedTripId, loadPassengers]);

  const totalKg = useMemo(
    () => passengers.reduce((sum, p) => sum + (p.luggageKg ?? 0), 0),
    [passengers],
  );

  function openEditor(p: Passenger) {
    setEditTicket(p);
    setWeightStr(p.luggageKg != null ? String(p.luggageKg) : '');
  }

  function closeEditor() {
    setEditTicket(null);
    setWeightStr('');
  }

  function validWeight(): number | null {
    const n = Number(weightStr.replace(',', '.'));
    if (!Number.isFinite(n) || n < MIN_WEIGHT_KG || n > MAX_WEIGHT_KG) return null;
    return Math.round(n * 10) / 10; // 1 décimale
  }

  async function saveWeight() {
    const kg = validWeight();
    if (kg === null) {
      Alert.alert(L('Poids invalide', 'Invalid weight'),
        L(`Saisissez un poids entre ${MIN_WEIGHT_KG} et ${MAX_WEIGHT_KG} kg.`,
          `Enter a weight between ${MIN_WEIGHT_KG} and ${MAX_WEIGHT_KG} kg.`));
      return;
    }
    if (!editTicket || !selectedTripId) return;
    setSaving(true);
    try {
      const body = { weightKg: kg };
      const url  = `/api/tenants/${tenantId}/flight-deck/trips/${selectedTripId}/passengers/${editTicket.id}/luggage`;
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'luggage.set', method: 'PATCH',
          url, body, idempotencyKey: `luggage:${editTicket.id}:${kg}`,
        });
      } else {
        await apiPatch(url, body, { skipAuthRedirect: true });
      }
      // Optimistic local update
      setPassengers(prev => prev.map(p =>
        p.id === editTicket.id ? { ...p, luggageKg: kg } : p,
      ));
      closeEditor();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.h1, { color: colors.text }]}>
            {L('Pesée bagages', 'Luggage weighing')}
          </Text>
          {selectedTripId && (
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {L('Total pesé', 'Total weighed')} : {totalKg.toFixed(1)} kg
            </Text>
          )}
        </View>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {/* ── Sélection trip ───────────────────────────────────────────────── */}
      {!selectedTripId && (
        <>
          <Text style={[styles.h2, { color: colors.text, paddingHorizontal: 16 }]}>
            {L('Choisissez un trajet', 'Select a trip')}
          </Text>
          {loading && <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />}
          <FlatList
            data={trips}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={!loading ? (
              <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                {L('Aucun trajet.', 'No trip.')}
              </Text>
            ) : null}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => setSelectedTripId(item.id)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.card,
                  { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {item.route?.origin?.name ?? '?'} → {item.route?.destination?.name ?? '?'}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                  {new Date(item.departureScheduled).toLocaleString(lang, {
                    hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
                  })} · {item.status}
                </Text>
              </Pressable>
            )}
          />
        </>
      )}

      {/* ── Liste passagers ──────────────────────────────────────────────── */}
      {selectedTripId && (
        <>
          <Pressable
            onPress={() => { setSelectedTripId(null); setPassengers([]); }}
            accessibilityRole="button"
            style={{ paddingHorizontal: 16, marginBottom: 4 }}
          >
            <Text style={{ color: colors.primary, fontSize: 13 }}>
              ← {L('Changer de trajet', 'Change trip')}
            </Text>
          </Pressable>
          <FlatList
            data={passengers}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={
              <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                {L('Aucun passager.', 'No passenger.')}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => openEditor(item)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.card,
                  { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                      {item.passengerName}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      {item.fareClass ?? '—'}{item.seatNumber ? ` · ${L('siège', 'seat')} ${item.seatNumber}` : ''}
                    </Text>
                  </View>
                  <Text style={{
                    color: item.luggageKg != null ? colors.success : colors.textMuted,
                    fontWeight: '800', fontSize: 16,
                  }}>
                    {item.luggageKg != null ? `${item.luggageKg.toFixed(1)} kg` : '— kg'}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </>
      )}

      {/* ── Modale saisie poids ──────────────────────────────────────────── */}
      <Modal
        visible={editTicket !== null}
        animationType="slide"
        transparent
        onRequestClose={closeEditor}
      >
        <View style={styles.backdrop}>
          <View style={[styles.modal, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.h2, { color: colors.text }]}>
              {L('Poids bagage', 'Luggage weight')}
            </Text>
            {editTicket && (
              <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
                {editTicket.passengerName}
              </Text>
            )}
            <TextInput
              value={weightStr}
              onChangeText={setWeightStr}
              keyboardType="decimal-pad"
              inputMode="decimal"
              accessibilityLabel="Weight in kg"
              placeholder="kg"
              placeholderTextColor={colors.textMuted}
              autoFocus
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Pressable
                onPress={closeEditor}
                disabled={saving}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  {L('Annuler', 'Cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={saveWeight}
                disabled={saving}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btnPrimary,
                  { backgroundColor: colors.primary, opacity: pressed || saving ? 0.6 : 1 },
                ]}
              >
                {saving
                  ? <ActivityIndicator color={colors.primaryFg} />
                  : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                      {L('Enregistrer', 'Save')}
                    </Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:       { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:         { fontSize: 18, fontWeight: '800' },
  h2:         { fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  banner:     { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  card:       { padding: 12, borderRadius: 10, borderWidth: 1 },
  backdrop:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.5)' },
  modal:      { padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1 },
  input:      { marginTop: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  btn:        { flex: 1, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { flex: 2, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
