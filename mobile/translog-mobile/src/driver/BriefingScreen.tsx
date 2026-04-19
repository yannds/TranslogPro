/**
 * BriefingScreen — Checklist pré-départ (sécurité / QHSE).
 *
 * Flux :
 *   GET  /flight-deck/trips/:tripId/checklist → items {id, label, done}
 *   PATCH /flight-deck/checklist/:id/complete pour chaque case cochée
 *   POST /flight-deck/trips/:tripId/status { status: 'BOARDING' } quand tout OK
 *
 * Offline : les transitions sont enqueued via outbox (idempotency-key).
 * Le briefing peut donc être complété sans connexion tant que la liste d'items
 * a été cachée au moment du détail trip (useOfflineList sur trips.checklist).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost, apiFetch, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';

interface ChecklistItem {
  id:        string;
  label:     string;
  completed: boolean;
  category?: string;
}

interface ChecklistResponse {
  checklistId: string | null;
  items:       ChecklistItem[];
  allComplete: boolean;
}

export function BriefingScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const { tripId } = (useRoute().params ?? {}) as { tripId?: string };
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [items, setItems]       = useState<ChecklistItem[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState<Record<string, boolean>>({});
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenantId || !tripId) return;
    try {
      const res = await apiGet<ChecklistResponse | ChecklistItem[]>(
        `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/checklist`,
        { skipAuthRedirect: true },
      );
      const list = Array.isArray(res) ? res : res.items ?? [];
      setItems(list);
    } catch (e) {
      // Offline / absent : liste vide, on ne bloque pas
      if (!(e instanceof ApiError)) return;
    }
  }, [tenantId, tripId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function toggleItem(item: ChecklistItem) {
    if (item.completed) return;          // idempotent : on ne décoche pas
    setSaving(s => ({ ...s, [item.id]: true }));
    // MAJ optimiste — si l'appel échoue, on annulera.
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: true } : i));
    const url = `/api/tenants/${tenantId}/flight-deck/checklist/${item.id}/complete`;
    try {
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'checklist.complete', method: 'PATCH',
          url, body: {}, idempotencyKey: `checklist:${item.id}:complete`,
        });
      } else {
        await apiFetch(url, { method: 'PATCH', skipAuthRedirect: true });
      }
    } catch (e) {
      // Rollback optimistic
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: false } : i));
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(s => { const n = { ...s }; delete n[item.id]; return n; });
    }
  }

  const allDone = items.length > 0 && items.every(i => i.completed);

  async function startBoarding() {
    if (!allDone) {
      Alert.alert(
        L('Checklist incomplète', 'Incomplete checklist'),
        L('Cochez tous les items avant de démarrer l\'embarquement.', 'Tick all items before starting boarding.'),
      );
      return;
    }
    setStarting(true);
    try {
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'trip.status', method: 'POST',
          url: `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/status`,
          body: { status: 'BOARDING' },
          idempotencyKey: `trip:${tripId}:status:BOARDING`,
        });
        Alert.alert(L('Mis en file', 'Queued'), L('Embarquement démarré dès reconnexion.', 'Boarding will start on reconnect.'));
      } else {
        await apiPost(
          `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/status`,
          { status: 'BOARDING' },
          { skipAuthRedirect: true },
        );
        Alert.alert(L('Embarquement démarré', 'Boarding started'), L('Scannez les billets des passagers.', 'Scan passenger tickets now.'));
      }
      nav.navigate('DriverBoardingScan', { tripId });
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => nav.goBack()} style={styles.back}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.h1, { color: colors.text }]}>
              {L('Briefing pré-départ', 'Pre-departure briefing')}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {L('Cochez chaque item avant de démarrer l\'embarquement.', 'Tick each item before starting boarding.')}
            </Text>
          </View>
        </View>

        {!online && (
          <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
            <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
          </View>
        )}

        {loading && items.length === 0 && (
          <ActivityIndicator color={colors.primary} />
        )}

        {!loading && items.length === 0 && (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={{ color: colors.textMuted, textAlign: 'center' }}>
              {L(
                'Aucun item de checklist configuré pour ce tenant. Vous pouvez démarrer l\'embarquement directement.',
                'No checklist item configured. You can start boarding directly.',
              )}
            </Text>
          </View>
        )}

        {items.map(item => {
          const isSaving = !!saving[item.id];
          return (
            <Pressable
              key={item.id}
              onPress={() => toggleItem(item)}
              disabled={item.completed || isSaving}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.completed, disabled: item.completed }}
              style={({ pressed }) => [
                styles.itemRow,
                {
                  borderColor: item.completed ? colors.success : colors.border,
                  backgroundColor: item.completed ? colors.successBg : colors.surface,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.check,
                  { borderColor: item.completed ? colors.success : colors.border,
                    backgroundColor: item.completed ? colors.success : 'transparent' },
                ]}
              >
                {item.completed && <Text style={{ color: 'white', fontSize: 14, lineHeight: 20 }}>✓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{item.label}</Text>
                {item.category && (
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{item.category}</Text>
                )}
              </View>
              {isSaving && <ActivityIndicator color={colors.primary} size="small" />}
            </Pressable>
          );
        })}

        <Pressable
          onPress={startBoarding}
          disabled={starting || (items.length > 0 && !allDone)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: colors.primary,
              opacity: starting || (items.length > 0 && !allDone) || pressed ? 0.5 : 1,
            },
          ]}
        >
          {starting
            ? <ActivityIndicator color={colors.primaryFg} />
            : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                {L('Démarrer embarquement', 'Start boarding')}
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
  card:       { padding: 14, borderRadius: 12, borderWidth: 1 },
  itemRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 10, borderWidth: 1 },
  check:      { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { marginTop: 8, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
