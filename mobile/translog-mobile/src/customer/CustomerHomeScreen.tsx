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
    id?:                string;
    departureScheduled: string;
    arrivalActual?:     string | null;
    status?:            string;
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

  // Trajet récemment terminé (≤ 7 jours) sans feedback connu côté front.
  // Le serveur dédoublonne via la contrainte (ticketId, userId) — l'écran SAV
  // gère le 409/422 si le feedback existe déjà. Ici on amorce le prompt seulement.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
  const recentlyCompleted = useMemo(() => {
    const now = Date.now();
    return tickets.find(tk => {
      const arrived = tk.trip?.arrivalActual ?? tk.trip?.departureScheduled;
      if (!arrived) return false;
      const arrivedAt = new Date(arrived).getTime();
      const isCompleted =
        tk.trip?.status === 'COMPLETED' ||
        tk.status === 'CHECKED_IN' ||
        tk.status === 'BOARDED';
      return isCompleted && arrivedAt < now && now - arrivedAt < SEVEN_DAYS_MS;
    });
  }, [tickets]);

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

        {/* ── Prompt feedback post-trip (≤ 7j sans avis) ──────────────── */}
        {recentlyCompleted && recentlyCompleted.trip && (
          <Pressable
            onPress={() => navigation.navigate('CustomerSav', { ticketId: recentlyCompleted.id })}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.feedbackCard,
              { borderColor: colors.warning, backgroundColor: colors.warningBg, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={{ fontSize: 22 }}>⭐</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.warning, fontWeight: '800' }}>
                {L('Notez votre dernier voyage', 'Rate your last trip')}
              </Text>
              <Text style={{ color: colors.text, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {recentlyCompleted.trip.route?.origin?.name ?? '?'} → {recentlyCompleted.trip.route?.destination?.name ?? '?'}
              </Text>
            </View>
            <Text style={{ color: colors.warning, fontSize: 18, fontWeight: '700' }}>›</Text>
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
            label={L('Mes bons', 'My vouchers')}
            icon="🎁"
            onPress={() => navigation.navigate('CustomerVouchers')}
            color={colors.surface} fg={colors.text} colors={colors}
          />
          <Tile
            label={L('SAV & avis', 'SAV & feedback')}
            icon="💬"
            onPress={() => navigation.navigate('CustomerSav')}
            color={colors.surface} fg={colors.text} colors={colors}
          />
          <Tile
            label={L('Mon profil', 'My profile')}
            icon="👤"
            onPress={() => navigation.navigate('CustomerProfile')}
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
  feedbackCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  grid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile:         { flexBasis: '47%', flexGrow: 1, aspectRatio: 1, padding: 16, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge:        { position: 'absolute', top: 8, right: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, minWidth: 20, alignItems: 'center' },
});
