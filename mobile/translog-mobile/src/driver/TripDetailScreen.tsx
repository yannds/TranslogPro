/**
 * TripDetailScreen — Vue détaillée d'un trajet chauffeur.
 *
 * Affiche :
 *   - En-tête : origine → destination, statut, heure de départ
 *   - Bus (plaque, modèle, capacité)
 *   - Waypoints (gares intermédiaires si itinéraire avec stops)
 *   - Passagers attendus (tickets CONFIRMED|CHECKED_IN)
 *   - Colis à bord (shipments → parcels)
 *   - Actions rapides : Briefing · Check-in · Scanner billet · Rapport fin
 *
 * Data source :
 *   GET /api/tenants/:tid/trips/:id          → trip + route + bus + travelers
 *   GET /api/tenants/:tid/trips/:id/seats    → passagers avec sièges assignés
 *
 * Offline-first : useOfflineList ne s'applique pas ici (détail = un objet),
 * mais on garde le cache si le serveur tombe pendant le trajet.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SafeAreaView, ScrollView, Pressable, ActivityIndicator, StyleSheet, RefreshControl, Modal, TextInput,
} from 'react-native';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { apiGet, apiPost, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { useOnline } from '../offline/useOnline';
import { LiveManifestPanel } from '../ui/LiveManifestPanel';
import { EtaTime } from '../ui/EtaTime';

// Constantes UX — pas de magic number.
const STATUS_VARIANTS = ['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
type TripStatus = (typeof STATUS_VARIANTS)[number] | string;

interface Ticket {
  id:             string;
  status:         string;
  fareClass:      string;
  seatNumber:     string | null;
  passengerName:  string;
  passengerPhone: string | null;
  pricePaid:      number;
  boardingStationId:  string | null;
  alightingStationId: string | null;
}

interface TripDetail {
  id:                 string;
  status:             TripStatus;
  departureScheduled: string;
  arrivalScheduled:   string;
  // Stampés par transitionTripStatus à IN_PROGRESS / COMPLETED.
  // Une fois posés, l'estimation côté UI doit être FIGÉE (pas de rolling).
  departureActual?:   string | null;
  arrivalActual?:     string | null;
  seatingMode?:       string;
  freightClosedAt?:   string | null;
  freightClosedById?: string | null;
  route?: {
    id:          string;
    name:        string;
    origin?:      { id: string; name: string; city?: string | null };
    destination?: { id: string; name: string; city?: string | null };
    waypoints?:   Array<{ order: number; station: { id: string; name: string } }>;
  };
  bus?: {
    id:            string;
    // Backend Prisma expose `plateNumber` (cf. schema.prisma). L'ancien
    // champ `plate` était inventé côté mobile → toujours undefined → "—"
    // affiché. On garde les deux pour tolérance si l'API change.
    plateNumber?:  string;
    plate?:        string;
    model?:        string;
    capacity:      number;
    seatLayout?:   unknown;
  };
  travelers?: Array<{ id: string; staffId: string | null }>;
  driver?: { id: string; user: { name: string | null; email: string } } | null;
  _count?: { shipments: number };
}

export function TripDetailScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const online = useOnline();
  const navigation = useNavigation<NavigationProp<any>>();
  const route = useRoute();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const tripId = (route.params as { tripId?: string } | undefined)?.tripId ?? '';

  const [trip, setTrip]       = useState<TripDetail | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [freightBusy, setFreightBusy] = useState(false);
  const [freightConfirmOpen, setFreightConfirmOpen] = useState(false);
  // Confirm avant transition trajet — protection contre clic accidentel.
  // Une transition est *irréversible* depuis le portail driver (cf. state graph).
  const [statusConfirm, setStatusConfirm] = useState<null | 'BOARDING' | 'IN_PROGRESS' | 'COMPLETED'>(null);
  // Incident en route : panne, retard majeur, annulation en transit (2026-04-19)
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentMode, setIncidentMode] = useState<null | 'SUSPEND' | 'DECLARE_DELAY'>(null);
  const [incidentReason, setIncidentReason] = useState('');
  const [incidentDelayMin, setIncidentDelayMin] = useState('');
  const [incidentBusy, setIncidentBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!tenantId || !tripId) return;
    setError(null);
    try {
      const [trp, tks] = await Promise.all([
        apiGet<TripDetail>(`/api/tenants/${tenantId}/trips/${tripId}`, { skipAuthRedirect: true }),
        // Tickets du trip — endpoint existant filtre par tripId.
        apiGet<Ticket[]>(`/api/tenants/${tenantId}/tickets?tripId=${tripId}`, { skipAuthRedirect: true }).catch(() => []),
      ]);
      setTrip(trp);
      setTickets(tks ?? []);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [tenantId, tripId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  /**
   * Transition d'état du trajet par le chauffeur. Endpoint existant
   * `POST /flight-deck/trips/:tripId/status` accepte PLANNED|OPEN → BOARDING
   * → IN_PROGRESS → COMPLETED. Le backend applique le state graph + les
   * guards (crew assignments, briefing, etc.) — zéro hardcode côté client.
   */
  const changeStatus = useCallback(async (next: 'BOARDING' | 'IN_PROGRESS' | 'COMPLETED') => {
    if (!tripId || !tenantId) return;
    setStatusBusy(true);
    setError(null);
    try {
      await apiPost(
        `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/status`,
        { status: next },
        { skipAuthRedirect: true, headers: { 'Idempotency-Key': `trip-status:${tripId}:${next}` } },
      );
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusy(false);
    }
  }, [tenantId, tripId, refresh]);

  /**
   * Clôt le chargement fret du trajet — backend stamp Trip.freightClosedAt.
   * Toute action LOAD ultérieure sur un colis lié sera refusée par
   * ParcelService.scan. La transition est idempotente côté serveur.
   */
  const closeFreight = useCallback(async () => {
    if (!tripId || !tenantId) return;
    setFreightBusy(true);
    setError(null);
    try {
      await apiPost(
        `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/freight/close`,
        {},
        { skipAuthRedirect: true, headers: { 'Idempotency-Key': `freight-close:${tripId}` } },
      );
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFreightBusy(false);
      setFreightConfirmOpen(false);
    }
  }, [tenantId, tripId, refresh]);

  /**
   * Incident en route : SUSPEND (panne) ou DECLARE_MAJOR_DELAY (retard grave).
   * Les deux actions passent par IncidentCompensationService côté backend,
   * qui déclenche les compensations selon config tenant (refund prorata /
   * voucher / snack). Zéro logique de décision côté mobile.
   */
  const submitIncident = useCallback(async () => {
    if (!tripId || !tenantId || !incidentMode) return;
    setIncidentBusy(true);
    setError(null);
    try {
      if (incidentMode === 'SUSPEND') {
        if (!incidentReason.trim()) {
          setError('Motif requis');
          return;
        }
        await apiPost(
          `/api/tenants/${tenantId}/trips/${tripId}/incident/suspend`,
          { reason: incidentReason.trim() },
          { skipAuthRedirect: true, headers: { 'Idempotency-Key': `trip-suspend:${tripId}:${Date.now()}` } },
        );
      } else if (incidentMode === 'DECLARE_DELAY') {
        const min = parseInt(incidentDelayMin, 10);
        if (!Number.isFinite(min) || min <= 0) {
          setError('Délai invalide');
          return;
        }
        await apiPost(
          `/api/tenants/${tenantId}/trips/${tripId}/incident/declare-major-delay`,
          { delayMinutes: min },
          { skipAuthRedirect: true, headers: { 'Idempotency-Key': `trip-delay:${tripId}:${min}:${Date.now()}` } },
        );
      }
      setIncidentOpen(false);
      setIncidentMode(null);
      setIncidentReason('');
      setIncidentDelayMin('');
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIncidentBusy(false);
    }
  }, [tenantId, tripId, incidentMode, incidentReason, incidentDelayMin, refresh]);

  async function onPullRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const lang = (user as any)?.locale === 'en' ? 'en' : 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);

  if (loading && !trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, padding: 24 }}>
        <Text style={{ color: colors.danger }}>{error ?? L('Trajet introuvable', 'Trip not found')}</Text>
        <Pressable onPress={() => navigation.goBack()} style={[styles.btnGhost, { borderColor: colors.border, marginTop: 20 }]}>
          <Text style={{ color: colors.text }}>{L('Retour', 'Back')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const confirmed = tickets.filter(tk => tk.status === 'CONFIRMED' || tk.status === 'CHECKED_IN' || tk.status === 'BOARDED');
  const boarded   = tickets.filter(tk => tk.status === 'BOARDED' || tk.status === 'CHECKED_IN');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backBtn}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.h1, { color: colors.text }]} numberOfLines={2}>
              {trip.route?.origin?.name ?? '?'} → {trip.route?.destination?.name ?? '?'}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {new Date(trip.departureScheduled).toLocaleDateString(undefined, {
                weekday: 'short', day: '2-digit', month: 'short',
              })}
            </Text>
            {/* Heures Prévu / Estimé — logique 4 états identique au backend.
                Si departureActual est posé, l'heure est FIGÉE à cette valeur
                (= heure réelle de clic "Démarrer le trajet"), plus de rolling. */}
            {(() => {
              const schedMs = new Date(trip.departureScheduled).getTime();
              const actualDep = trip.departureActual ? new Date(trip.departureActual) : null;
              const isCancelled = trip.status === 'CANCELLED';
              let delay = 0;
              let estimated: string | null = null;
              if (!isCancelled) {
                if (actualDep) {
                  delay = actualDep.getTime() > schedMs
                    ? Math.floor((actualDep.getTime() - schedMs) / 60_000) : 0;
                  estimated = delay > 0 ? actualDep.toISOString() : null;
                } else if (Date.now() > schedMs) {
                  delay = Math.floor((Date.now() - schedMs) / 60_000);
                  estimated = delay > 0 ? new Date(schedMs + delay * 60_000).toISOString() : null;
                }
              }
              return (
                <View style={{ marginTop: 4 }}>
                  <EtaTime
                    scheduled={trip.departureScheduled}
                    estimated={estimated}
                    delayMinutes={delay}
                    layout="inline"
                    lang={lang}
                  />
                </View>
              );
            })()}
          </View>
          <Badge status={trip.status} colors={colors} />
        </View>

        {!online && (
          <View style={[styles.banner, { backgroundColor: colors.warningBg }]}>
            <Text style={{ color: colors.warning }}>{t('offline.bannerOffline')}</Text>
          </View>
        )}

        {/* Contrôles d'état trajet — épinglés en haut, les 3 boutons toujours
            rendus. Celui qui correspond à l'état courant est actif (couleur),
            les autres sont grisés (disabled + opacité). Une fois la transition
            faite, tous repassent grisés (état terminal). C'est le pattern
            "sticky header" demandé pour que le chauffeur n'ait pas à scroller. */}
        <View style={styles.statusRow}>
          <StatusBtn
            label={L("Démarrer l'embarquement", 'Start boarding')}
            onPress={() => setStatusConfirm('BOARDING')}
            disabled={statusBusy || !(trip.status === 'PLANNED' || trip.status === 'OPEN')}
            active={trip.status === 'PLANNED' || trip.status === 'OPEN'}
            colors={colors}
            tone="primary"
          />
          <StatusBtn
            label={L('Démarrer le trajet', 'Start trip')}
            onPress={() => setStatusConfirm('IN_PROGRESS')}
            disabled={statusBusy || trip.status !== 'BOARDING'}
            active={trip.status === 'BOARDING'}
            colors={colors}
            tone="success"
          />
          <StatusBtn
            label={L('Terminer le trajet', 'End trip')}
            onPress={() => setStatusConfirm('COMPLETED')}
            disabled={statusBusy || trip.status !== 'IN_PROGRESS'}
            active={trip.status === 'IN_PROGRESS'}
            colors={colors}
            tone="warning"
          />
        </View>

        {/* Bus */}
        <Card colors={colors} title={L('Véhicule', 'Vehicle')}>
          <Row k={L('Plaque', 'Plate')}   v={trip.bus?.plateNumber ?? trip.bus?.plate ?? '—'} colors={colors} />
          <Row k={L('Modèle', 'Model')}    v={trip.bus?.model ?? '—'} colors={colors} />
          <Row k={L('Capacité', 'Capacity')} v={String(trip.bus?.capacity ?? '—')} colors={colors} />
          <Row k={L('Mode sièges', 'Seating')}  v={trip.seatingMode ?? '—'} colors={colors} />
        </Card>

        {/* Clôturer fret — verrou métier qui bloque tout LOAD colis ultérieur
            sur ce trajet. Avertissement explicite avant action (irréversible
            depuis le portail driver). Si déjà clos, badge informatif. */}
        {trip.freightClosedAt ? (
          <View style={[styles.freightLocked, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}>
            <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 13 }}>
              🔒 {L('Chargement fret clôturé', 'Freight loading closed')}
            </Text>
            <Text style={{ color: colors.warning, fontSize: 11, marginTop: 2 }}>
              {new Date(trip.freightClosedAt).toLocaleString(undefined, {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => setFreightConfirmOpen(true)}
            disabled={freightBusy}
            accessibilityRole="button"
            accessibilityLabel={L('Clôturer le chargement du fret', 'Close freight loading')}
            style={({ pressed }) => [
              styles.freightBtn,
              { backgroundColor: colors.surface, borderColor: colors.warning, opacity: pressed || freightBusy ? 0.7 : 1 },
            ]}
          >
            <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 14 }}>
              🔒  {L('Clôturer fret', 'Close freight')}
            </Text>
          </Pressable>
        )}

        {/* Incident en route — SUSPEND (panne) / DECLARE_DELAY (retard).
            Visible uniquement si le trajet est en cours. */}
        {['IN_PROGRESS', 'IN_PROGRESS_DELAYED', 'SUSPENDED'].includes(trip.status) && (
          <Pressable
            onPress={() => { setIncidentOpen(true); setIncidentMode(null); setIncidentReason(''); setIncidentDelayMin(''); }}
            accessibilityRole="button"
            accessibilityLabel={L('Signaler un incident en route', 'Report an in-transit incident')}
            style={({ pressed }) => [
              styles.freightBtn,
              { backgroundColor: colors.surface, borderColor: colors.danger, opacity: pressed ? 0.7 : 1, marginTop: 8 },
            ]}
          >
            <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 14 }}>
              ⚠️  {L('Incident en route', 'In-transit incident')}
            </Text>
          </Pressable>
        )}

        {/* Itinéraire */}
        <Card colors={colors} title={L('Itinéraire', 'Route')}>
          <Stop name={trip.route?.origin?.name ?? '?'} city={trip.route?.origin?.city} first colors={colors} />
          {(trip.route?.waypoints ?? [])
            .slice()
            .sort((a, b) => a.order - b.order)
            .map(wp => (
              <Stop key={wp.station.id} name={wp.station.name} colors={colors} />
            ))
          }
          <Stop name={trip.route?.destination?.name ?? '?'} city={trip.route?.destination?.city} last colors={colors} />
        </Card>

        {/* Manifeste temps réel — remplace les anciennes cartes Passagers/Colis
            (qui tronquaient à 20 et n'affichaient pas les colis). Le panel
            expose les 4 compteurs (confirmés / en gare / à bord / colis) +
            les 2 listes complètes triées par statut. Poll 5s. */}
        <LiveManifestPanel
          tenantId={tenantId}
          tripId={trip.id}
          lang={lang === 'en' ? 'en' : 'fr'}
        />

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <ActionBtn
            label={L('Briefing', 'Briefing')}
            onPress={() => navigation.navigate('DriverBriefing', { tripId: trip.id })}
            colors={colors}
          />
          <ActionBtn
            label={L('Check-in', 'Check-in')}
            onPress={() => navigation.navigate('DriverCheckin', { tripId: trip.id })}
            colors={colors}
          />
          <ActionBtn
            label={L('Scanner billets', 'Scan tickets')}
            onPress={() => navigation.navigate('DriverBoardingScan', { tripId: trip.id })}
            colors={colors}
            primary
          />
          {/* Mode rafale — même logique mais scanner persistent pour enchaîner
              50-200 billets sans refermer la caméra. defaultIntent=board car
              le chauffeur embarque ; le toggle check-in reste accessible. */}
          <ActionBtn
            label={L('Scan rafale', 'Bulk scan')}
            onPress={() => navigation.navigate('DriverBulkScan', { defaultIntent: 'board' })}
            colors={colors}
          />
          <ActionBtn
            label={L('Scanner colis', 'Scan parcels')}
            onPress={() => navigation.navigate('DriverParcelScan', { tripId: trip.id })}
            colors={colors}
          />
          <ActionBtn
            label={L('Rapport fin', 'End report')}
            onPress={() => navigation.navigate('DriverEndReport', { tripId: trip.id })}
            colors={colors}
          />
        </View>
      </ScrollView>

      {/* Modal confirmation transition trajet — protection clic accidentel.
          Chaque transition driver est irréversible (state graph PLANNED →
          BOARDING → IN_PROGRESS → COMPLETED, pas de retour arrière). Le
          libellé varie selon la cible. */}
      <Modal
        visible={statusConfirm !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusConfirm(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {statusConfirm === 'BOARDING'    ? L("Ouvrir l'embarquement ?", 'Open boarding?')
              : statusConfirm === 'IN_PROGRESS' ? L('Démarrer le trajet ?',     'Start the trip?')
              :                                   L('Terminer le trajet ?',     'End the trip?')}
            </Text>
            <Text style={[styles.modalBody, { color: colors.textMuted }]}>
              {statusConfirm === 'BOARDING'    ? L(
                  "Les passagers pourront commencer à embarquer. Action irréversible côté chauffeur.",
                  'Passengers will be allowed to start boarding. This cannot be undone from the driver app.')
              : statusConfirm === 'IN_PROGRESS' ? L(
                  "Le trajet sera marqué comme en cours. Vérifiez bien que vous avez signé le manifest avant.",
                  'The trip will be marked in progress. Make sure you signed the manifest first.')
              :                                   L(
                  "Le trajet sera clôturé. Vous ne pourrez plus enregistrer ni embarquer de passagers.",
                  'The trip will be closed. No more check-in / boarding will be allowed.')}
            </Text>
            <View style={styles.modalRow}>
              <Pressable
                onPress={() => setStatusConfirm(null)}
                disabled={statusBusy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {L('Annuler', 'Cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const target = statusConfirm;
                  setStatusConfirm(null);
                  if (target) await changeStatus(target);
                }}
                disabled={statusBusy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: colors.primary, borderColor: colors.primary, opacity: statusBusy || pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>
                  {statusBusy ? '…' : L('Confirmer', 'Confirm')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal confirmation Clôturer fret — décision irréversible côté driver,
          on demande une confirmation explicite avec rappel des conséquences. */}
      <Modal
        visible={freightConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFreightConfirmOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {L('Clôturer le chargement du fret ?', 'Close freight loading?')}
            </Text>
            <Text style={[styles.modalBody, { color: colors.textMuted }]}>
              {L(
                'Une fois clôturé, plus aucun colis ne pourra être chargé sur ce trajet. Action irréversible côté chauffeur.',
                'Once closed, no more parcel can be loaded on this trip. This action cannot be undone from the driver app.',
              )}
            </Text>
            <View style={styles.modalRow}>
              <Pressable
                onPress={() => setFreightConfirmOpen(false)}
                disabled={freightBusy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  {L('Annuler', 'Cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={closeFreight}
                disabled={freightBusy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: colors.warning, borderColor: colors.warning, opacity: freightBusy || pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>
                  {freightBusy ? '…' : L('Clôturer', 'Close')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal incident en route — SUSPEND ou DECLARE_DELAY.
          Le backend déclenche refund/voucher/snack selon config tenant. */}
      <Modal visible={incidentOpen} transparent animationType="fade" onRequestClose={() => setIncidentOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {L('Signaler un incident en route', 'Report in-transit incident')}
            </Text>
            {!incidentMode && (
              <>
                <Pressable
                  onPress={() => setIncidentMode('SUSPEND')}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.modalBtn, { backgroundColor: colors.warningBg ?? colors.surface, borderColor: colors.warning, opacity: pressed ? 0.7 : 1, marginTop: 12 }]}
                >
                  <Text style={{ color: colors.warning, fontWeight: '700' }}>🛑 {L('Suspendre (panne)', 'Suspend (breakdown)')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setIncidentMode('DECLARE_DELAY')}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.modalBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1, marginTop: 8 }]}
                >
                  <Text style={{ color: colors.text, fontWeight: '700' }}>⏱ {L('Déclarer retard majeur', 'Declare major delay')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setIncidentOpen(false)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.modalBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1, marginTop: 12 }]}
                >
                  <Text style={{ color: colors.textMuted }}>{L('Annuler', 'Cancel')}</Text>
                </Pressable>
              </>
            )}
            {incidentMode === 'SUSPEND' && (
              <>
                <Text style={[styles.modalBody, { color: colors.textMuted }]}>{L('Motif (ex: panne mécanique, accident)', 'Reason (e.g. breakdown, accident)')}</Text>
                <TextInput
                  value={incidentReason}
                  onChangeText={setIncidentReason}
                  placeholder={L('Décrivez la panne...', 'Describe the breakdown...')}
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={3}
                  style={{
                    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                    padding: 10, color: colors.text, backgroundColor: colors.background,
                    textAlignVertical: 'top', minHeight: 70,
                  }}
                />
                <View style={styles.modalRow}>
                  <Pressable onPress={() => setIncidentMode(null)} disabled={incidentBusy}
                    style={({ pressed }) => [styles.modalBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
                    <Text style={{ color: colors.text }}>← {L('Retour', 'Back')}</Text>
                  </Pressable>
                  <Pressable onPress={submitIncident} disabled={incidentBusy}
                    style={({ pressed }) => [styles.modalBtn, { backgroundColor: colors.warning, borderColor: colors.warning, opacity: incidentBusy || pressed ? 0.7 : 1 }]}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{incidentBusy ? '…' : L('Confirmer', 'Confirm')}</Text>
                  </Pressable>
                </View>
              </>
            )}
            {incidentMode === 'DECLARE_DELAY' && (
              <>
                <Text style={[styles.modalBody, { color: colors.textMuted }]}>{L('Délai en minutes', 'Delay in minutes')}</Text>
                <TextInput
                  value={incidentDelayMin}
                  onChangeText={setIncidentDelayMin}
                  placeholder="60"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  style={{
                    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                    padding: 10, color: colors.text, backgroundColor: colors.background,
                  }}
                />
                <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>
                  {L(
                    'La compensation (bon / remboursement / collation) s\'applique automatiquement selon la config tenant.',
                    'Compensation (voucher / refund / snack) applies automatically per tenant config.',
                  )}
                </Text>
                <View style={styles.modalRow}>
                  <Pressable onPress={() => setIncidentMode(null)} disabled={incidentBusy}
                    style={({ pressed }) => [styles.modalBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
                    <Text style={{ color: colors.text }}>← {L('Retour', 'Back')}</Text>
                  </Pressable>
                  <Pressable onPress={submitIncident} disabled={incidentBusy}
                    style={({ pressed }) => [styles.modalBtn, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: incidentBusy || pressed ? 0.7 : 1 }]}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{incidentBusy ? '…' : L('Confirmer', 'Confirm')}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function Card({
  colors, title, rightText, children,
}: {
  colors: any; title: string; rightText?: string; children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{title}</Text>
        {rightText !== undefined && (
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>{rightText}</Text>
        )}
      </View>
      {children}
    </View>
  );
}

function Row({ k, v, colors }: { k: string; v: string; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ color: colors.textMuted, fontSize: 13 }}>{k}</Text>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '500' }}>{v}</Text>
    </View>
  );
}

function Stop({ name, city, first, last, colors }: { name: string; city?: string | null; first?: boolean; last?: boolean; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
      <View style={[
        styles.dot,
        { backgroundColor: first ? colors.success : last ? colors.danger : colors.primary },
      ]} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{name}</Text>
        {city && <Text style={{ color: colors.textMuted, fontSize: 12 }}>{city}</Text>}
      </View>
    </View>
  );
}

function Badge({ status, colors }: { status: string; colors: any }) {
  const bg = status === 'IN_PROGRESS' ? colors.primary
    : status === 'BOARDING' ? colors.warning
    : status === 'COMPLETED' ? colors.success
    : status === 'CANCELLED' ? colors.danger
    : colors.textMuted;
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ color: 'white', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>{status}</Text>
    </View>
  );
}

function BadgeMini({ status, colors }: { status: string; colors: any }) {
  const bg = status === 'BOARDED' ? colors.success
    : status === 'CHECKED_IN' ? colors.primary
    : colors.textMuted;
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: bg }}>
      <Text style={{ color: 'white', fontSize: 9, fontWeight: '700' }}>{status}</Text>
    </View>
  );
}

