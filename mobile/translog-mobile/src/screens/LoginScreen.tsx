import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, SafeAreaView, Modal,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Écran de connexion mobile — multi-tenant SaaS.
 *
 * UX simple : juste email + password. L'app interroge l'API cross-tenant
 * (`api.translog.dsyann.info/api/auth/sign-in-cross-tenant`) qui découvre
 * automatiquement à quelle société appartient cet email.
 *
 * 3 cas possibles :
 *   - Cas standard : login direct (AuthProvider hydrate l'user, AppNavigator route).
 *   - Cas MFA : on bascule sur l'écran code à 6 chiffres (TOTP).
 *   - Cas multi-tenants (rare) : modal pour choisir la société.
 */
export function LoginScreen() {
  const { login, verifyMfa } = useAuth();
  const { lang } = useI18n();
  const { colors } = useTheme();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // État MFA (étape 2 si requis).
  const [mfaPending,    setMfaPending]    = useState<{ challengeToken: string; expiresAt: string; tenantHost: string } | null>(null);
  const [mfaCode,       setMfaCode]       = useState('');
  const mfaInputRef = useRef<TextInput>(null);

  // Modal de choix multi-tenants (cas rare).
  const [pickerOpen,    setPickerOpen]    = useState(false);
  const [tenantChoices, setTenantChoices] = useState<Array<{ slug: string; name: string }>>([]);

  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  // Auto-focus le champ MFA quand on bascule sur l'étape code.
  useEffect(() => {
    if (mfaPending) {
      const t = setTimeout(() => mfaInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [mfaPending]);

  async function submit(preferredTenantSlug?: string) {
    if (!email || !password) return;
    setBusy(true); setError(null);
    try {
      const result = await login(email.trim(), password, preferredTenantSlug);
      if (!result) return; // succès — AppNavigator prend le relais

      if ('multiple' in result && result.multiple) {
        setTenantChoices(result.tenants);
        setPickerOpen(true);
        return;
      }

      if ('mfaRequired' in result && result.mfaRequired) {
        setMfaPending({
          challengeToken: result.challengeToken,
          expiresAt:      result.expiresAt,
          tenantHost:     result.tenantHost,
        });
        setMfaCode('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa() {
    if (!mfaPending || mfaCode.trim().length < 6) return;
    setBusy(true); setError(null);
    try {
      await verifyMfa(mfaCode.trim(), mfaPending.challengeToken);
      // Succès → AppNavigator prend le relais
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMfaCode('');
      setTimeout(() => mfaInputRef.current?.focus(), 50);
    } finally {
      setBusy(false);
    }
  }

  async function pickTenant(slug: string) {
    setPickerOpen(false);
    await submit(slug);
  }

  function cancelMfa() {
    setMfaPending(null);
    setMfaCode('');
    setError(null);
  }

  // ── Étape MFA (post-password) ─────────────────────────────────────────
  if (mfaPending) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
              {L('Vérification', 'Verification')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              {L(
                'Entrez le code à 6 chiffres de votre application d’authentification.',
                'Enter the 6-digit code from your authenticator app.',
              )}
            </Text>

            <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
              {L('Société', 'Company')} : <Text style={{ color: colors.text, fontWeight: '700' }}>{mfaPending.tenantHost.split('.')[0]}</Text>
            </Text>

            <Text style={[styles.label, { color: colors.text }]}>{L('Code', 'Code')}</Text>
            <TextInput
              ref={mfaInputRef}
              value={mfaCode}
              onChangeText={(v) => setMfaCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              accessibilityLabel="MFA code"
              placeholder="000000"
              placeholderTextColor={colors.textMuted}
              maxLength={6}
              onSubmitEditing={submitMfa}
              style={[
                styles.input,
                styles.mfaInput,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            />

            {error && (
              <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
                {error}
              </Text>
            )}

            <Pressable
              onPress={submitMfa}
              disabled={busy || mfaCode.length < 6}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: colors.primary, opacity: pressed || busy ? 0.7 : 1 },
              ]}
              accessibilityRole="button"
            >
              {busy
                ? <ActivityIndicator color={colors.primaryFg} />
                : <Text style={[styles.btnText, { color: colors.primaryFg }]}>{L('Valider', 'Verify')}</Text>}
            </Pressable>

            <Pressable
              onPress={cancelMfa}
              accessibilityRole="button"
              style={{ marginTop: 12, alignItems: 'center', paddingVertical: 8 }}
            >
              <Text style={{ color: colors.textMuted }}>
                {L('Recommencer la connexion', 'Start over')}
              </Text>
            </Pressable>

            <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12 }}>
              {L(
                'Le challenge expire dans 5 minutes. Maximum 5 tentatives.',
                'Challenge expires in 5 minutes. Max 5 attempts.',
              )}
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Étape 1 : email + password ────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            TransLog Pro
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {L('Connexion', 'Sign in')}
          </Text>

          <Text style={[styles.label, { color: colors.text }]}>{L('Email', 'Email')}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            accessibilityLabel="Email"
            placeholder="name@example.com"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          />

          <Text style={[styles.label, { color: colors.text }]}>{L('Mot de passe', 'Password')}</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            accessibilityLabel="Password"
            onSubmitEditing={() => submit()}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          />

          {error && (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
              {error}
            </Text>
          )}

          <Pressable
            onPress={() => submit()}
            disabled={busy || !email || !password}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: colors.primary, opacity: pressed || busy ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
          >
            {busy
              ? <ActivityIndicator color={colors.primaryFg} />
              : <Text style={[styles.btnText, { color: colors.primaryFg }]}>{L('Se connecter', 'Sign in')}</Text>}
          </Pressable>

          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 16 }}>
            {L(
              'L’app détecte automatiquement votre société à partir de votre email.',
              'The app auto-detects your company from your email.',
            )}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Modal de choix multi-tenants (cas rare) ─────────────────────── */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {L('Choisir votre société', 'Choose your company')}
            </Text>
            <Text style={{ color: colors.textMuted, marginBottom: 12 }}>
              {L(
                'Votre adresse a un compte sur plusieurs sociétés.',
                'Your email has an account on multiple companies.',
              )}
            </Text>
            {tenantChoices.map(t => (
              <Pressable
                key={t.slug}
                onPress={() => pickTenant(t.slug)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.choice,
                  { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>{t.name}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t.slug}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setPickerOpen(false)}
              accessibilityRole="button"
              style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}
            >
              <Text style={{ color: colors.textMuted }}>{L('Annuler', 'Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  scroll:  { padding: 24, gap: 12, justifyContent: 'center', minHeight: '100%' },
  title:   { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  subtitle:{ fontSize: 14, marginBottom: 16 },
  label:   { fontSize: 13, fontWeight: '600', marginTop: 8 },
  input:   { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  mfaInput:{ fontSize: 28, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  error:   { marginTop: 4, fontSize: 13 },
  btn:     { marginTop: 20, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.7)', justifyContent: 'flex-end' },
  modalSheet:    { padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 8 },
  modalTitle:    { fontSize: 18, fontWeight: '800' },
  choice:        { padding: 16, borderRadius: 12, borderWidth: 1, marginVertical: 4 },
});
