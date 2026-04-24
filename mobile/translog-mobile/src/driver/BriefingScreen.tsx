/**
 * BriefingScreen — Briefing pré-départ QHSE v2 (refonte 2026-04-24).
 *
 * Flux unifié :
 *   GET  /crew-briefing/templates/default  → sections + items actifs
 *   POST /crew-briefing/briefings/v2       → signature template-driven
 *   POST /flight-deck/trips/:tripId/status { status: 'BOARDING' } après sign
 *
 * Offline : la signature du briefing est enqueued via outbox avec
 * idempotency-key tripId. La transition BOARDING reste offline-capable.
 *
 * Signature : MobileSignatureInput (DRAW/PIN/BIOMETRIC).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, StyleSheet, Alert,
  ActivityIndicator, TextInput,
} from 'react-native';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';
import {
  MobileSignatureInput,
  type MobileSignatureValue,
} from '../ui/MobileSignatureInput';

type ItemKind = 'CHECK' | 'QUANTITY' | 'DOCUMENT' | 'ACKNOWLEDGE' | 'INFO';

interface BriefingItem {
  id:          string;
  code:        string;
  kind:        ItemKind;
  labelFr:     string;
  labelEn:     string;
  requiredQty: number;
  isMandatory: boolean;
  isActive:    boolean;
  order:       number;
  autoSource?: string | null;
}
interface BriefingSection {
  id:       string;
  titleFr:  string;
  titleEn:  string;
  order:    number;
  isActive: boolean;
  items:    BriefingItem[];
}
interface BriefingTemplate {
  id:       string;
  sections: BriefingSection[];
}

export function BriefingScreen() {
  const { user }   = useAuth();
  const { t }      = useI18n();
  const { colors } = useTheme();
  const online     = useOnline();
  const nav        = useNavigation<NavigationProp<any>>();
  const route      = useRoute();
  const { tripId, assignmentId } = (route.params ?? {}) as { tripId?: string; assignmentId?: string };
  const tenantId   = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const myUserId   = user?.id ?? '';
  const lang       = (user as any)?.locale === 'en' ? 'en' : 'fr';

  const [template, setTemplate] = useState<BriefingTemplate | null>(null);
  const [loading, setLoading]   = useState(false);
  const [checks, setChecks]     = useState<Record<string, { passed: boolean; qty: number }>>({});
  const [signature, setSignature] = useState<MobileSignatureValue | null>(null);
  const [notes, setNotes]         = useState('');
  const [busy, setBusy]           = useState(false);

  const fetchTemplate = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await apiGet<BriefingTemplate | null>(
        `/api/tenants/${tenantId}/crew-briefing/templates/default`,
        { skipAuthRedirect: true },
      );
      setTemplate(res);
      if (res) {
        const init: Record<string, { passed: boolean; qty: number }> = {};
        for (const sec of res.sections.filter(s => s.isActive)) {
          for (const item of sec.items.filter(i => i.isActive)) {
            init[item.id] = {
              passed: item.kind === 'INFO',
              qty:    item.kind === 'QUANTITY' ? item.requiredQty : 1,
            };
          }
        }
        setChecks(init);
      }
    } catch (e) {
      if (!(e instanceof ApiError)) return;
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { fetchTemplate(); }, [fetchTemplate]);

  const activeSections = useMemo(
    () => (template?.sections ?? []).filter(s => s.isActive).sort((a, b) => a.order - b.order),
    [template],
  );

  const label = (fr: string, en: string) => (lang === 'en' ? en : fr);

  async function sign() {
    if (!template || !assignmentId || !signature?.isReady) {
      Alert.alert(
        label('Signature requise', 'Signature required'),
        t('driverBriefing.errSignatureRequired'),
      );
      return;
    }
    setBusy(true);
    try {
      const items = Object.entries(checks).map(([itemId, c]) => ({
        itemId, passed: c.passed, qty: c.qty,
      }));
      const body = {
        assignmentId,
        templateId:    template.id,
        conductedById: myUserId,
        items,
        driverSignature: {
          method:           signature.method,
          blob:             signature.blob,
          acknowledgedById: myUserId,
        },
        briefingNotes: notes || undefined,
      };
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'briefing.sign', method: 'POST',
          url:  `/api/tenants/${tenantId}/crew-briefing/briefings/v2`,
          body, idempotencyKey: `briefing:${assignmentId}:v2`,
        });
        Alert.alert(
          label('Mis en file', 'Queued'),
          label('Briefing envoyé dès reconnexion.', 'Briefing will be sent on reconnect.'),
        );
      } else {
        await apiPost(
          `/api/tenants/${tenantId}/crew-briefing/briefings/v2`,
          body,
          { skipAuthRedirect: true },
        );
      }
      // Transition vers BOARDING (non bloquant si échec)
      if (tripId) {
        try {
          if (!online) {
            await enqueueMutation({
              tenantId, kind: 'trip.status', method: 'POST',
              url:  `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/status`,
              body: { status: 'BOARDING' },
              idempotencyKey: `trip:${tripId}:status:BOARDING`,
            });
          } else {
            await apiPost(
              `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/status`,
              { status: 'BOARDING' },
              { skipAuthRedirect: true },
            );
          }
        } catch { /* non bloquant */ }
        nav.navigate('DriverBoardingScan' as never, { tripId } as never);
      } else {
        nav.goBack();
      }
    } catch (e) {
      Alert.alert(
        'Erreur',
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
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
              {label('Briefing pré-départ', 'Pre-departure briefing')}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {label(
                'Remplissez la check-list puis signez. Non bloquant mais fait foi.',
                'Complete the checklist then sign. Non-blocking but legally binding.',
              )}
            </Text>
          </View>
        </View>

        {!online && (
          <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
            <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
          </View>
        )}

        {loading && <ActivityIndicator color={colors.primary} />}

        {!loading && !template && (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={{ color: colors.textMuted, textAlign: 'center' }}>
              {t('driverBriefing.noTemplate')}
            </Text>
          </View>
        )}

        {activeSections.map(sec => (
          <View key={sec.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {label(sec.titleFr, sec.titleEn)}
            </Text>
            {sec.items.filter(i => i.isActive).sort((a, b) => a.order - b.order).map(item => {
              const state = checks[item.id];
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    if (item.kind === 'INFO') return;
                    setChecks(c => ({
                      ...c,
                      [item.id]: { ...(c[item.id] ?? { qty: item.requiredQty }), passed: !(c[item.id]?.passed ?? false) },
                    }));
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: state?.passed ?? false, disabled: item.kind === 'INFO' }}
                  style={[
                    styles.itemRow,
                    { borderColor: state?.passed ? colors.success : colors.border,
                      backgroundColor: state?.passed ? colors.successBg : 'transparent' },
                  ]}
                >
                  <View
                    style={[
                      styles.check,
                      { borderColor: state?.passed ? colors.success : colors.border,
                        backgroundColor: state?.passed ? colors.success : 'transparent' },
                    ]}
                  >
                    {state?.passed && <Text style={{ color: 'white', fontSize: 14, lineHeight: 20 }}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '500' }}>
                      {label(item.labelFr, item.labelEn)}
                      {item.isMandatory && <Text style={{ color: '#dc2626' }}> *</Text>}
                    </Text>
                    {item.kind === 'INFO' && (
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                        {t('driverBriefing.autoComputed')}
                      </Text>
                    )}
                  </View>
                  {item.kind === 'QUANTITY' && (
                    <TextInput
                      value={String(state?.qty ?? item.requiredQty)}
                      onChangeText={txt => setChecks(c => ({
                        ...c,
                        [item.id]: { ...(c[item.id] ?? { passed: false }), qty: parseInt(txt, 10) || 0 },
                      }))}
                      keyboardType="number-pad"
                      style={[styles.qtyInput, { color: colors.text, borderColor: colors.border }]}
                      accessibilityLabel={`${label(item.labelFr, item.labelEn)} qty`}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}

        {template && (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('driverBriefing.observations')}
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              style={[styles.notesInput, { color: colors.text, borderColor: colors.border }]}
              placeholder={t('driverBriefing.obsPlaceholder')}
              placeholderTextColor={colors.textMuted}
            />
          </View>
        )}

        {template && (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('driverBriefing.signatureTitle')}
            </Text>
            <MobileSignatureInput onChange={setSignature} />
          </View>
        )}

        <Pressable
          onPress={sign}
          disabled={busy || !template || !signature?.isReady}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: colors.primary,
              opacity: busy || !template || !signature?.isReady || pressed ? 0.5 : 1,
            },
          ]}
        >
          {busy
            ? <ActivityIndicator color={colors.primaryFg} />
            : <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                {t('driverBriefing.signBriefing')}
              </Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:           { fontSize: 18, fontWeight: '800' },
  back:         { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:       { padding: 10, borderRadius: 8 },
  card:         { padding: 14, borderRadius: 12, borderWidth: 1, gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  itemRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 8, borderWidth: 1 },
  check:        { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  qtyInput:     { width: 60, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, textAlign: 'center' },
  notesInput:   { borderWidth: 1, borderRadius: 6, padding: 10, minHeight: 60, textAlignVertical: 'top' },
  primaryBtn:   { marginTop: 8, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
