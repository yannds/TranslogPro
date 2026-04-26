/**
 * PlatformSecurityScreen — Hub sécurité pour le Super-Admin (3 sous-vues).
 *
 * Sous-vues (segmented control) :
 *   1. IAM cross-tenant : recherche user + reset password / reset MFA
 *   2. Sessions : lister + révoquer une session compromise
 *   3. Audit feed : 50 derniers événements (login fails, MFA lockouts, etc.)
 *
 * Endpoints :
 *   - GET    /api/platform/iam/users?search=&limit=50
 *   - POST   /api/platform/iam/users/:id/reset-password  { mode: 'set'|'link' }
 *   - POST   /api/platform/iam/users/:id/reset-mfa
 *   - GET    /api/platform/iam/sessions
 *   - DELETE /api/platform/iam/sessions/:id
 *   - GET    /api/platform/iam/audit?limit=50
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SafeAreaView, FlatList, Pressable, StyleSheet, RefreshControl, Alert, TextInput,
} from 'react-native';
import { apiGet, apiPost, apiDelete } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { Loading } from '../ui/Loading';
import { EmptyState } from '../ui/EmptyState';
import { ScreenHeader } from '../ui/ScreenHeader';
import { SegmentedControl } from '../ui/SegmentedControl';
import {
  IconShieldOk, IconSearch, IconKey, IconLock, IconWarn, IconRefresh, IconUserCircle,
} from '../ui/icons';

type SecurityTab = 'iam' | 'sessions' | 'audit';

interface IamUser {
  id:        string;
  email:     string;
  name:      string | null;
  tenantId:  string;
  isActive:  boolean;
  mfaEnabled: boolean;
}

interface SessionRow {
  id:        string;
  userId:    string;
  tenantId:  string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  user?:     { email: string; name: string | null } | null;
}

interface AuditRow {
  id:        string;
  createdAt: string;
  userId:    string | null;
  tenantId:  string;
  action:    string;
  level:     string;
  metadata?: Record<string, unknown> | null;
}

export function PlatformSecurityScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const lang = (user as { locale?: string } | null)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [tab,         setTab]         = useState<SecurityTab>('iam');
  const [iamSearch,   setIamSearch]   = useState('');
  const [iamUsers,    setIamUsers]    = useState<IamUser[]>([]);
  const [sessions,    setSessions]    = useState<SessionRow[]>([]);
  const [auditRows,   setAuditRows]   = useState<AuditRow[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [busyId,      setBusyId]      = useState<string | null>(null);

  const loadIam = useCallback(async () => {
    if (iamSearch.trim().length < 2) { setIamUsers([]); return; }
    try {
      const qs = new URLSearchParams({ search: iamSearch.trim(), limit: '50' });
      const res = await apiGet<{ items?: IamUser[] } | IamUser[]>(
        `/api/platform/iam/users?${qs.toString()}`,
        { skipAuthRedirect: true },
      );
      setIamUsers(Array.isArray(res) ? res : (res?.items ?? []));
    } catch { setIamUsers([]); }
  }, [iamSearch]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await apiGet<{ items?: SessionRow[] } | SessionRow[]>(
        '/api/platform/iam/sessions?limit=50',
        { skipAuthRedirect: true },
      );
      setSessions(Array.isArray(res) ? res : (res?.items ?? []));
    } catch { setSessions([]); }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const res = await apiGet<{ items?: AuditRow[] } | AuditRow[]>(
        '/api/platform/iam/audit?limit=50',
        { skipAuthRedirect: true },
      );
      setAuditRows(Array.isArray(res) ? res : (res?.items ?? []));
    } catch { setAuditRows([]); }
  }, []);

  useEffect(() => {
    setLoading(true);
    if (tab === 'iam')      void loadIam().finally(() => setLoading(false));
    if (tab === 'sessions') void loadSessions().finally(() => setLoading(false));
    if (tab === 'audit')    void loadAudit().finally(() => setLoading(false));
  }, [tab, loadIam, loadSessions, loadAudit]);

  async function onPullRefresh() {
    setRefreshing(true);
    if (tab === 'iam')      await loadIam();
    if (tab === 'sessions') await loadSessions();
    if (tab === 'audit')    await loadAudit();
    setRefreshing(false);
  }

  function askResetPassword(u: IamUser) {
    if (!online) { Alert.alert(L('Réseau requis', 'Network required')); return; }
    Alert.alert(
      L('Réinitialiser le mot de passe ?', 'Reset password?'),
      `${u.email}\n${L('Un lien de reset (TTL 30 min) sera généré.', 'A reset link (30min TTL) will be generated.')}`,
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Générer le lien', 'Generate link'),
          onPress: async () => {
            setBusyId(u.id);
            try {
              const res = await apiPost<{ resetUrl?: string }>(
                `/api/platform/iam/users/${u.id}/reset-password`,
                { mode: 'link' },
                { skipAuthRedirect: true },
              );
              if (res?.resetUrl) {
                Alert.alert(L('Lien généré', 'Link generated'),
                  L('Copiez et envoyez à l’utilisateur :', 'Copy and send to user:') + '\n\n' + res.resetUrl);
              }
            } catch (e) {
              Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  function askResetMfa(u: IamUser) {
    if (!online) { Alert.alert(L('Réseau requis', 'Network required')); return; }
    Alert.alert(
      L('Réinitialiser le MFA ?', 'Reset MFA?'),
      `${u.email}\n${L('Le user devra reconfigurer son authenticator.', 'User will need to reconfigure authenticator.')}`,
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Réinitialiser', 'Reset'),
          style: 'destructive',
          onPress: async () => {
            setBusyId(u.id);
            try {
              await apiPost(
                `/api/platform/iam/users/${u.id}/reset-mfa`, {},
                { skipAuthRedirect: true, headers: { 'Idempotency-Key': `pf-mfa-reset:${u.id}` } },
              );
              Alert.alert(L('MFA réinitialisé', 'MFA reset'));
            } catch (e) {
              Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  function askRevokeSession(s: SessionRow) {
    if (!online) { Alert.alert(L('Réseau requis', 'Network required')); return; }
    Alert.alert(
      L('Révoquer cette session ?', 'Revoke this session?'),
      `${s.user?.email ?? s.userId}\n${s.ipAddress}`,
      [
        { text: L('Annuler', 'Cancel'), style: 'cancel' },
        {
          text: L('Révoquer', 'Revoke'),
          style: 'destructive',
          onPress: async () => {
            setBusyId(s.id);
            try {
              await apiDelete(
                `/api/platform/iam/sessions/${s.id}`,
                { skipAuthRedirect: true },
              );
              setSessions(prev => prev.filter(x => x.id !== s.id));
            } catch (e) {
              Alert.alert(L('Erreur', 'Error'), e instanceof Error ? e.message : String(e));
            } finally { setBusyId(null); }
          },
        },
      ],
    );
  }

  const segItems = useMemo(() => [
    { id: 'iam',      label: L('IAM',       'IAM') },
    { id: 'sessions', label: L('Sessions',  'Sessions') },
    { id: 'audit',    label: L('Audit',     'Audit') },
  ], [lang]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={L('Sécurité plateforme', 'Platform security')} actions={[
        { icon: IconRefresh, label: L('Rafraîchir', 'Refresh'), onPress: onPullRefresh },
      ]} />

      <SegmentedControl
        items={segItems}
        selected={tab}
        onChange={(id) => setTab(id as SecurityTab)}
      />

      {loading && <Loading />}

      {tab === 'iam' && (
        <>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <IconSearch size={16} color={colors.textMuted} />
              <TextInput
                value={iamSearch}
                onChangeText={(v) => { setIamSearch(v); }}
                placeholder={L('Email, nom, phone (≥ 2 chars)', 'Email, name, phone (≥ 2 chars)')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none" autoCorrect={false}
                onSubmitEditing={loadIam}
                returnKeyType="search"
                style={[styles.searchInput, { color: colors.text }]}
              />
            </View>
          </View>
          <FlatList
            data={iamUsers}
            keyExtractor={(u) => u.id}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
            ListEmptyComponent={!loading && iamSearch.trim().length >= 2 ? (
              <EmptyState icon={IconShieldOk} title={L('Aucun utilisateur', 'No user')} />
            ) : null}
            renderItem={({ item }) => (
              <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <IconUserCircle size={28} color={colors.textMuted} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {item.name ?? L('(sans nom)', '(no name)')}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }} selectable numberOfLines={1}>
                      {item.email}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                      {item.tenantId.slice(0, 8)}… · {item.isActive ? L('Actif', 'Active') : L('Inactif', 'Inactive')}
                      {item.mfaEnabled ? ' · MFA ON' : ''}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Pressable
                    onPress={() => askResetPassword(item)}
                    disabled={busyId === item.id}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.btnOutline,
                      { borderColor: colors.warning, opacity: pressed || busyId === item.id ? 0.6 : 1 }]}
                  >
                    <IconKey size={14} color={colors.warning} />
                    <Text style={{ color: colors.warning, fontWeight: '700', marginLeft: 4 }}>
                      {L('Reset pwd', 'Reset pwd')}
                    </Text>
                  </Pressable>
                  {item.mfaEnabled && (
                    <Pressable
                      onPress={() => askResetMfa(item)}
                      disabled={busyId === item.id}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.btnOutline,
                        { borderColor: colors.danger, opacity: pressed || busyId === item.id ? 0.6 : 1 }]}
                    >
                      <IconLock size={14} color={colors.danger} />
                      <Text style={{ color: colors.danger, fontWeight: '700', marginLeft: 4 }}>
                        {L('Reset MFA', 'Reset MFA')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          />
        </>
      )}

      {tab === 'sessions' && (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? <EmptyState icon={IconShieldOk} title={L('Aucune session active', 'No active session')} /> : null}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {item.user?.email ?? item.userId}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                {item.ipAddress} · {new Date(item.createdAt).toLocaleString(lang)}
              </Text>
              <Pressable
                onPress={() => askRevokeSession(item)}
                disabled={busyId === item.id}
                accessibilityRole="button"
                style={({ pressed }) => [styles.btnOutline,
                  { borderColor: colors.danger, opacity: pressed || busyId === item.id ? 0.6 : 1, marginTop: 10 }]}
              >
                <Text style={{ color: colors.danger, fontWeight: '700' }}>
                  {L('Révoquer', 'Revoke')}
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}

      {tab === 'audit' && (
        <FlatList
          data={auditRows}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
          ListEmptyComponent={!loading ? <EmptyState icon={IconShieldOk} title={L('Aucun événement', 'No event')} /> : null}
          renderItem={({ item }) => {
            const tone = item.level === 'critical' || item.level === 'error'
              ? colors.danger
              : item.level === 'warn'
                ? colors.warning
                : colors.textMuted;
            return (
              <View style={[styles.cardSmall, { borderColor: colors.border, backgroundColor: colors.surface, borderLeftColor: tone, borderLeftWidth: 3 }]}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{item.action}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                  {new Date(item.createdAt).toLocaleString(lang)} · {item.level}
                </Text>
                {item.userId && (
                  <Text style={{ color: colors.textMuted, fontSize: 11 }} numberOfLines={1}>
                    user {item.userId.slice(0, 8)}… · tenant {item.tenantId.slice(0, 8)}…
                  </Text>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  searchBox:   { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, fontSize: 14 },
  card:        { padding: 14, borderRadius: 12, borderWidth: 1 },
  cardSmall:   { padding: 10, borderRadius: 10, borderWidth: 1 },
  btnOutline:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 36, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, flex: 1 },
});
