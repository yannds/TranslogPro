/**
 * CustomerHomeScreen — Accueil voyageur/expéditeur.
 *
 * 4 tuiles principales :
 *   - Réserver un voyage (navigate CustomerBooking)
 *   - Mes billets & colis (navigate CustomerMyItems)
 *   - SAV & avis (navigate CustomerSav)
 *   - Signaler un incident (existant — via IncidentReport tab)
 *
 * Affiche aussi un aperçu rapide :
 *   - Prochain voyage (si billet CONFIRMED futur)
 *   - Nombre de colis EN COURS (IN_TRANSIT | OUT_FOR_DELIVERY)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, StyleSheet, RefreshControl,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';

interface Ticket {
  id:             string;
  status:         string;
  trip?: {
    departureScheduled: string;
    route?: { origin?: { name: string }; destination?: { name: string } };
  };
}

interface Parcel {
  id:     string;
  status: string;
}

const IN_TRANSIT_STATUSES = ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ACCEPTED', 'LOADED'];

export function CustomerHomeScreen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const navigation = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [tk, pc] = await Promise.all([
        apiGet<Ticket[]>(`/api/tenants/${tenantId}/tickets/my`, { skipAuthRedirect: true }),
        apiGet<Parcel[]>(`/api/tenants/${tenantId}/parcels/my`, { skipAuthRedirect: true }),
      ]);
      setTickets(tk ?? []);
      setParcels(pc ?? []);
    } catch { /* offline : on garde snapshot */ }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const nextTrip = useMemo(() => {
    const future = tickets
      .filter(t =>
        (t.status === 'CONFIRMED' || t.status === 'CHECKED_IN')
        && t.trip?.departureScheduled
        && new Date(t.trip.departureScheduled).getTime() > Date.now(),
      )
      .sort((a, b) =>
        new Date(a.trip!.departureScheduled).getTime() -
        new Date(b.trip!.departureScheduled).getTime(),
      );
    return future[0] ?? null;
  }, [tickets]);

  const parcelsInTransit = useMemo(
    () => parcels.filter(p => IN_TRANSIT_STATUSES.includes(p.status)).length,
    [parcels],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.h1, { color: colors.text }]}>
            {L(`Bonjour ${user?.name ?? ''}`, `Hello ${user?.name ?? ''}`)}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>{user?.email}</Text>
        </View>
        <Pressable onPress={logout} accessibilityRole="button" style={styles.logoutBtn}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>⎋</Text>
        </Pressable>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
      >
        {/* ── Prochain voyage ─────────────────────────────────────────── */}
        {nextTrip && nextTrip.trip && (
          <Pressable
            onPress={() => navigation.navigate('CustomerMyItems')}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.nextTripCard,
              { borderColor: colors.primary, backgroundColor: colors.primaryFg + '11', opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 11, letterSpacing: 1 }}>
              {L('PROCHAIN VOYAGE', 'NEXT TRIP')}
            </Text>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginTop: 6 }}>
              {nextTrip.trip.route?.origin?.name ?? '?'} → {nextTrip.trip.route?.destination?.name ?? '?'}
            </Text>
            <Text style={{ color: colors.textMuted, marginTop: 2 }}>
              {new Date(nextTrip.trip.departureScheduled).toLocaleString(lang, {
                weekday: 'long', day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit',
              })}
            </Text>
            <Text style={{ color: colors.primary, fontSize: 12, marginTop: 8, fontWeight: '700' }}>
              {L('Afficher le QR', 'Show QR')} ›
            </Text>
          </Pressable>
        )}

        {/* ── Tuiles ──────────────────────────────────────────────────── */}
        <View style={styles.grid}>
          <Tile
            label={L('Réserver', 'Book trip')}
            icon="🎫"
            onPress={() => navigation.navigate('CustomerBooking')}
            color={colors.primary} fg={colors.primaryFg} colors={colors}
          />
          <Tile
            label={L(`Mes items (${tickets.length + parcels.length})`, `My items (${tickets.length + parcels.length})`)}
            icon="📋"
            onPress={() => navigation.navigate('CustomerMyItems')}
            color={colors.surface} fg={colors.text} colors={colors}
            badge={parcelsInTransit > 0 ? String(parcelsInTransit) : undefined}
          />
          <Tile
            label={L('SAV & avis', 'SAV & feedback')}
            icon="💬"
            onPress={() => navigation.navigate('CustomerSav')}
            color={colors.surface} fg={colors.text} colors={colors}
          />
          <Tile
            label={L('Signaler', 'Report')}
            icon="⚠"
            onPress={() => navigation.navigate('Signalement')}
            color={colors.surface} fg={colors.text} colors={colors}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({
  label, icon, onPress, color, fg, colors, badge,
}: {
  label: string; icon: string;
  onPress: () => void;
  color: string; fg: string;
  colors: Record<string, string>;
  badge?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: color, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={{ fontSize: 32 }}>{icon}</Text>
      <Text style={{ color: fg, fontWeight: '700', marginTop: 8, textAlign: 'center' }}>
        {label}
      </Text>
      {badge && (
        <View style={[styles.badge, { backgroundColor: colors.warning }]}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  h1:           { fontSize: 20, fontWeight: '800' },
  logoutBtn:    { padding: 12, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:       { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  nextTripCard: { padding: 16, borderRadius: 12, borderWidth: 2 },
  grid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile:         { flexBasis: '47%', flexGrow: 1, aspectRatio: 1, padding: 16, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge:        { position: 'absolute', top: 8, right: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, minWidth: 20, alignItems: 'center' },
});
