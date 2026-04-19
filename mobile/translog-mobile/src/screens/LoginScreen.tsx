import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, SafeAreaView,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';

export function LoginScreen() {
  const { login } = useAuth();
  const { lang } = useI18n();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pas de `t()` ici : les clés auth.password / common.login n'existent pas
  // dans nos dicts et `t()` retourne la clé littérale si absente. FR+EN inline
  // pour un écran de login simple — cohérent avec le reste de l'app mobile.
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  async function submit() {
    if (!email || !password) return;
    setBusy(true); setError(null);
    try { await login(email.trim(), password); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

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
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          />

          {error && (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
              {error}
            </Text>
          )}

          <Pressable
            onPress={submit}
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
        </ScrollView>
      </KeyboardAvoidingView>
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
  error:   { marginTop: 4, fontSize: 13 },
  btn:     { marginTop: 20, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '700' },
});
