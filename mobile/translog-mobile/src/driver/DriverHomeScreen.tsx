import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, ActivityIndicator, RefreshControl, Pressable, StyleSheet, Alert,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { enqueueMutation } from '../offline/outbox';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

interface TripItem {
  id:                 string;
  departureScheduled: string;
  status:             string;
  driverId:           string | null;
  route?: {
    origin?:      { name: string };
    destination?: { name: string };
  };
  bus?: { plate?: string; model?: string };
}

/**
 * Écran Chauffeur — trajets du jour + SOS rapide (offline-tolerant).
 *   - `GET /tenants/:tid/trips?status=...&driverId=...` : scoping serveur (data.trip.read.own)
 *   - Bouton SOS : POST /incidents {isSos:true} via outbox si offline
 *
 * Permissions requises côté backend : data.trip.read.own + data.trip.report.own.
 */
export function DriverHomeScreen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const navigation = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const [trips, setTrips] = useState<TripItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      // Endpoint tenant-scoped ; driverId filtre côté backend (staffId côté serveur).
      const params = new URLSearchParams();
      params.set('status', 'PLANNED');
      params.append('status', 'OPEN');
      params.append('status', 'BOARDING');
      if (user?.staffId) params.set('driverId', user.staffId);
      const res = await apiGet<TripItem[]>(
        `/api/tenants/${tenantId}/trips?${params.toString()}`,
        { skipAuthRedirect: true },
      );
      // Tri par départ ascendant
      setTrips(
        [...res].sort((a, b) =>
          new Date(a.departureScheduled).getTime() - new Date(b.departureScheduled).getTime(),
        ),
      );
    } catch {
      /* offline / erreur — on garde l'ancien état */
    }
  }, [tenantId, user?.staffId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function onPullRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  async function triggerSos() {
    Alert.alert(
      'SOS',
      online ? 'Envoyer un signalement SOS immédiat ?' : 'Hors ligne — le signalement sera mis en file.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Envoyer', style: 'destructive',
          onPress: async () => {
            const body = {
              type: 'ACCIDENT',
              severity: 'CRITICAL',
              description: 'SOS déclenché depuis l\'app chauffeur',
              isSos: true,
            };
            try {
              if (!online) {
                await enqueueMutation({
                  tenantId,
                  kind: 'sos.driver',
                  method: 'POST',
                  url: `/api/tenants/${tenantId}/incidents`,
                  body,
                  context: body,
                });
                Alert.alert('Mis en file', 'Sera envoyé dès reconnexion.');
              } else {
                const { apiPost } = await import('../api/client');
                await apiPost(`/api/tenants/${tenantId}/incidents`, body);
                Alert.alert('SOS envoyé', 'Dispatch alerté.');
              }
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.h1, { color: colors.text }]}>TransLog — Chauffeur</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{user?.name ?? user?.email}</Text>
        </View>
        <Pressable
          onPress={logout}
          accessibilityRole="button"
          style={{ padding: 12, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: colors.danger, fontWeight: '600' }}>⎋</Text>
        </Pressable>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <Pressable
        onPress={triggerSos}
        accessibilityRole="button"
        accessibilityLabel="Bouton SOS"
        style={({ pressed }) => [
          styles.sos,
          { backgroundColor: colors.danger, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={styles.sosText}>⚠  SOS</Text>
      </Pressable>

      <View style={styles.quickRow}>
        <Pressable
          onPress={() => navigation.navigate('DriverDocuments')}
          accessibilityRole="button"
          accessibilityLabel="Mes documents"
          style={({ pressed }) => [
            styles.quickBtn,
            { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>📄  Documents</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('DriverRest')}
          accessibilityRole="button"
          accessibilityLabel="Temps de repos"
          style={({ pressed }) => [
            styles.quickBtn,
            { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: '700' }}>🛌  Repos</Text>
        </Pressable>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />}

      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={
          !loading ? (
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 32 }}>
              Aucun trajet planifié aujourd'hui.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('DriverTripDetail', { tripId: item.id })}
            accessibilityRole="button"
            accessibilityLabel={`Trajet ${item.route?.origin?.name} vers ${item.route?.destination?.name}`}
            style={({ pressed }) => [styles.card, {
              borderColor: colors.border,
              backgroundColor: colors.surface,
              opacity: pressed ? 0.85 : 1,
            }]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {item.route?.origin?.name ?? '?'} → {item.route?.destination?.name ?? '?'}
              </Text>
              <View style={[styles.badge, { backgroundColor: colors.primaryFg, borderColor: colors.primary }]}>
                <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>{item.status}</Text>
              </View>
            </View>
            <Text style={{ color: colors.textMuted, marginTop: 4 }}>
              {new Date(item.departureScheduled).toLocaleString(undefined, {
                weekday: 'short', day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit',
              })}
            </Text>
            {item.bus && (
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                {item.bus.plate ?? '?'} {item.bus.model ? ` · ${item.bus.model}` : ''}
              </Text>
            )}
            <Text style={{ color: colors.primary, fontSize: 12, marginTop: 6, fontWeight: '600' }}>
              Détails ›
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  h1:        { fontSize: 20, fontWeight: '800' },
  banner:    { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8 },
  sos:       { marginHorizontal: 16, marginBottom: 8, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sosText:   { color: 'white', fontWeight: '800', fontSize: 20, letterSpacing: 2 },
  quickRow:  { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, gap: 8 },
  quickBtn:  { flex: 1, height: 48, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  card:      { padding: 14, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  badge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
});
