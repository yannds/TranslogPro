import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, SafeAreaView, ScrollView, KeyboardAvoidingView, Platform, Alert, StyleSheet,
} from 'react-native';
import { apiPost, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { enqueueMutation } from '../offline/outbox';

const TYPES = ['ACCIDENT', 'BREAKDOWN', 'THEFT', 'DELAY', 'PASSENGER', 'INFRASTRUCTURE', 'OTHER'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export function IncidentReportScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const [type,        setType]        = useState<(typeof TYPES)[number]>('PASSENGER');
  const [severity,    setSeverity]    = useState<(typeof SEVERITIES)[number]>('MEDIUM');
  const [description, setDescription] = useState('');
  const [location,    setLocation]    = useState('');
  const [busy,        setBusy]        = useState(false);

  async function submit() {
    if (description.trim().length < 10) {
      Alert.alert(t('customerIncidents.errorDescription') ?? 'Description trop courte');
      return;
    }
    setBusy(true);
    const body = {
      type, severity,
      description: description.trim(),
      locationDescription: location.trim() || undefined,
      isSos: false,
    };
    try {
      if (!online) {
        await enqueueMutation({
          tenantId,
          kind: 'incident.create.mine',
          method: 'POST',
          url:   `/api/tenants/${tenantId}/incidents/mine`,
          body,
          context: body,
        });
        Alert.alert(t('offline.bannerOffline') ?? '', t('customerIncidents.offlineHint') ?? '');
      } else {
        await apiPost(`/api/tenants/${tenantId}/incidents/mine`, body);
        Alert.alert(t('customerIncidents.title') ?? 'OK', t('publicReport.thankDesc') ?? '');
      }
      setDescription('');
      setLocation('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        Alert.alert('', t('customerIncidents.errorRateLimit') ?? '');
      } else {
        Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Text style={[styles.h1, { color: colors.text }]}>
            {t('customerIncidents.newTitle') ?? 'Signaler un incident'}
          </Text>
          <Text style={{ color: colors.textMuted }}>
            {t('customerIncidents.newDesc') ?? ''}
          </Text>

          <Text style={[styles.label, { color: colors.text }]}>
            {t('customerIncidents.typeLabel') ?? 'Type'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {TYPES.map(v => (
              <Pressable
                key={v}
                onPress={() => setType(v)}
                accessibilityRole="radio"
                accessibilityState={{ selected: type === v }}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: type === v ? colors.primary : colors.surface },
                ]}
              >
                <Text style={{ color: type === v ? colors.primaryFg : colors.text, fontSize: 13 }}>
                  {t(`customerIncidents.type_${v}`) ?? v}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { color: colors.text }]}>
            {t('customerIncidents.severityLabel') ?? 'Gravité'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {SEVERITIES.map(v => (
              <Pressable
                key={v}
                onPress={() => setSeverity(v)}
                accessibilityRole="radio"
                accessibilityState={{ selected: severity === v }}
                style={[
                  styles.chip,
                  { flex: 1, borderColor: colors.border, backgroundColor: severity === v ? colors.primary : colors.surface },
                ]}
              >
                <Text style={{ color: severity === v ? colors.primaryFg : colors.text, fontSize: 13, textAlign: 'center' }}>
                  {t(`customerIncidents.severity_${v}`) ?? v}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { color: colors.text }]}>
            {t('customerIncidents.descriptionLabel') ?? 'Description'} *
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={5}
            accessibilityLabel="Description"
            placeholder={t('customerIncidents.descriptionHint') ?? ''}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { minHeight: 110, textAlignVertical: 'top', color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          />

          <Text style={[styles.label, { color: colors.text }]}>
            {t('customerIncidents.locationLabel') ?? 'Lieu'}
          </Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder={t('customerIncidents.locationPlaceholder') ?? ''}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Location"
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          />

          <Pressable
            onPress={submit}
            disabled={busy}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: colors.primary, opacity: busy || pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
              {online ? (t('customerIncidents.submit') ?? 'Envoyer') : (t('customerIncidents.submitQueued') ?? 'Mettre en file')}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:    { fontSize: 22, fontWeight: '800' },
  label: { fontSize: 13, fontWeight: '600', marginTop: 10 },
  chip:  { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, minHeight: 44, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  btn:   { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
});
