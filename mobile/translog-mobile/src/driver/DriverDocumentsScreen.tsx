/**
 * DriverDocumentsScreen — Mes documents chauffeur (permis + formations).
 *
 * Flux :
 *   - GET /driver-profile/drivers/:staffId/licenses → cartes permis avec badge expiration
 *   - GET /driver-profile/drivers/:staffId/trainings → formations planifiées/complétées/en retard
 *
 * Sécurité :
 *   - Permission DRIVER_REST_OWN (driver ne lit QUE ses propres documents)
 *   - staffId pris depuis user.staffId (pas de saisie cliente)
 *
 * UX :
 *   - Badge couleur : VALID=success, EXPIRING (J-90)=warning, EXPIRED=danger
 *   - Trainings : COMPLETED=success, PLANNED=primary, MISSED=danger
 *   - Mode offline : affiche dernier snapshot (non mutant — lecture seule)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

// ── Bornes d'alerte ──────────────────────────────────────────────────────────
// Un permis est considéré "EXPIRING" entre J-90 et J-0 (norme UE carte pro).
const EXPIRING_THRESHOLD_DAYS = 90;
const MS_PER_DAY              = 86_400_000;

interface License {
  id:           string;
  category:     string;
  licenseNo:    string;
  issuedAt:     string;
  expiresAt:    string;
  issuingState: string | null;
  status:       'VALID' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED' | string;
}

interface Training {
  id:           string;
  scheduledAt:  string;
  completedAt:  string | null;
  status:       'PLANNED' | 'COMPLETED' | 'MISSED' | 'CANCELLED' | string;
  type:         { name: string; code: string; isMandatory: boolean };
  trainerName:  string | null;
  locationName: string | null;
}

export function DriverDocumentsScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const staffId  = user?.staffId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [licenses, setLicenses]   = useState<License[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId || !staffId) return;
    try {
      const [lic, tr] = await Promise.all([
        apiGet<License[]>(
          `/api/tenants/${tenantId}/driver-profile/drivers/${staffId}/licenses`,
          { skipAuthRedirect: true },
        ),
        apiGet<Training[]>(
          `/api/tenants/${tenantId}/driver-profile/drivers/${staffId}/trainings`,
          { skipAuthRedirect: true },
        ),
      ]);
      setLicenses(lic ?? []);
      setTrainings(tr ?? []);
    } catch { /* offline — garde snapshot précédent */ }
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

  // Calcul local du statut (si backend ne l'a pas recalculé récemment).
  function computeLicenseStatus(lic: License): 'VALID' | 'EXPIRING' | 'EXPIRED' | string {
    if (lic.status === 'SUSPENDED') return 'SUSPENDED';
    const daysLeft = Math.floor((new Date(lic.expiresAt).getTime() - Date.now()) / MS_PER_DAY);
    if (daysLeft < 0) return 'EXPIRED';
    if (daysLeft < EXPIRING_THRESHOLD_DAYS) return 'EXPIRING';
    return 'VALID';
  }

  function badgeColors(status: string) {
    switch (status) {
      case 'VALID':     return { bg: colors.successBg, fg: colors.success };
      case 'EXPIRING':  return { bg: colors.warningBg, fg: colors.warning };
      case 'EXPIRED':
      case 'SUSPENDED': return { bg: colors.dangerBg,  fg: colors.danger };
      case 'COMPLETED': return { bg: colors.successBg, fg: colors.success };
      case 'MISSED':    return { bg: colors.dangerBg,  fg: colors.danger };
      case 'PLANNED':   return { bg: colors.surface,   fg: colors.primary };
      default:          return { bg: colors.surface,   fg: colors.textMuted };
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(lang, { day: '2-digit', month: 'short', year: 'numeric' });
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
          {L('Mes documents', 'My documents')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {loading && licenses.length + trainings.length === 0 && (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      )}

      <FlatList
        data={[]}
        keyExtractor={() => ''}
        renderItem={null as any}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 16 }}>
            {/* ── Section permis ─────────────────────────────────────────── */}
            <Text style={[styles.h2, { color: colors.text }]}>
              {L('Permis de conduire', 'Driving licenses')}
            </Text>
            {licenses.length === 0 && !loading && (
              <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 16 }}>
                {L('Aucun permis enregistré.', 'No license on file.')}
              </Text>
            )}
            {licenses.map((lic) => {
              const st = computeLicenseStatus(lic);
              const bc = badgeColors(st);
              return (
                <View key={lic.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>
                      {L('Catégorie', 'Category')} {lic.category}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: bc.bg }]}>
                      <Text style={{ color: bc.fg, fontSize: 11, fontWeight: '800' }}>{st}</Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 13 }}>
                    № {lic.licenseNo}{lic.issuingState ? ` · ${lic.issuingState}` : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                        {L('Émis le', 'Issued')}
                      </Text>
                      <Text style={{ color: colors.text, fontSize: 13 }}>{formatDate(lic.issuedAt)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                        {L('Expire le', 'Expires')}
                      </Text>
                      <Text style={{ color: colors.text, fontSize: 13 }}>{formatDate(lic.expiresAt)}</Text>
                    </View>
                  </View>
                </View>
              );
            })}

            {/* ── Section formations ─────────────────────────────────────── */}
            <Text style={[styles.h2, { color: colors.text, marginTop: 8 }]}>
              {L('Formations', 'Trainings')}
            </Text>
            {trainings.length === 0 && !loading && (
              <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 16 }}>
                {L('Aucune formation planifiée.', 'No training scheduled.')}
              </Text>
            )}
            {trainings.map((tr) => {
              const bc = badgeColors(tr.status);
              const overdue =
                tr.status === 'PLANNED' && new Date(tr.scheduledAt).getTime() < Date.now();
              return (
                <View key={tr.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={2}>
                      {tr.type.name}
                      {tr.type.isMandatory && (
                        <Text style={{ color: colors.danger }}>  *</Text>
                      )}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: overdue ? colors.dangerBg : bc.bg }]}>
                      <Text style={{ color: overdue ? colors.danger : bc.fg, fontSize: 11, fontWeight: '800' }}>
                        {overdue ? L('RETARD', 'OVERDUE') : tr.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
                    {tr.status === 'COMPLETED'
                      ? `${L('Complété', 'Completed')} ${formatDate(tr.completedAt)}`
                      : `${L('Planifié', 'Scheduled')} ${formatDate(tr.scheduledAt)}`}
                    {tr.locationName ? ` · ${tr.locationName}` : ''}
                  </Text>
                  {tr.trainerName && (
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      {L('Formateur', 'Trainer')} : {tr.trainerName}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:     { fontSize: 18, fontWeight: '800' },
  h2:     { fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  back:   { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner: { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  card:   { padding: 12, borderRadius: 10, borderWidth: 1 },
  badge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
});
