/**
 * QuaiParcelActionsScreen — Actions hub / pickup / dispute pour agent quai.
 *
 * Flux :
 *   1. Agent scanne QR colis (code tracking) ou le saisit manuellement.
 *   2. App fetch le parcel → affiche son état courant.
 *   3. Liste des actions disponibles selon état (calqué sur ParcelHubActionsDialog web).
 *   4. Confirmation → POST endpoint dédié.
 *
 * Endpoints :
 *   GET  /api/tenants/:tid/parcels/track/:code
 *   POST /api/tenants/:tid/parcels/:id/hub/{arrive,store,load-outbound,depart}
 *   POST /api/tenants/:tid/parcels/:id/pickup/{notify,complete}
 *   POST /api/tenants/:tid/parcels/:id/dispute
 *   POST /api/tenants/:tid/parcels/:id/return/{initiate,complete}
 *
 * Zéro magic number : les actions dispo dépendent du statut backend + config tenant
 * (TTL retrait, hub storage, etc.).
 */
import { useCallback, useState } from 'react';
import {
  View, Text, SafeAreaView, Pressable, ScrollView, StyleSheet, TextInput, ActivityIndicator,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { QrScanner } from '../ui/QrScanner';

interface Parcel {
  id:           string;
  trackingCode: string;
  status:       string;
  weight:       number;
  destination?: { name: string; city?: string } | null;
  recipientInfo?: { name?: string; phone?: string } | null;
}

type Action =
  | 'ARRIVE_AT_HUB' | 'STORE_AT_HUB' | 'LOAD_OUTBOUND' | 'DEPART_FROM_HUB'
  | 'NOTIFY_FOR_PICKUP' | 'PICKUP' | 'DISPUTE' | 'INITIATE_RETURN' | 'COMPLETE_RETURN';

function actionsFor(status: string): Action[] {
  switch (status) {
    case 'IN_TRANSIT':           return ['ARRIVE_AT_HUB'];
    case 'AT_HUB_INBOUND':       return ['STORE_AT_HUB', 'LOAD_OUTBOUND'];
    case 'STORED_AT_HUB':        return ['LOAD_OUTBOUND', 'INITIATE_RETURN'];
    case 'AT_HUB_OUTBOUND':      return ['DEPART_FROM_HUB'];
    case 'ARRIVED':              return ['NOTIFY_FOR_PICKUP'];
    case 'AVAILABLE_FOR_PICKUP': return ['PICKUP', 'DISPUTE', 'INITIATE_RETURN'];
    case 'DELIVERED':            return ['DISPUTE'];
    case 'RETURN_TO_SENDER':     return ['COMPLETE_RETURN'];
    default:                     return [];
  }
}

export function QuaiParcelActionsScreen() {
  const { user } = useAuth();
  useI18n();
  const { colors } = useTheme();
  const nav = useNavigation<NavigationProp<any>>();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [codeInput, setCodeInput]     = useState('');
  const [parcel, setParcel]           = useState<Parcel | null>(null);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState<string | null>(null);
  const [ok, setOk]                   = useState<string | null>(null);

  const [hubStationId, setHubStationId] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadByCode = useCallback(async (code: string) => {
    if (!tenantId || !code.trim()) return;
    setLoading(true); setErr(null); setOk(null); setParcel(null);
    try {
      const res = await apiGet<Parcel>(
        `/api/tenants/${tenantId}/parcels/track/${encodeURIComponent(code.trim())}`,
        { skipAuthRedirect: true },
      );
      setParcel(res);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally { setLoading(false); }
  }, [tenantId]);

  const onScanned = useCallback((token: string) => {
    setScannerOpen(false);
    setCodeInput(token);
    void loadByCode(token);
  }, [loadByCode]);

  const submitAction = useCallback(async () => {
    if (!parcel || !pendingAction) return;
    setSubmitting(true); setErr(null); setOk(null);
    try {
      const base = `/api/tenants/${tenantId}/parcels/${parcel.id}`;
      const idemp = (suffix: string) => ({
        skipAuthRedirect: true,
        headers: { 'Idempotency-Key': `${parcel.id}:${pendingAction}:${suffix}` },
      });
      switch (pendingAction) {
        case 'ARRIVE_AT_HUB':
          if (!hubStationId.trim()) throw new Error(L('Station hub requise', 'Hub station required'));
          await apiPost(`${base}/hub/arrive`, { hubStationId: hubStationId.trim() }, idemp(Date.now().toString())); break;
        case 'STORE_AT_HUB':      await apiPost(`${base}/hub/store`, {}, idemp(Date.now().toString())); break;
        case 'LOAD_OUTBOUND':     await apiPost(`${base}/hub/load-outbound`, {}, idemp(Date.now().toString())); break;
        case 'DEPART_FROM_HUB':   await apiPost(`${base}/hub/depart`, {}, idemp(Date.now().toString())); break;
        case 'NOTIFY_FOR_PICKUP': await apiPost(`${base}/pickup/notify`, {}, idemp(Date.now().toString())); break;
        case 'PICKUP':            await apiPost(`${base}/pickup/complete`, {}, idemp(Date.now().toString())); break;
        case 'DISPUTE':
          if (!disputeReason.trim()) throw new Error(L('Motif requis', 'Reason required'));
          await apiPost(`${base}/dispute`, { reason: disputeReason.trim() }, idemp(Date.now().toString())); break;
        case 'INITIATE_RETURN':   await apiPost(`${base}/return/initiate`, {}, idemp(Date.now().toString())); break;
        case 'COMPLETE_RETURN':   await apiPost(`${base}/return/complete`, {}, idemp(Date.now().toString())); break;
      }
      setOk(L('Action effectuée', 'Action completed'));
      // Recharge pour refléter nouveau statut
      setPendingAction(null); setHubStationId(''); setDisputeReason('');
      await loadByCode(parcel.trackingCode);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSubmitting(false); }
  }, [parcel, pendingAction, hubStationId, disputeReason, tenantId, loadByCode]);

  const ACTION_LABELS: Record<Action, { fr: string; en: string; icon: string; danger?: boolean }> = {
    ARRIVE_AT_HUB:     { fr: 'Arrivée au hub',           en: 'Arrive at hub',           icon: '🏢' },
    STORE_AT_HUB:      { fr: 'Stocker à l\'entrepôt',    en: 'Store in warehouse',      icon: '📦' },
    LOAD_OUTBOUND:     { fr: 'Charger bus sortant',      en: 'Load outbound bus',       icon: '⬆️' },
    DEPART_FROM_HUB:   { fr: 'Départ du hub',            en: 'Depart from hub',         icon: '🚚' },
    NOTIFY_FOR_PICKUP: { fr: 'Notifier destinataire',    en: 'Notify recipient',        icon: '🔔' },
    PICKUP:            { fr: 'Confirmer retrait',        en: 'Confirm pickup',          icon: '✅' },
    DISPUTE:           { fr: 'Contestation',             en: 'Dispute',                 icon: '⚠️', danger: true },
    INITIATE_RETURN:   { fr: 'Initier retour',           en: 'Initiate return',         icon: '↩️' },
    COMPLETE_RETURN:   { fr: 'Finaliser retour',         en: 'Complete return',         icon: '✓' },
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => nav.goBack()} style={styles.backBtn} accessibilityRole="button">
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>← {L('Retour', 'Back')}</Text>
        </Pressable>

        <Text style={[styles.h1, { color: colors.text }]}>
          {L('Actions colis', 'Parcel actions')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {L('Hub / retrait / contestation / retour', 'Hub / pickup / dispute / return')}
        </Text>

        {!parcel && (
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: colors.text, marginBottom: 6 }}>{L('Code de suivi', 'Tracking code')}</Text>
            <TextInput
              value={codeInput}
              onChangeText={setCodeInput}
              placeholder="TNT-ABC123-XYZ"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12,
                color: colors.text, backgroundColor: colors.surface, fontFamily: 'monospace',
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Pressable
                onPress={() => setScannerOpen(true)}
                style={({ pressed }) => [styles.btn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>📷 {L('Scanner QR', 'Scan QR')}</Text>
              </Pressable>
              <Pressable
                onPress={() => loadByCode(codeInput)}
                disabled={!codeInput.trim() || loading}
                style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: loading || pressed ? 0.7 : 1 }]}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>
                  {loading ? '…' : L('Charger', 'Load')}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {err && (
          <View style={[styles.alert, { backgroundColor: colors.dangerBg ?? '#FEF2F2', borderColor: colors.danger }]}>
            <Text style={{ color: colors.danger }}>{err}</Text>
          </View>
        )}
        {ok && (
          <View style={[styles.alert, { backgroundColor: '#ECFDF5', borderColor: '#059669' }]}>
            <Text style={{ color: '#059669' }}>{ok}</Text>
          </View>
        )}

        {parcel && (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, fontFamily: 'monospace' }}>
                {parcel.trackingCode}
              </Text>
              <Text style={{ color: colors.textMuted, marginTop: 4 }}>
                {parcel.destination?.name} · {parcel.weight} kg
              </Text>
              <View style={{ marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start', borderRadius: 4, backgroundColor: colors.background }}>
                <Text style={{ color: colors.text, fontSize: 12 }}>{parcel.status}</Text>
              </View>
            </View>

            {!pendingAction && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>
                  {L('Actions disponibles', 'Available actions')}
                </Text>
                {actionsFor(parcel.status).length === 0 && (
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                    {L('Aucune action possible dans l\'état courant.', 'No action available in current state.')}
                  </Text>
                )}
                {actionsFor(parcel.status).map(a => {
                  const lbl = ACTION_LABELS[a];
                  return (
                    <Pressable
                      key={a}
                      onPress={() => setPendingAction(a)}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        {
                          backgroundColor: lbl.danger ? (colors.dangerBg ?? '#FEF2F2') : colors.surface,
                          borderColor: lbl.danger ? colors.danger : colors.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Text style={{ fontSize: 18, marginRight: 10 }}>{lbl.icon}</Text>
                      <Text style={{ color: lbl.danger ? colors.danger : colors.text, fontWeight: '700' }}>
                        {L(lbl.fr, lbl.en)}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => { setParcel(null); setCodeInput(''); }}
                  style={{ marginTop: 16, alignSelf: 'center' }}
                >
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                    ← {L('Changer de colis', 'Change parcel')}
                  </Text>
                </Pressable>
              </View>
            )}

            {pendingAction && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>
                  {L(ACTION_LABELS[pendingAction].fr, ACTION_LABELS[pendingAction].en)}
                </Text>
                {pendingAction === 'ARRIVE_AT_HUB' && (
                  <TextInput
                    value={hubStationId}
                    onChangeText={setHubStationId}
                    placeholder={L('ID station hub', 'Hub station ID')}
                    placeholderTextColor={colors.textMuted}
                    style={{
                      borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10,
                      color: colors.text, backgroundColor: colors.surface,
                    }}
                  />
                )}
                {pendingAction === 'DISPUTE' && (
                  <TextInput
                    value={disputeReason}
                    onChangeText={setDisputeReason}
                    placeholder={L('Motif (manquant, cassé, litige...)', 'Reason (missing, damaged, dispute...)')}
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={3}
                    style={{
                      borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10,
                      color: colors.text, backgroundColor: colors.surface, textAlignVertical: 'top', minHeight: 70,
                    }}
                  />
                )}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Pressable
                    onPress={() => { setPendingAction(null); setErr(null); }}
                    disabled={submitting}
                    style={({ pressed }) => [styles.btn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={{ color: colors.text }}>← {L('Retour', 'Back')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={submitAction}
                    disabled={submitting}
                    style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: submitting || pressed ? 0.7 : 1 }]}
                  >
                    {submitting
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={{ color: '#fff', fontWeight: '800' }}>{L('Confirmer', 'Confirm')}</Text>
                    }
                  </Pressable>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <QrScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={onScanned}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  backBtn:   { paddingVertical: 4, alignSelf: 'flex-start' },
  h1:        { fontSize: 22, fontWeight: '800', marginTop: 8 },
  subtitle:  { fontSize: 13, marginTop: 2 },
  btn:       { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  alert:     { marginTop: 12, padding: 10, borderWidth: 1, borderRadius: 8 },
  card:      { marginTop: 16, padding: 12, borderWidth: 1, borderRadius: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12, marginBottom: 8 },
});
