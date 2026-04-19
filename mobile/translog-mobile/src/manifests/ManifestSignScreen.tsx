/**
 * ManifestSignScreen — signature tactile d'un manifest trip (offline-tolérant).
 *
 * Flux :
 *   1. Saisie tripId (manuel ou depuis la liste écran Quai).
 *   2. L'agent signe à l'écran.
 *   3. Online → POST /manifests/:id/sign avec SVG dans le body.
 *   4. Offline → enqueue outbox avec idempotency = manifestId.
 *
 * Pas de magic number, i18n FR+EN inline.
 * La signature est stockée SOUS FORME SVG (≤ quelques KB, facile à auditer).
 */

import { useRef, useState } from 'react';
import {
  View, Text, SafeAreaView, Pressable, TextInput, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { apiPost } from '../api/client';
import { enqueueMutation } from '../offline/outbox';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { SignaturePad, type SignaturePadRef } from './SignaturePad';

export function ManifestSignScreen() {
  const { user } = useAuth();
  const { lang, t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const padRef = useRef<SignaturePadRef>(null);
  const [manifestId, setManifestId] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const id = manifestId.trim();
    if (id.length < 1) {
      Alert.alert(lang === 'en' ? 'Manifest id required' : 'Identifiant manifest requis');
      return;
    }
    const svg = padRef.current?.toSvg();
    if (!svg) {
      Alert.alert(lang === 'en' ? 'Signature empty' : 'Signature vide');
      return;
    }
    setBusy(true);
    const url  = `/api/tenants/${tenantId}/manifests/${id}/sign`;
    const body = { signatureSvg: svg };
    const key  = `manifest-sign:${id}`;
    try {
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'manifest.sign', method: 'POST',
          url, body, context: { manifestId: id },
          idempotencyKey: key,
        });
        Alert.alert(
          lang === 'en' ? 'Queued' : 'En file',
          t('offline.bannerOffline') ?? '',
        );
      } else {
        await apiPost(url, body, { skipAuthRedirect: true, headers: { 'Idempotency-Key': key } });
        Alert.alert('OK', lang === 'en' ? 'Manifest signed.' : 'Manifest signé.');
      }
      padRef.current?.clear();
      setHasInk(false);
      setManifestId('');
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={[styles.h1, { color: colors.text }]}>
          {lang === 'en' ? 'Sign manifest' : 'Signer un manifest'}
        </Text>

        {!online && (
          <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
            <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
          </View>
        )}

        <View>
          <Text style={[styles.label, { color: colors.text }]}>
            {lang === 'en' ? 'Manifest ID' : 'Identifiant manifest'}
          </Text>
          <TextInput
            value={manifestId}
            onChangeText={setManifestId}
            autoCapitalize="none"
            accessibilityLabel="Manifest id"
            placeholder="manifest_..."
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          />
        </View>

        <View>
          <Text style={[styles.label, { color: colors.text }]}>
            {lang === 'en' ? 'Signature (touch to sign)' : 'Signature (signez avec le doigt)'}
          </Text>
          <View style={{ marginTop: 6 }}>
            <SignaturePad ref={padRef} onChange={setHasInk} background="#ffffff" />
          </View>
          <Pressable
            onPress={() => { padRef.current?.clear(); setHasInk(false); }}
            accessibilityRole="button"
            style={[styles.btnGhost, { borderColor: colors.border }]}
          >
            <Text style={{ color: colors.text }}>
              {lang === 'en' ? 'Clear' : 'Effacer'}
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={submit}
          disabled={busy || !hasInk}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.btnPrimary,
            { backgroundColor: colors.primary, opacity: busy || !hasInk || pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
            {busy
              ? (lang === 'en' ? 'Signing…' : 'Envoi…')
              : (lang === 'en' ? 'Sign manifest' : 'Signer le manifest')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:         { fontSize: 20, fontWeight: '800' },
  banner:     { padding: 10, borderRadius: 8 },
  label:      { fontSize: 13, fontWeight: '600' },
  input:      { marginTop: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  btnGhost:   { marginTop: 8, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  btnPrimary: { marginTop: 4, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
