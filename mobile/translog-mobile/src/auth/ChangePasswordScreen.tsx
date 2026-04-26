/**
 * ChangePasswordScreen — écran partagé tous profils.
 *
 * POST /api/auth/change-password { currentPassword, newPassword }.
 * Le backend invalide toutes les autres sessions du user après succès,
 * conserve la session courante. Si le user passe par MFA, ce flow ne le
 * réinvalide pas (juste le password).
 */

import { useState, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, SafeAreaView, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiPost } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/useI18n';
import { useAuth } from './AuthContext';
import { ScreenHeader } from '../ui/ScreenHeader';
import { IconEye, IconEyeOff } from '../ui/icons';

export function ChangePasswordScreen() {
  const { colors } = useTheme();
  const { lang } = useI18n();
  const { logout } = useAuth();
  const nav = useNavigation<NavigationProp<any>>();
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd,     setNewPwd]     = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showCur,    setShowCur]    = useState(false);
  const [showNew,    setShowNew]    = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const newRef     = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  function strengthHint(pwd: string): { ok: boolean; msg: string } {
    if (pwd.length < 8) return { ok: false, msg: L('Min 8 caractères', 'Min 8 chars') };
    if (!/[A-Z]/.test(pwd) || !/[0-9]/.test(pwd))
      return { ok: false, msg: L('Mélanger lettres + chiffres', 'Mix letters + digits') };
    return { ok: true, msg: L('Solide ✓', 'Strong ✓') };
  }
  const strength = strengthHint(newPwd);

  async function submit() {
    setError(null);
    if (newPwd !== confirmPwd) {
      setError(L('Les nouveaux mots de passe ne correspondent pas.', 'New passwords do not match.'));
      return;
    }
    if (!strength.ok) {
      setError(strength.msg);
      return;
    }
    if (currentPwd === newPwd) {
      setError(L('Le nouveau mot de passe doit être différent.', 'New password must differ.'));
      return;
    }
    setBusy(true);
    try {
      await apiPost('/api/auth/change-password',
        { currentPassword: currentPwd, newPassword: newPwd },
        { skipAuthRedirect: true });
      Alert.alert(
        L('Mot de passe changé ✓', 'Password changed ✓'),
        L('Toutes vos autres sessions ont été déconnectées par sécurité.',
          'All your other sessions have been signed out for safety.'),
        [{ text: 'OK', onPress: () => nav.goBack() }],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={L('Changer mon mot de passe', 'Change password')} onBack={() => nav.goBack()} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            {L('Pour votre sécurité, toutes vos autres sessions seront déconnectées après changement.',
               'For your safety, all your other sessions will be signed out after change.')}
          </Text>

          <PwdField
            label={L('Mot de passe actuel', 'Current password')}
            value={currentPwd}
            onChange={setCurrentPwd}
            visible={showCur}
            toggleVisible={() => setShowCur(!showCur)}
            onSubmitEditing={() => newRef.current?.focus()}
            colors={colors}
            returnKeyType="next"
          />
          <PwdField
            inputRef={newRef}
            label={L('Nouveau mot de passe', 'New password')}
            value={newPwd}
            onChange={setNewPwd}
            visible={showNew}
            toggleVisible={() => setShowNew(!showNew)}
            onSubmitEditing={() => confirmRef.current?.focus()}
            colors={colors}
            returnKeyType="next"
          />
          {newPwd.length > 0 && (
            <Text style={{
              color: strength.ok ? colors.success : colors.warning,
              fontSize: 12,
              marginTop: -8,
            }}>
              {strength.msg}
            </Text>
          )}

          <PwdField
            inputRef={confirmRef}
            label={L('Confirmer le nouveau', 'Confirm new')}
            value={confirmPwd}
            onChange={setConfirmPwd}
            visible={showNew}
            toggleVisible={() => setShowNew(!showNew)}
            onSubmitEditing={submit}
            colors={colors}
            returnKeyType="done"
          />

          {error && (
            <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>
              {error}
            </Text>
          )}

          <Pressable
            onPress={submit}
            disabled={busy || !currentPwd || !newPwd || !confirmPwd}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: colors.primary, opacity: pressed || busy ? 0.7 : 1 },
            ]}
          >
            {busy
              ? <ActivityIndicator color={colors.primaryFg} />
              : <Text style={{ color: colors.primaryFg, fontWeight: '700', fontSize: 16 }}>
                  {L('Changer', 'Change')}
                </Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PwdField({
  label, value, onChange, visible, toggleVisible, onSubmitEditing, colors, inputRef, returnKeyType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  toggleVisible: () => void;
  onSubmitEditing?: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  inputRef?: React.RefObject<TextInput | null>;
  returnKeyType?: 'next' | 'done';
}) {
  return (
    <View>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 4 }}>
        {label}
      </Text>
      <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <TextInput
          ref={inputRef as any}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={label}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          style={{ flex: 1, color: colors.text, fontSize: 16, padding: 12 }}
        />
        <Pressable onPress={toggleVisible} hitSlop={8} style={{ padding: 12 }}>
          {visible
            ? <IconEyeOff size={18} color={colors.textMuted} />
            : <IconEye    size={18} color={colors.textMuted} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10 },
  btn:       { marginTop: 16, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
