/**
 * CustomerVouchersScreen — Mes bons / vouchers (lecture seule).
 *
 * Source : GET /api/tenants/:tid/vouchers/my (existant, perm VOUCHER_READ_OWN).
 * Affiche les vouchers ACTIVE du customer connecté avec :
 *   - Code (à présenter en caisse / coller dans le booking flow)
 *   - Montant + devise + scope (TICKET / TRIP / PARCEL)
 *   - Date d'expiration
 *
 * Pas d'action de redemption ici — le redeem se fait au moment du paiement
 * dans le booking flow (existing). Ici c'est juste une vue d'inventaire.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, StyleSheet, RefreshControl,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { useI18n } from '../i18n/useI18n';
import { Loading } from '../ui/Loading';
import { EmptyState } from '../ui/EmptyState';
import { ScreenHeader } from '../ui/ScreenHeader';
import { IconAward, IconRefresh } from '../ui/icons';

interface Voucher {
  id:        string;
  code:      string;
  amount:    number;
  currency:  string;
  scope:     string; // TICKET | TRIP | PARCEL
  status:    string; // ACTIVE | REDEEMED | EXPIRED | CANCELLED
  expiresAt: string | null;
  createdAt: string;
  notes?:    string | null;
}

export function CustomerVouchersScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const { t } = useI18n();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const lang = (user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [items,    setItems]    = useState<Voucher[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await apiGet<Voucher[]>(
        `/api/tenants/${tenantId}/vouchers/my`,
        { skipAuthRedirect: true },
      );
      setItems(res ?? []);
    } catch {
      setItems([]);
    }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onPullRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Filtre : seuls les ACTIVE sont utilisables (les REDEEMED/EXPIRED restent pour info)
  const active  = items.filter(v => v.status === 'ACTIVE');
  const others  = items.filter(v => v.status !== 'ACTIVE');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={L('Mes bons', 'My vouchers')}
        subtitle={`${active.length} ${L('actif(s)', 'active')}`}
        onBack={() => nav.goBack()}
        actions={[{ icon: IconRefresh, label: L('Rafraîchir', 'Refresh'), onPress: load }]}
      />

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {loading && items.length === 0 && <Loading variant="fill" />}

      <FlatList
        data={[...active, ...others]}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
        ListEmptyComponent={!loading ? (
          <EmptyState
            icon={IconAward}
            title={L('Aucun bon', 'No voucher')}
            description={L('Vous recevrez vos bons après une réclamation acceptée ou un trajet annulé.',
                          'You will receive vouchers after an accepted claim or a cancelled trip.')}
          />
        ) : null}
        renderItem={({ item }) => {
          const isActive = item.status === 'ACTIVE';
          const expired  = item.expiresAt && new Date(item.expiresAt) < new Date();
          return (
            <View style={[
              styles.card,
              {
                borderColor:     isActive ? colors.success : colors.border,
                backgroundColor: colors.surface,
                borderLeftWidth: 4,
                borderLeftColor: isActive ? colors.success : colors.textMuted,
                opacity:         isActive && !expired ? 1 : 0.6,
              },
            ]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900' }}>
                  {item.amount.toLocaleString(lang)} {item.currency}
                </Text>
                <Text style={{
                  color:    isActive ? colors.success : colors.textMuted,
                  fontWeight:'700',
                  fontSize: 11,
                }}>
                  {item.status}
                </Text>
              </View>
              <Text style={{
                color:        colors.text,
                fontFamily:   'Courier',
                fontSize:     16,
                marginTop:    8,
                letterSpacing:1,
              }} selectable>
                {item.code}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>
                {L('Type', 'Scope')}: {item.scope}
                {item.expiresAt && (
                  <>
                    {' · '}
                    <Text style={{ color: expired ? colors.danger : colors.textMuted }}>
                      {L('Expire', 'Expires')}: {new Date(item.expiresAt).toLocaleDateString(lang)}
                    </Text>
                  </>
                )}
              </Text>
              {item.notes && (
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }} numberOfLines={2}>
                  {item.notes}
                </Text>
              )}
            </View>
          );
        }}
        ListFooterComponent={items.length > 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12 }}>
            {L('Présentez votre code en caisse ou copiez-le lors du paiement en ligne.',
                'Show your code at the counter or copy it during online checkout.')}
          </Text>
        ) : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  banner: { marginHorizontal: 16, padding: 10, borderRadius: 8 },
  card:   { padding: 14, borderRadius: 12, borderWidth: 1 },
});
