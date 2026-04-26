/**
 * AdminProfileScreen — Profil + menu utilisateur admin tenant / manager.
 *
 * Accessible via le bouton avatar dans le header de AdminHomeScreen.
 * Contient :
 *   - Identité (nom, email, rôle, agence si manager scope)
 *   - Préférences langue (fr/en) + canaux notifications
 *   - Actions secondaires : Charts, SAV, Annonces, Promotions
 *   - Sécurité : Changer mot de passe
 *   - Déconnexion confirmée
 *
 * Endpoints :
 *   - PATCH /api/auth/me/preferences { locale }
 *   - GET   /api/tenants/:tid/notifications/preferences
 *   - PATCH /api/tenants/:tid/notifications/preferences
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
import { useTenantHost } from '../api/TenantHostProvider';
import { ScreenHeader } from '../ui/ScreenHeader';
import {
  IconUserCircle, IconKey, IconLogout, IconBell, IconHelp,
  IconChevronR, IconLanguage, IconTrendUp, IconShieldOk,
} from '../ui/icons';

interface NotifPrefs {
  sms?:      boolean;
  whatsapp?: boolean;
  push?:     boolean;
  email?:    boolean;
}

const LOCALES = [
  { id: 'fr', fr: 'Français', en: 'French'  },
  { id: 'en', fr: 'Anglais',  en: 'English' },
] as const;

export function AdminProfileScreen() {
  const { user, refresh, logout } = useAuth();
  const { clearTenant } = useTenantHost();
  const { t, lang } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);
  const currentLocale = ((user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr');

  const [prefs,  setPrefs]   = useState<NotifPrefs>({});
  const [locale, setLocale]  = useState<string>(currentLocale);
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const p = await apiGet<NotifPrefs>(
        `/api/tenants/${tenantId}/notifications/preferences`,
        { skipAuthRedirect: true },
      );
      setPrefs(p ?? {});
    } catch { setPrefs({}); }
    finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleChannel(key: keyof NotifPrefs, next: boolean) {
    if (!online) {
      Alert.alert(L('Réseau requis', 'Network required'));
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
      setPrefs(p => ({ ...p, [key]: previous }));
      Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
    } finally { setSaving(null); }
  }

  async function updateLocale(next: string) {
    if (next === locale) return;
    if (!online) { Alert.alert(L('Réseau requis', 'Network required')); return; }
    const previous = locale;
    setLocale(next);
    setSaving('locale');
    try {
      await apiPatch('/api/auth/me/preferences', { locale: next }, { skipAuthRedirect: true });
      await refresh();
    } catch (e) {
      setLocale(previous);
      Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
    } finally { setSaving(null); }
  }

  function confirmLogout() {
    Alert.alert(
      L('Se déconnecter ?', 'Sign out?'),
      L('Vous serez ramené à l’écran de connexion.', 'You will be returned to the sign-in screen.'),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        { text: L('Déconnexion', 'Sign out'), style: 'destructive', onPress: () => logout() },
      ],
    );
  }

  function confirmSwitchTenant() {
    Alert.alert(
      L('Changer de société ?', 'Switch company?'),
      L('Vous serez déconnecté et reviendrez à l’écran de connexion.', 'You will be signed out and returned to the sign-in screen.'),
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Changer', 'Switch'),
          onPress: async () => { await logout(); await clearTenant(); },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={L('Mon profil', 'My profile')} onBack={() => nav.goBack()} />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>

        {/* ── Identité ──────────────────────────────────────────────────── */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {L('IDENTITÉ', 'IDENTITY')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <IconUserCircle size={36} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>
                {user?.name ?? L('(sans nom)', '(no name)')}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }} selectable>
                {user?.email}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                {user?.roleName ?? user?.userType}
                {user?.agencyId ? ` · agence ${user.agencyId.slice(0, 8)}…` : ''}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Sécurité ─────────────────────────────────────────────────── */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface, padding: 0 }]}>
          <SectionTitle text={L('SÉCURITÉ', 'SECURITY')} colors={colors} />
          <Row
            icon={IconKey}
            label={L('Changer mon mot de passe', 'Change password')}
            onPress={() => nav.navigate('ChangePassword')}
            colors={colors}
          />
          <Row
            icon={IconShieldOk}
            label={L('Sessions actives', 'Active sessions')}
            onPress={() => Alert.alert(
              L('Sessions actives', 'Active sessions'),
              L('Gestion détaillée disponible sur le portail web (révoquer une session par device, etc.).',
                'Detailed management available on the web portal (revoke per device, etc.).'),
            )}
            colors={colors}
          />
        </View>

        {/* ── Accès rapides ────────────────────────────────────────────── */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface, padding: 0 }]}>
          <SectionTitle text={L('ACCÈS RAPIDES', 'QUICK ACCESS')} colors={colors} />
          <Row
            icon={IconTrendUp}
            label={L('Graphes & analytics', 'Charts & analytics')}
            onPress={() => nav.navigate('AdminCharts')}
            colors={colors}
          />
          <Row
            icon={IconBell}
            label={L('SAV & remboursements', 'SAV & refunds')}
            onPress={() => nav.navigate('AdminSav')}
            colors={colors}
          />
        </View>

        {/* ── Langue ───────────────────────────────────────────────────── */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            <IconLanguage size={12} color={colors.textMuted} /> {L('LANGUE', 'LANGUAGE')}
          </Text>
          <View style={styles.localeRow}>
            {LOCALES.map(opt => {
              const active = locale === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => updateLocale(opt.id)}
                  disabled={saving === 'locale'}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.localeChip,
                    {
                      borderColor:     active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary : 'transparent',
                      opacity:         saving === 'locale' ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={{ color: active ? colors.primaryFg : colors.text, fontWeight: '600' }}>
                    {L(opt.fr, opt.en)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Notifications ────────────────────────────────────────────── */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {L('CANAUX DE NOTIFICATION', 'NOTIFICATION CHANNELS')}
          </Text>
          {loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />}
          <ChannelRow
            label={L('Push', 'Push')}
            description={L('Alertes incidents · trajets · caisses', 'Incidents · trips · cash alerts')}
            value={prefs.push ?? true}
            onToggle={(v) => toggleChannel('push', v)}
            busy={saving === 'push'}
            colors={colors}
          />
          <ChannelRow
            label="SMS"
            description={L('Critique uniquement', 'Critical only')}
            value={prefs.sms ?? true}
            onToggle={(v) => toggleChannel('sms', v)}
            busy={saving === 'sms'}
            colors={colors}
          />
          <ChannelRow
            label="WhatsApp"
            description={L('Si configuré côté tenant', 'If configured tenant-side')}
            value={prefs.whatsapp ?? false}
            onToggle={(v) => toggleChannel('whatsapp', v)}
            busy={saving === 'whatsapp'}
            colors={colors}
          />
          <ChannelRow
            label="Email"
            description={L('Récap hebdo + factures', 'Weekly digest + invoices')}
            value={prefs.email ?? true}
            onToggle={(v) => toggleChannel('email', v)}
            busy={saving === 'email'}
            colors={colors}
          />
        </View>

        {/* ── Aide ─────────────────────────────────────────────────────── */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface, padding: 0 }]}>
          <Row
            icon={IconHelp}
            label={L('Aide & support', 'Help & support')}
            onPress={() => Alert.alert(
              L('Support', 'Support'),
              L('Pour une assistance approfondie, contactez votre administrateur ou utilisez le portail web.',
                'For deep assistance, contact your administrator or use the web portal.'),
            )}
            colors={colors}
          />
        </View>

        {/* ── Sortie ───────────────────────────────────────────────────── */}
        <Pressable
          onPress={confirmSwitchTenant}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.logoutBtn,
            { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {L('Changer de société', 'Switch company')}
          </Text>
        </Pressable>

        <Pressable
          onPress={confirmLogout}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.logoutBtn,
            { borderColor: colors.danger, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <IconLogout size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: '700', marginLeft: 8 }}>
            {L('Se déconnecter', 'Sign out')}
          </Text>
        </Pressable>

        <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12 }}>
          TransLog Pro Mobile · v0.1.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ text, colors }: { text: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <Text style={{
      fontSize:        11,
      fontWeight:      '700',
      letterSpacing:   0.6,
      color:           colors.textMuted,
      paddingHorizontal: 14,
      paddingTop:        12,
      paddingBottom:     6,
    }}>
      {text}
    </Text>
  );
}

function Row({
  icon: Icon, label, onPress, colors,
}: {
  icon: typeof IconKey;
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Icon size={20} color={colors.text} />
      <Text style={{ color: colors.text, flex: 1, marginLeft: 12, fontWeight: '500' }}>{label}</Text>
      <IconChevronR size={18} color={colors.textMuted} />
    </Pressable>
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
      <Switch value={value} onValueChange={onToggle} disabled={busy} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner:      { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  section:     { padding: 14, borderRadius: 12, borderWidth: 1, gap: 4 },
  sectionTitle:{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  row:         {
    flexDirection: 'row',
    alignItems:    'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  channelRow:  {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  localeRow:   { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  localeChip:  { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, minHeight: 40 },
  logoutBtn:   {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent:'center',
    paddingVertical: 14,
    borderRadius:    12,
    borderWidth:     1,
  },
});