function ActionBtn({
  label, onPress, colors, primary,
}: { label: string; onPress: () => void; colors: any; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.actionBtn,
        {
          backgroundColor: primary ? colors.primary : colors.surface,
          borderColor: primary ? colors.primary : colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={{ color: primary ? colors.primaryFg : colors.text, fontWeight: '600', fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Bouton statut trip — pleine largeur, tons différenciés pour que le
 * chauffeur repère instantanément l'action à faire.
 *
 * Trois états visuels :
 *   - active=true, disabled=false  → couleur pleine, cliquable (action courante).
 *   - active=false                 → grisé (état non-applicable au statut courant).
 *   - disabled=true (en cours)     → opacité réduite, click ignoré.
 *
 * Les 3 boutons sont rendus en permanence pour donner un repère visuel du
 * pipeline trajet (embarquer → démarrer → terminer), même quand seul un est
 * pertinent. Une fois le trajet terminé, les 3 sont grisés (état terminal).
 */
function StatusBtn({
  label, onPress, disabled, active, colors, tone,
}: {
  label: string; onPress: () => void; disabled?: boolean; active?: boolean; colors: any;
  tone: 'primary' | 'success' | 'warning';
}) {
  const bg = active
    ? (tone === 'success' ? '#10b981'
       : tone === 'warning' ? '#f59e0b'
       : colors.primary)
    : colors.surface;
  const fg = active ? '#fff' : colors.textMuted;
  const border = active
    ? 'transparent'
    : colors.border;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.statusBtn,
        {
          backgroundColor: bg,
          borderColor: border,
          borderWidth: 1,
          opacity: disabled && !active ? 0.5 : (pressed ? 0.7 : 1),
        },
      ]}
    >
      <Text style={{ color: fg, fontWeight: '800', fontSize: 13, textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  h1:        { fontSize: 18, fontWeight: '800' },
  backBtn:   { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  banner:    { padding: 10, borderRadius: 8 },
  card:      { padding: 14, borderRadius: 12, borderWidth: 1, gap: 2 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  dot:       { width: 10, height: 10, borderRadius: 5 },
  btnGhost:  { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  actionBtn: { flex: 1, minWidth: 140, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  statusBtn: { flex: 1, minWidth: 100, minHeight: 56, paddingHorizontal: 8, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  freightBtn: { minHeight: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  freightLocked: { padding: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: 16, borderWidth: 1, padding: 20, gap: 14 },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalBody: { fontSize: 14, lineHeight: 20 },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtn: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
