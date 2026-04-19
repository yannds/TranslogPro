import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, SafeAreaView, FlatList, ActivityIndicator, StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { enqueueMutation, flushOutbox } from '../offline/outbox';
import { countPending } from '../offline/db';
import { useOnline } from '../offline/useOnline';

interface CashRegister {
  id:             string;
  initialBalance: number;
  openedAt:       string;
  auditStatus:    string;
}

interface TxItem {
  id:            string;
  type:          string;
  amount:        number;
  paymentMethod: string;
  createdAt:     string;
}

/**
 * Écran principal caissier mobile :
 *   - État caisse (ouverte ? solde initial ? nombre de TX)
 *   - Bouton "Ouvrir ma caisse" si aucune ouverte
 *   - Liste des transactions récentes
 *   - Badge "en attente" si outbox > 0
 *
 * Offline : toutes les écritures passent par `enqueueMutation` si pas online.
 */
export function CashierHomeScreen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const agencyId = user?.agencyId ?? '';

  const [register, setRegister] = useState<CashRegister | null>(null);
  const [tx,       setTx]       = useState<TxItem[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pending,  setPending]  = useState(0);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      const r = await apiGet<CashRegister | null>(
        `/api/tenants/${tenantId}/cashier/registers/me/open`,
        { skipAuthRedirect: true },
      );
      setRegister(r);
      if (r) {
        const list = await apiGet<{ items: TxItem[] }>(
          `/api/tenants/${tenantId}/cashier/registers/${r.id}/transactions?take=50`,
          { skipAuthRedirect: true },
        );
        setTx(list.items);
      } else {
        setTx([]);
      }
    } catch {
      // Offline/erreur : on laisse la valeur précédente
    }
    setPending(await countPending(tenantId));
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function handleOpen() {
    // agencyId côté client est optionnel — si absent, le backend le résout
    // depuis Staff.agencyId de l'acteur. On ne bloque plus ici.
    const body: { agencyId?: string; openingBalance: number } = { openingBalance: 0 };
    if (agencyId) body.agencyId = agencyId;
    try {
      if (!online) {
        await enqueueMutation({
          tenantId, kind: 'cashier.open', method: 'POST',
          url: `/api/tenants/${tenantId}/cashier/registers`,
          body, context: body,
        });
        Alert.alert(t('cashierSession.open') ?? 'Ouverture en file', t('offline.bannerOffline') ?? '');
        setPending(await countPending(tenantId));
      } else {
        await apiPost(`/api/tenants/${tenantId}/cashier/registers`, body);
        await refresh();
      }
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    }
  }

  async function onPullRefresh() {
    setRefreshing(true);
    if (online) { await flushOutbox(); }
    await refresh();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.h1, { color: colors.text }]}>{t('cashierDash.title') ?? 'Caisse'}</Text>
          <Text style={{ color: colors.textMuted }}>{user?.email}</Text>
        </View>
        <Pressable onPress={() => logout()} accessibilityRole="button" style={styles.logoutBtn}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>⎋</Text>
        </Pressable>
      </View>

      {!online && (
        <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
        </View>
      )}

      {pending > 0 && (
        <View style={[styles.banner, { backgroundColor: colors.successBg }]}>
          <Text style={{ color: colors.success }}>
            {t('offline.pendingCount', { n: String(pending) })}
          </Text>
        </View>
      )}

      {loading && !register && <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />}

      {!loading && !register && (
        <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.h2, { color: colors.text }]}>
            {t('cashierDash.emptyHint') ?? 'Aucune caisse ouverte.'}
          </Text>
          <Pressable
            onPress={handleOpen}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>
              {t('cashierSession.open') ?? 'Ouvrir ma caisse'}
            </Text>
          </Pressable>
        </View>
      )}

      {register && (
        <FlatList
          data={tx}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListHeaderComponent={
            <View style={[styles.registerCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.textMuted }}>
                {t('cashierSession.opened', {
                  time: new Date(register.openedAt).toLocaleTimeString(),
                })}
              </Text>
              <Text style={[styles.h2, { color: colors.text, marginTop: 4 }]}>
                {register.initialBalance.toLocaleString()}
              </Text>
              <Text style={{ color: colors.textMuted }}>
                {t('cashierSession.initialBalance')}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24 }}>
              {t('cashierDash.noTx') ?? 'Aucune transaction'}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.txRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  {t(`cashierDash.type_${item.type}`) ?? item.type}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  {t(`cashierDash.method_${item.paymentMethod}`) ?? item.paymentMethod} · {new Date(item.createdAt).toLocaleTimeString()}
                </Text>
              </View>
              <Text style={{ color: item.amount >= 0 ? colors.success : colors.danger, fontWeight: '700' }}>
                {item.amount.toLocaleString()}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  h1:           { fontSize: 22, fontWeight: '800' },
  h2:           { fontSize: 18, fontWeight: '700' },
  logoutBtn:    { padding: 12, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  banner:       { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 8 },
  emptyCard:    { margin: 16, padding: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', gap: 16 },
  primaryBtn:   { minHeight: 48, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  registerCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  txRow:        { padding: 12, borderRadius: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
