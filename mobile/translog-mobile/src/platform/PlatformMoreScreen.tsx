/**
 * PlatformMoreScreen — onglet "Plus" du super-admin.
 *
 * Contient les actions secondaires : profil, déconnexion, infos app, lien
 * vers le portail web pour les actions complexes (Workflow Studio, billing
 * détaillé, gestion plans, intégrations cross-tenant).
 *
 * Pas d'inbox notifications dans cette v1 — ajout futur.
 */

import {
  View, Text, SafeAreaView, ScrollView, Pressable, StyleSheet, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/useI18n';
import { ScreenHeader } from '../ui/ScreenHeader';
import { useTenantHost } from '../api/TenantHostProvider';
import {
  IconUserCircle, IconLogout, IconKey, IconGlobe, IconHelp,
} from '../ui/icons';

export function PlatformMoreScreen() {
  const { user, logout } = useAuth();
  const { clearTenant } = useTenantHost();
  const { t, lang } = useI18n();
  const { colors } = useTheme();
  const nav = useNavigation<NavigationProp<{ ChangePassword: undefined }>>();

  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

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
      <ScreenHeader title={L('Plus', 'More')} />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* Identité */}
        <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {L('PROFIL', 'PROFILE')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <IconUserCircle size={36} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {user?.name ?? L('(sans nom)', '(no name)')}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }} selectable>
                {user?.email}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                {L('Console plateforme', 'Platform console')} · {user?.userType}
              </Text>
            </View>
          </View>
        </View>

        {/* Sécurité */}
        <Row
          icon={IconKey}
          label={L('Changer mon mot de passe', 'Change my password')}
          onPress={() => nav.navigate('ChangePassword')}
          colors={colors}
        />

        {/* Switch tenant */}
        <Row
          icon={IconGlobe}
          label={L('Changer de société', 'Switch company')}
          onPress={confirmSwitchTenant}
          colors={colors}
        />

        {/* Help */}
        <Row
          icon={IconHelp}
          label={L('Aide & support', 'Help & support')}
          onPress={() => Alert.alert(L('Support', 'Support'),
            L('Pour une assistance approfondie, utilisez le portail web : admin.translog.dsyann.info',
              'For deep assistance, use the web portal: admin.translog.dsyann.info'))}
          colors={colors}
        />

        {/* Déconnexion */}
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
        { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon size={20} color={colors.text} />
      <Text style={{ color: colors.text, flex: 1, marginLeft: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section:      { padding: 14, borderRadius: 12, borderWidth: 1 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  row:          { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1 },
  logoutBtn:    {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent:'center',
    paddingVertical: 14,
    borderRadius:    12,
    borderWidth:     1,
    marginTop:       12,
  },
});
