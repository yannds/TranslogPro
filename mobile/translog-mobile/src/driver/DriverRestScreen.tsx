/**
 * DriverRestScreen — Temps de repos réglementaire.
 *
 * Trois blocs :
 *   1. Statut actuel (canDrive / repos en cours / minutes restantes)
 *   2. Actions : démarrer/arrêter une période de repos manuelle
 *   3. Historique des 20 dernières périodes (durée, source)
 *
 * Endpoints :
 *   - GET  /driver-profile/rest-config
 *   - GET  /driver-profile/drivers/:staffId/rest-compliance
 *   - GET  /driver-profile/drivers/:staffId/rest-history
 *   - POST /driver-profile/rest-periods { staffId, source: 'MANUAL' }
 *   - PATCH /driver-profile/rest-periods/:id/end
 *
 * Offline : les mutations partent en outbox avec idempotency-key déterministe ;
 *   les lectures restent snapshotées (peuvent être stales).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, Alert, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';

const MIN_PER_HOUR = 60;

interface RestConfig {
  minRestMinutes:           number;
  maxDrivingMinutesPerDay:  number;
  maxDrivingMinutesPerWeek: number;
  alertBeforeEndRestMin:    number;
}

interface RestCompliance {
  canDrive:             boolean;
  restRemainingMinutes: number;
  activeRestPeriod:     { id: string; startedAt: string } | null;
}

interface RestPeriod {
  id:        string;
  startedAt: string;
  endedAt:   string | null;
  source:    'AUTO' | 'MANUAL' | 'MEDICAL' | string;
  notes:     string | null;
}

function formatHoursMinutes(totalMinutes: number, lang: 'fr' | 'en'): string {
  const h = Math.floor(totalMinutes / MIN_PER_HOUR);
  const m = totalMinutes % MIN_PER_HOUR;
  return lang === 'en' ? `${h}h ${m}m` : `${h}h${String(m).padStart(2, '0')}`;
}

export function DriverRestScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const staffId  = user?.staffId ?? '';

  const lang: 'fr' | 'en' = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [config, setConfig]         = useState<RestConfig | null>(null);
  const [comp, setComp]             = useState<RestCompliance | null>(null);
  const [history, setHistory]       = useState<RestPeriod[]>([]);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy]             = useState(false);

  const load = useCallback(async () => {
    if (!tenantId || !staffId) return;
    try {
      const [cfg, cpl, hist] = await Promise.all([
        apiGet<RestConfig>(
          `/api/tenants/${tenantId}/driver-profile/rest-config`,
          { skipAuthRedirect: true },
        ),
        apiGet<RestCompliance>(
          `/api/tenants/${tenantId}/driver-profile/drivers/${staffId}/rest-compliance`,
          { skipAuthRedirect: true },
        ),
        apiGet<RestPeriod[]>(
          `/api/tenants/${tenantId}/driver-profile/drivers/${staffId}/rest-history?limit=20`,
          { skipAuthRedirect: true },
        ),
      ]);
      setConfig(cfg);
      setComp(cpl);
      setHistory(hist ?? []);
    } catch { /* offline — on garde snapshot */ }
  }, [tenantId, staffId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function startManualRest() {
    if (!staffId) return;
    setBusy(true);
    try {
      const body = { staffId, source: 'MANUAL' as const };
      const url  = `/api/tenants/${tenantId}/driver-profile/rest-periods`;
      // Clé déterministe au jour : si l'appel part 2× dans la minute (double tap
      // hors ligne) on ne crée PAS deux périodes de repos.
      const dayKey = new Date().toISOString().slice(0, 10);
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'rest.start', method: 'POST',
          url, body, idempotencyKey: `rest-start:${staffId}:${dayKey}`,
        });
        Alert.alert(L('En file', 'Queued'), L('Repos enregistré à la reconnexion.', 'Will save on reconnect.'));
      } else {
        await apiPost(url, body, { skipAuthRedirect: true });
        await load();
      }
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function endActiveRest() {
    if (!comp?.activeRestPeriod) return;
    const id = comp.activeRestPeriod.id;
    setBusy(true);
    try {
      const body = {};
      const url  = `/api/tenants/${tenantId}/driver-profile/rest-periods/${id}/end`;
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'rest.end', method: 'PATCH',
          url, body, idempotencyKey: `rest-end:${id}`,
        });
        Alert.alert(L('En file', 'Queued'), L('Fin de repos à la reconnexion.', 'Will save on reconnect.'));
      } else {
        await apiPatch(url, body, { skipAuthRedirect: true });
        await load();
      }
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Rendu helpers ──────────────────────────────────────────────────────────
  const canDriveColor = comp?.canDrive ? colors.success   : colors.danger;
  const canDriveBg    = comp?.canDrive ? colors.successBg : colors.dangerBg;
  const canDriveLabel = comp?.canDrive
    ? L('Vous pouvez conduire', 'You can drive')
    : L('Repos requis', 'Rest required');

  function historyLine(p: RestPeriod): string {
    if (!p.endedAt) return L('En cours', 'In progress');
    const durMin = Math.floor((new Date(p.endedAt).getTime() - new Date(p.startedAt).getTime()) / 60_000);
    return formatHoursMinutes(durMin, lang);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
        <Pressable
          onPress={() => nav.goBack()}
          accessibilityRole="button"
          accessibilityLabel={L('Retour', 'Back')}
          style={styles.back}
        >
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Temps de repos', 'Driving & rest')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {loading && !comp && <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />}

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
      >
        {/* ── Bloc statut ────────────────────────────────────────────────── */}
        {comp && (
          <View style={[styles.statusCard, { backgroundColor: canDriveBg, borderColor: canDriveColor }]}>
            <Text style={{ color: canDriveColor, fontWeight: '800', fontSize: 16 }}>
              {canDriveLabel}
            </Text>
            {comp.activeRestPeriod ? (
              <>
                <Text style={{ color: colors.text, marginTop: 6 }}>
                  {L('Repos en cours depuis', 'Resting since')} {new Date(comp.activeRestPeriod.startedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {comp.restRemainingMinutes > 0 && (
                  <Text style={{ color: colors.textMuted, marginTop: 2 }}>
                    {L('Reste', 'Remaining')} {formatHoursMinutes(comp.restRemainingMinutes, lang)} {L('avant reprise', 'before resume')}
                  </Text>
                )}
              </>
            ) : (
              <Text style={{ color: colors.text, marginTop: 6 }}>
                {comp.canDrive
                  ? L('Aucun repos obligatoire pour le moment.', 'No mandatory rest required.')
                  : L('Dépassement limite quotidienne — repos obligatoire.', 'Daily limit exceeded — rest required.')}
              </Text>
            )}
          </View>
        )}

        {/* ── Bloc actions ───────────────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.h2, { color: colors.text }]}>
            {L('Actions', 'Actions')}
          </Text>
          {comp?.activeRestPeriod ? (
            <Pressable
              onPress={endActiveRest}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.success, opacity: busy || pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>
                {L('Terminer le repos', 'End rest period')}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={startManualRest}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary, opacity: busy || pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
                {L('Démarrer un repos manuel', 'Start manual rest')}
              </Text>
            </Pressable>
          )}
        </View>

        {/* ── Bloc règles ────────────────────────────────────────────────── */}
        {config && (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.h2, { color: colors.text }]}>
              {L('Règles tenant', 'Tenant rules')}
            </Text>
            <Text style={{ color: colors.textMuted, marginTop: 4 }}>
              {L('Repos minimum', 'Minimum rest')} : {formatHoursMinutes(config.minRestMinutes, lang)}
            </Text>
            <Text style={{ color: colors.textMuted }}>
              {L('Conduite max / jour', 'Max driving / day')} : {formatHoursMinutes(config.maxDrivingMinutesPerDay, lang)}
            </Text>
            <Text style={{ color: colors.textMuted }}>
              {L('Conduite max / semaine', 'Max driving / week')} : {formatHoursMinutes(config.maxDrivingMinutesPerWeek, lang)}
            </Text>
          </View>
        )}

        {/* ── Bloc historique ────────────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.h2, { color: colors.text }]}>
            {L('Historique', 'History')}
          </Text>
          {history.length === 0 && (
            <Text style={{ color: colors.textMuted, marginTop: 4 }}>
              {L('Aucun repos enregistré.', 'No rest on record.')}
            </Text>
          )}
          {history.map((p) => (
            <View key={p.id} style={styles.historyRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>
                  {new Date(p.startedAt).toLocaleDateString(lang, { day: '2-digit', month: 'short' })}
                  {' · '}
                  {new Date(p.startedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                  {p.endedAt && ` → ${new Date(p.endedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  {p.source}
                </Text>
              </View>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                {historyLine(p)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:          { fontSize: 18, fontWeight: '800' },
  h2:          { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  back:        { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:      { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  card:        { padding: 14, borderRadius: 12, borderWidth: 1, gap: 6 },
  statusCard:  { padding: 16, borderRadius: 12, borderWidth: 2 },
  primaryBtn:  { marginTop: 10, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  historyRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(100,116,139,0.25)' },
});
