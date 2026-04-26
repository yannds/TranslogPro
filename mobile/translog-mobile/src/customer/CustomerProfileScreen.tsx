/**
 * CustomerProfileScreen — Profil voyageur self-service.
 *
 * Permet de :
 *   - Voir son identité (nom, email, téléphone — read-only ; changement
 *     d'email = flow de vérification, à faire web).
 *   - Choisir sa langue (fr/en — les autres locales restent côté tenant).
 *   - Toggler ses canaux de notification (push, SMS, WhatsApp, email).
 *   - Se déconnecter.
 *
 * Endpoints :
 *   - PATCH /api/auth/me/preferences         { locale, timezone }
 *   - GET   /api/tenants/:tid/notifications/preferences
 *   - PATCH /api/tenants/:tid/notifications/preferences
 *
 * Aucune mutation offline (les patches doivent partir en sync — ce n'est pas
 * de la donnée terrain critique).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, Switch, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

interface NotifPrefs {
  sms?:      boolean;
  whatsapp?: boolean;
  push?:     boolean;
  email?:    boolean;
}

const LOCALES: { id: string; fr: string; en: string }[] = [
  { id: 'fr', fr: 'Français', en: 'French'  },
  { id: 'en', fr: 'Anglais',  en: 'English' },
];

export function CustomerProfileScreen() {
  const { user, refresh, logout } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const currentLocale = ((user as any)?.locale === 'en' ? 'en' : 'fr') as 'fr' | 'en';
  const lang = currentLocale;
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [prefs, setPrefs]       = useState<NotifPrefs>({});
  const [locale, setLocale]     = useState<string>(currentLocale);
  const [loading, setLoading]   = useState(false);
  const [savingPref, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = await apiGet<NotifPrefs>(
        `/api/tenants/${tenantId}/notifications/preferences`,
        { skipAuthRedirect: true },
      );
      setPrefs(p ?? {});
    } catch {
      setPrefs({});
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleChannel(key: keyof NotifPrefs, next: boolean) {
    if (!online) {
      Alert.alert(L('Réseau requis', 'Network required'),
        L('Modification non queuable.', 'Change not queueable.'));
      return;
    }
    const previous = prefs[key];
    setPrefs(p => ({ ...p, [key]: next }));
    setSaving(key);
    try {
      await apiPatch(
        `/api/tenants/${tenantId}/notifications/preferences`,
        { [key]: next },
        { skipAuthRedirect: true },
      );
    } catch (e) {
      // rollback en cas d'échec
      setPrefs(p => ({ ...p, [key]: previous }));
      Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function updateLocale(next: string) {
    if (next === locale) return;
    if (!online) {
      Alert.alert(L('Réseau requis', 'Network required'));
      return;
    }
    const previous = locale;
    setLocale(next);
    setSaving('locale');
    try {
      await apiPatch(
        '/api/auth/me/preferences',
        { locale: next },
        { skipAuthRedirect: true },
      );
      // Force un refresh /me pour que useAuth() lise la nouvelle locale.
      await refresh();
    } catch (e) {
      setLocale(previous);
      Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} style={styles.back}>
          <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Mon profil', 'My profile')}
        </Text>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
        {/* ── Identité (read-only) ───────────────────────────────────── */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {L('IDENTITÉ', 'IDENTITY')}
          </Text>

          <Field label={L('Nom complet', 'Full name')} value={user?.name ?? '—'} colors={colors} />
          <Field label={L('Email', 'Email')} value={user?.email ?? '—'} colors={colors} />
          <Field
            label={L('Téléphone', 'Phone')}
            value={(user as any)?.phone ?? '—'}
            colors={colors}
          />

          <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}>
            {L('Pour modifier email ou téléphone, utilisez le portail web (vérification requise).',
               'To change email or phone, use the web portal (verification required).')}
          </Text>
        </View>

        {/* ── Langue ─────────────────────────────────────────────────── */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {L('LANGUE', 'LANGUAGE')}
          </Text>

          <View style={styles.localeRow}>
            {LOCALES.map(opt => {
              const active = locale === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => updateLocale(opt.id)}
                  disabled={savingPref === 'locale'}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.localeChip,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary : 'transparent',
                      opacity: savingPref === 'locale' ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={{
                    color: active ? colors.primaryFg : colors.text,
                    fontWeight: '700',
                  }}>
                    {L(opt.fr, opt.en)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Notifications ──────────────────────────────────────────── */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {L('CANAUX DE NOTIFICATION', 'NOTIFICATION CHANNELS')}
          </Text>

          {loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />}

          <ChannelRow
            label={L('Notifications push', 'Push notifications')}
            description={L('Alertes embarquement, modifications de trajet.', 'Boarding alerts, trip changes.')}
            value={prefs.push ?? true}
            onToggle={(v) => toggleChannel('push', v)}
            busy={savingPref === 'push'}
            colors={colors}
          />
          <ChannelRow
            label="SMS"
            description={L('Confirmations critiques (achat, annulation).', 'Critical confirmations (purchase, cancel).')}
            value={prefs.sms ?? true}
            onToggle={(v) => toggleChannel('sms', v)}
            busy={savingPref === 'sms'}
            colors={colors}
          />
          <ChannelRow
            label="WhatsApp"
            description={L('Suivi de voyage et reçus (si configuré).', 'Trip tracking and receipts (if configured).')}
            value={prefs.whatsapp ?? false}
            onToggle={(v) => toggleChannel('whatsapp', v)}
            busy={savingPref === 'whatsapp'}
            colors={colors}
          />
          <ChannelRow
            label={L('Email', 'Email')}
            description={L('Reçus, factures et communications mensuelles.', 'Receipts, invoices and monthly digests.')}
            value={prefs.email ?? true}
            onToggle={(v) => toggleChannel('email', v)}
            busy={savingPref === 'email'}
            colors={colors}
          />
        </View>

        {/* ── Sécurité (déconnexion) ─────────────────────────────────── */}
        <Pressable
          onPress={() => {
            Alert.alert(
              L('Se déconnecter ?', 'Sign out?'),
              L('Vous devrez vous reconnecter pour accéder à vos billets.',
                'You will need to sign in again to view your tickets.'),
              [
                { text: L('Annuler', 'Cancel'), style: 'cancel' },
                { text: L('Déconnexion', 'Sign out'), style: 'destructive', onPress: () => logout() },
              ],
            );
          }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.logoutBtn,
            { borderColor: colors.danger, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={{ color: colors.danger, fontWeight: '700' }}>
            {L('Se déconnecter', 'Sign out')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label, value, colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 14, marginTop: 2 }} selectable>
        {value}
      </Text>
    </View>
  );
}

function ChannelRow({
  label, description, value, onToggle, busy, colors,
}: {
  label: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  busy: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.channelRow, { borderTopColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={busy}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  back:        { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  h1:          { fontSize: 18, fontWeight: '800' },
  banner:      { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  section:     { padding: 14, borderRadius: 12, borderWidth: 1, gap: 4 },
  sectionTitle:{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  localeRow:   { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  localeChip:  { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, minHeight: 40 },
  channelRow:  {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  logoutBtn:   {
    paddingVertical: 14,
    borderRadius:    10,
    borderWidth:     1,
    alignItems:      'center',
    justifyContent:  'center',
  },
});
