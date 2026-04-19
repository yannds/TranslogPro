/**
 * CheckinScreen — Départ effectif du trajet.
 *
 * Flux :
 *   1. Géolocalisation (expo-location) — opt-in, position capturée au départ
 *   2. Saisie du relevé kilométrique (odomètre au départ)
 *   3. POST /fleet/tracking/odometer { busId, readingKm, source: 'TRIP' }
 *   4. POST /flight-deck/trips/:tripId/status { status: 'IN_PROGRESS' }
 *
 * Sécurité :
 *   - GPS opt-in ; l'utilisateur doit cliquer "Capturer position"
 *   - Km value = entier positif, bornée [0, 9_999_999] (un bus > 10M km = bug)
 *   - Les deux POST partent en outbox si offline (idempotency-key déterministe)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, TextInput, Alert, StyleSheet, ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';

const MIN_KM = 0;
const MAX_KM = 9_999_999;

interface TripBus {
  bus?: { id: string; plate?: string };
}

export function CheckinScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const { tripId } = (useRoute().params ?? {}) as { tripId?: string };
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [busId, setBusId]       = useState<string | null>(null);
  const [busPlate, setBusPlate] = useState<string | null>(null);
  const [km, setKm]             = useState('');
  const [gps, setGps]           = useState<{ lat: number; lng: number } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadTrip = useCallback(async () => {
    if (!tenantId || !tripId) return;
    try {
      const trip = await apiGet<TripBus>(
        `/api/tenants/${tenantId}/trips/${tripId}`,
        { skipAuthRedirect: true },
      );
      setBusId(trip.bus?.id ?? null);
      setBusPlate(trip.bus?.plate ?? null);
    } catch { /* silencieux : l'écran reste utilisable avec bus inconnu */ }
  }, [tenantId, tripId]);

  useEffect(() => { void loadTrip(); }, [loadTrip]);

  async function captureLocation() {
    setCapturing(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          L('Permission refusée', 'Permission denied'),
          L('Activez la géolocalisation dans les réglages.', 'Enable location in settings.'),
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (e) {
      Alert.alert('GPS', e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  }

  function validKm(): number | null {
    const n = Number(km);
    if (!Number.isFinite(n) || n < MIN_KM || n > MAX_KM) return null;
    return Math.floor(n);
  }

  async function submit() {
    const kmValue = validKm();
    if (kmValue === null) {
      Alert.alert(L('Km invalide', 'Invalid km'), L(`Saisissez un entier entre ${MIN_KM} et ${MAX_KM}.`, `Enter an integer between ${MIN_KM} and ${MAX_KM}.`));
      return;
    }
    if (!busId) {
      Alert.alert(L('Bus introuvable', 'Bus not found'), L('Impossible de relier le relevé kilométrique sans bus.', 'Cannot link odometer without bus.'));
      return;
    }
    setSubmitting(true);

    try {
      // 1. Odomètre — idempotency-key par (tripId + readingKm) pour éviter double enregistrement
      //    si on retente après un hang réseau.
      const odometerBody = {
        busId,
        readingKm: kmValue,
        source:   'TRIP',
        note:     gps ? `GPS ${gps.lat.toFixed(5)},${gps.lng.toFixed(5)} · trip=${tripId}` : `trip=${tripId}`,
      };
      const odometerUrl = `/api/tenants/${tenantId}/fleet/tracking/odometer`;
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'odometer.create', method: 'POST',
          url: odometerUrl, body: odometerBody,
          idempotencyKey: `odometer:${tripId}:${kmValue}`,
        });
      } else {
        await apiPost(odometerUrl, odometerBody, { skipAuthRedirect: true });
      }

      // 2. Transition état trip → IN_PROGRESS
      const statusBody = { status: 'IN_PROGRESS' as const };
      const statusUrl  = `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/status`;
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'trip.status', method: 'POST',
          url: statusUrl, body: statusBody,
          idempotencyKey: `trip:${tripId}:status:IN_PROGRESS`,
        });
      } else {
        await apiPost(statusUrl, statusBody, { skipAuthRedirect: true });
      }

      Alert.alert(
        L('Check-in validé', 'Check-in confirmed'),
        online
          ? L('Bon trajet !', 'Have a safe trip!')
          : L('Envoi dès reconnexion.', 'Will upload on reconnect.'),
      );
      nav.goBack();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => nav.goBack()} style={styles.back}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.h1, { color: colors.text }]}>
              {L('Check-in départ', 'Departure check-in')}
            </Text>
            {busPlate && (
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {L('Bus', 'Bus')} {busPlate}
              </Text>
            )}
          </View>
        </View>

        {!online && (
          <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
            <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
          </View>
        )}

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.label, { color: colors.text }]}>
            {L('Relevé kilométrique (au départ)', 'Odometer (at departure)')}
          </Text>
          <TextInput
            value={km}
            onChangeText={setKm}
            keyboardType="numeric"
            inputMode="numeric"
            accessibilityLabel="Km reading"
            placeholder="km"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
          />
        </View>

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.label, { color: colors.text }]}>
            {L('Position GPS (optionnel)', 'GPS location (optional)')}
          </Text>
          <Pressable
            onPress={captureLocation}
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
                  {gps ? L('Mettre à jour position', 'Refresh location') : L('Capturer ma position', 'Capture my location')}
                </Text>}
          </Pressable>
          {gps && (
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>
              {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
            </Text>
          )}
        </View>

        <Pressable
          onPress={submit}
          disabled={submitting}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: colors.primary, opacity: submitting || pressed ? 0.6 : 1 },
          ]}
        >
          {submitting
            ? <ActivityIndicator color={colors.primaryFg} />
            : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                {L('Confirmer départ', 'Confirm departure')}
              </Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:         { fontSize: 18, fontWeight: '800' },
  back:       { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:     { padding: 10, borderRadius: 8 },
  card:       { padding: 14, borderRadius: 12, borderWidth: 1, gap: 8 },
  label:      { fontSize: 13, fontWeight: '600' },
  input:      { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  ghostBtn:   { height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  primaryBtn: { marginTop: 8, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
