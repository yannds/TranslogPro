/**
 * StationAgentApp — Application Agent de Gare (tablette)
 *
 * Interface opérateur pour la vente de billets, le check-in passagers,
 * la gestion des colis et la caisse.
 *
 * Structure :
 *   Header    → nom agent + gare + heure
 *   Tabs      → Vente | Check-in | Colis | Caisse
 *
 *   [Vente]
 *     SearchTrip  → formulaire départ/arrivée/date
 *     TripList    → liste compacte des prochains départs
 *     SellForm    → saisie passager + émission billet
 *
 *   [Check-in]
 *     ScanInput  → saisie code billet / scan
 *     PassResult → résultat validation billet
 *
 *   [Colis]
 *     ColisForm  → enregistrement colis : expéditeur, destinataire, poids
 *
 *   [Caisse]
 *     CaisseSummary → résumé ventes de la journée
 */

import { useState, type FormEvent } from 'react';
import { cn } from '../../lib/utils';
import { ROLE_PERMISSIONS } from '../../lib/hooks/useNavigation';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'vente' | 'checkin' | 'colis' | 'caisse';

/** Permissions pertinentes pour cet écran */
const P_TICKET_CREATE   = 'data.ticket.create.agency';
const P_TICKET_SCAN     = 'data.ticket.scan.agency';
const P_TRAVELER_VERIFY = 'data.traveler.verify.agency';
const P_PARCEL_CREATE   = 'data.parcel.create.agency';
const P_PARCEL_SCAN     = 'data.parcel.scan.agency';
const P_CASHIER_OPEN    = 'data.cashier.open.own';
const P_CASHIER_TX      = 'data.cashier.transaction.own';

interface TabDef {
  id:    Tab;
  label: string;
  icon:  string;
  anyOf: string[];
}

const ALL_TABS: TabDef[] = [
  { id: 'vente',   label: 'Vente',    icon: '🎫', anyOf: [P_TICKET_CREATE] },
  { id: 'checkin', label: 'Check-in', icon: '✅', anyOf: [P_TICKET_SCAN, P_TRAVELER_VERIFY] },
  { id: 'colis',   label: 'Colis',    icon: '📦', anyOf: [P_PARCEL_CREATE, P_PARCEL_SCAN] },
  { id: 'caisse',  label: 'Caisse',   icon: '💰', anyOf: [P_CASHIER_OPEN, P_CASHIER_TX] },
];

function filterTabs(permissions: string[]): TabDef[] {
  const perms = new Set(permissions);
  return ALL_TABS.filter(t => t.anyOf.some(p => perms.has(p)));
}

interface UpcomingTrip {
  id:          string;
  heureDepart: string;
  destination: string;
  quai:        string;
  placesLibres:number;
  prix:        number;
  agence:      string;
}

interface CheckInResult {
  valid:    boolean;
  code:     string;
  passenger:string;
  trip:     string;
  seat:     string;
  status:   'OK' | 'ALREADY_BOARDED' | 'CANCELLED' | 'NOT_FOUND';
}

// ─── Données de démo ─────────────────────────────────────────────────────────

const UPCOMING_TRIPS: UpcomingTrip[] = [
  { id: 't1', heureDepart: '08:15', destination: 'Ziguinchor',  quai: 'A3', placesLibres: 19, prix: 8000,  agence: 'Senbus' },
  { id: 't2', heureDepart: '09:00', destination: 'Tambacounda', quai: 'D2', placesLibres: 32, prix: 5500,  agence: 'Dakar Dem Dikk' },
  { id: 't3', heureDepart: '09:15', destination: 'Diourbel',    quai: 'B3', placesLibres: 8,  prix: 2200,  agence: 'Mouride Express' },
  { id: 't4', heureDepart: '09:30', destination: 'Mbour',       quai: 'C2', placesLibres: 0,  prix: 2500,  agence: 'Ocean Express' },
  { id: 't5', heureDepart: '09:45', destination: 'Touba',       quai: 'A2', placesLibres: 21, prix: 3200,  agence: 'Touba Travel' },
];

const MOCK_TICKET: Record<string, CheckInResult> = {
  'TLP-A1B2C3': { valid: true,  code: 'TLP-A1B2C3', passenger: 'Moussa Diallo',   trip: 'Dakar → Ziguinchor 08:15', seat: '14B', status: 'OK' },
  'TLP-X9Y8Z7': { valid: false, code: 'TLP-X9Y8Z7', passenger: 'Fatou Sow',       trip: 'Dakar → Thiès 07:30',     seat: '03A', status: 'ALREADY_BOARDED' },
  'TLP-Q1Q2Q3': { valid: false, code: 'TLP-Q1Q2Q3', passenger: 'N/A',             trip: 'N/A',                     seat: 'N/A', status: 'NOT_FOUND' },
};

function formatXAF(n: number) {
  return new Intl.NumberFormat('fr-SN', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n);
}

// ─── Tab: Vente ───────────────────────────────────────────────────────────────

function TabVente() {
  const [selectedTrip, setSelectedTrip]   = useState<UpcomingTrip | null>(null);
  const [ticketIssued, setTicketIssued]   = useState(false);
  const [ticketCode]                       = useState(() => `TLP-${Date.now().toString(36).toUpperCase()}`);
  const [passenger, setPassenger]          = useState({ prenom: '', nom: '', telephone: '' });

  if (ticketIssued && selectedTrip) {
    return (
      <div className="p-5 flex flex-col items-center gap-5">
        <div className="w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center text-2xl text-white">✓</div>
        <div className="text-center">
          <p className="text-xl font-bold text-white">Billet émis !</p>
          <p className="text-slate-400 text-sm mt-1">Imprimez le billet ou envoyez par SMS.</p>
        </div>
        <div className="bg-slate-900 rounded-xl border border-slate-700 p-5 w-full max-w-sm">
          <p className="text-xs text-slate-400 uppercase tracking-widest mb-1 text-center">Code billet</p>
          <p className="text-3xl font-mono font-black text-teal-300 text-center tracking-widest">{ticketCode}</p>
          <div className="mt-4 space-y-2 text-sm">
            <InfoRow label="Passager" value={`${passenger.prenom} ${passenger.nom}`} />
            <InfoRow label="Trajet" value={`Dakar → ${selectedTrip.destination}`} />
            <InfoRow label="Départ" value={selectedTrip.heureDepart} />
            <InfoRow label="Quai" value={selectedTrip.quai} />
            <InfoRow label="Prix" value={formatXAF(selectedTrip.prix)} />
          </div>
        </div>
        <div className="flex gap-3 w-full max-w-sm">
          <button className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl font-semibold text-sm hover:bg-teal-700">
            Imprimer
          </button>
          <button
            onClick={() => { setSelectedTrip(null); setTicketIssued(false); }}
            className="flex-1 py-2.5 bg-slate-700 text-white rounded-xl font-semibold text-sm hover:bg-slate-600"
          >
            Nouveau billet
          </button>
        </div>
      </div>
    );
  }

  if (selectedTrip) {
    return (
      <div className="p-5">
        {/* Trip recap */}
        <div className="bg-teal-900/40 border border-teal-700 rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-white">Dakar → {selectedTrip.destination}</p>
              <p className="text-sm text-teal-300">{selectedTrip.heureDepart} · Quai {selectedTrip.quai} · {selectedTrip.agence}</p>
            </div>
            <p className="text-xl font-bold text-teal-300">{formatXAF(selectedTrip.prix)}</p>
          </div>
        </div>

        {/* Passenger form */}
        <div className="space-y-3 mb-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">Prénom</label>
              <input
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                value={passenger.prenom}
                onChange={e => setPassenger(p => ({ ...p, prenom: e.target.value }))}
                placeholder="Moussa"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">Nom</label>
              <input
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                value={passenger.nom}
                onChange={e => setPassenger(p => ({ ...p, nom: e.target.value }))}
                placeholder="Diallo"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">Téléphone</label>
            <input
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={passenger.telephone}
              onChange={e => setPassenger(p => ({ ...p, telephone: e.target.value }))}
              placeholder="+221 77 000 00 00"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setSelectedTrip(null)}
            className="flex-1 py-3 bg-slate-700 text-slate-300 rounded-xl font-semibold text-sm hover:bg-slate-600"
          >
            Retour
          </button>
          <button
            onClick={() => setTicketIssued(true)}
            disabled={!passenger.prenom || !passenger.nom || !passenger.telephone}
            className="flex-1 py-3 bg-teal-600 text-white rounded-xl font-bold text-sm hover:bg-teal-700 disabled:opacity-40"
          >
            Émettre le billet · {formatXAF(selectedTrip.prix)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <p className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Prochains départs</p>
      {UPCOMING_TRIPS.map(trip => (
        <button
          key={trip.id}
          disabled={trip.placesLibres === 0}
          onClick={() => setSelectedTrip(trip)}
          className={cn(
            'w-full flex items-center justify-between p-4 rounded-xl border text-left transition-all',
            trip.placesLibres === 0
              ? 'border-slate-800 bg-slate-900/50 opacity-50 cursor-not-allowed'
              : 'border-slate-700 bg-slate-900 hover:border-teal-600 hover:bg-slate-800',
          )}
        >
          <div className="flex items-center gap-4">
            <div className="text-center min-w-[3rem]">
              <p className="text-xl font-black text-white tabular-nums">{trip.heureDepart}</p>
            </div>
            <div>
              <p className="font-semibold text-white">{trip.destination}</p>
              <p className="text-xs text-slate-400 mt-0.5">Quai {trip.quai} · {trip.agence}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-teal-300">{formatXAF(trip.prix)}</p>
            {trip.placesLibres === 0 ? (
              <p className="text-xs text-red-400 mt-0.5">Complet</p>
            ) : (
              <p className="text-xs text-slate-400 mt-0.5">{trip.placesLibres} places</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Tab: Check-in ────────────────────────────────────────────────────────────

function TabCheckin() {
  const [code, setCode]           = useState('');
  const [result, setResult]       = useState<CheckInResult | null>(null);

  function handleScan(e: FormEvent) {
    e.preventDefault();
    const found = MOCK_TICKET[code.toUpperCase()];
    setResult(found ?? { valid: false, code, passenger: 'N/A', trip: 'N/A', seat: 'N/A', status: 'NOT_FOUND' });
  }

  const statusConfig = {
    OK:              { cls: 'bg-emerald-900/60 border-emerald-700 text-emerald-300', icon: '✓', label: 'VALIDE — Accès autorisé' },
    ALREADY_BOARDED: { cls: 'bg-orange-900/60 border-orange-700 text-orange-300',   icon: '⚠', label: 'DÉJÀ EMBARQUÉ — Doublon possible' },
    CANCELLED:       { cls: 'bg-red-900/60 border-red-700 text-red-300',            icon: '✕', label: 'ANNULÉ — Accès refusé' },
    NOT_FOUND:       { cls: 'bg-slate-800 border-slate-700 text-slate-400',         icon: '?', label: 'CODE INCONNU — Vérifier le billet' },
  };

  return (
    <div className="p-5 space-y-5">
      <p className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Scanner un billet</p>

      <form onSubmit={handleScan} className="flex gap-3">
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="TLP-XXXXXX — Code ou scan QR"
          className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 uppercase placeholder:normal-case placeholder:text-slate-500"
          autoFocus
        />
        <button
          type="submit"
          className="px-5 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700"
        >
          Vérifier
        </button>
      </form>

      {/* Hint */}
      <p className="text-xs text-slate-500">Essayez : TLP-A1B2C3 (valide) · TLP-X9Y8Z7 (déjà embarqué)</p>

      {result && (
        <div className={cn('rounded-2xl border p-5', statusConfig[result.status].cls)}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">{statusConfig[result.status].icon}</span>
            <p className="text-lg font-black uppercase">{statusConfig[result.status].label}</p>
          </div>
          {result.status !== 'NOT_FOUND' && (
            <div className="space-y-2 text-sm">
              <InfoRow label="Passager" value={result.passenger} />
              <InfoRow label="Trajet"   value={result.trip} />
              <InfoRow label="Siège"    value={result.seat} />
              <InfoRow label="Code"     value={result.code} />
            </div>
          )}
          {result.status === 'OK' && (
            <button className="mt-4 w-full py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700">
              Confirmer l'embarquement
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Colis ───────────────────────────────────────────────────────────────

function TabColis() {
  const [form, setForm] = useState({
    expediteur: '', destinataire: '', telephone: '', destination: 'Ziguinchor', description: '', poids: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [trackCode] = useState(() => `COL-${Date.now().toString(36).toUpperCase()}`);

  if (submitted) {
    return (
      <div className="p-5 flex flex-col items-center gap-4">
        <div className="w-14 h-14 bg-purple-500 rounded-full flex items-center justify-center text-2xl text-white">📦</div>
        <p className="text-xl font-bold text-white">Colis enregistré !</p>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-sm">
          <p className="text-xs text-slate-400 uppercase tracking-widest text-center mb-1">Code de suivi</p>
          <p className="text-3xl font-mono font-black text-purple-300 text-center tracking-widest">{trackCode}</p>
          <div className="mt-4 space-y-2 text-sm">
            <InfoRow label="Expéditeur"  value={form.expediteur} />
            <InfoRow label="Destinataire" value={form.destinataire} />
            <InfoRow label="Destination" value={form.destination} />
            <InfoRow label="Description" value={form.description} />
            <InfoRow label="Poids"       value={`${form.poids} kg`} />
          </div>
        </div>
        <button
          onClick={() => { setSubmitted(false); setForm({ expediteur: '', destinataire: '', telephone: '', destination: 'Ziguinchor', description: '', poids: '' }); }}
          className="py-2.5 px-8 bg-slate-700 text-white rounded-xl font-semibold text-sm hover:bg-slate-600"
        >
          Nouveau colis
        </button>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-3">
      <p className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Enregistrement colis</p>
      {[
        { label: 'Expéditeur', key: 'expediteur', placeholder: 'Nom de l\'expéditeur' },
        { label: 'Destinataire', key: 'destinataire', placeholder: 'Nom du destinataire' },
        { label: 'Téléphone destinataire', key: 'telephone', placeholder: '+221 77 000 00 00' },
      ].map(({ label, key, placeholder }) => (
        <div key={key}>
          <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">{label}</label>
          <input
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder={placeholder}
            value={(form as any)[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">Destination</label>
          <select
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={form.destination}
            onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
          >
            {['Ziguinchor', 'Tambacounda', 'Kaolack', 'Saint-Louis', 'Thiès', 'Diourbel', 'Touba'].map(v => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">Poids (kg)</label>
          <input
            type="number"
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="5"
            value={form.poids}
            onChange={e => setForm(f => ({ ...f, poids: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">Description</label>
        <input
          className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          placeholder="Vêtements, alimentation, fragile..."
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
      </div>
      <button
        onClick={() => setSubmitted(true)}
        disabled={!form.expediteur || !form.destinataire || !form.poids}
        className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 disabled:opacity-40 mt-2"
      >
        Enregistrer le colis
      </button>
    </div>
  );
}

// ─── Tab: Caisse ──────────────────────────────────────────────────────────────

function TabCaisse() {
  const sales = [
    { heure: '07:15', passager: 'Moussa Diallo',   destination: 'Ziguinchor',  prix: 8000,  mode: 'Cash' },
    { heure: '07:28', passager: 'Fatou Ba',         destination: 'Kaolack',     prix: 2800,  mode: 'Wave' },
    { heure: '07:44', passager: 'Ibrahima Seck',    destination: 'Saint-Louis', prix: 3500,  mode: 'Orange Money' },
    { heure: '08:00', passager: 'Aissatou Diallo',  destination: 'Tambacounda', prix: 5500,  mode: 'Cash' },
    { heure: '08:11', passager: 'Cheikh Touré',     destination: 'Diourbel',    prix: 2200,  mode: 'Wave' },
  ];
  const total = sales.reduce((s, r) => s + r.prix, 0);
  const byMode: Record<string, number> = {};
  sales.forEach(s => { byMode[s.mode] = (byMode[s.mode] ?? 0) + s.prix; });

  return (
    <div className="p-5 space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-teal-900/40 border border-teal-700 rounded-xl p-4 text-center">
          <p className="text-xs text-teal-400 uppercase tracking-wider font-semibold">Total journée</p>
          <p className="text-2xl font-black text-white mt-1">{formatXAF(total)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Billets vendus</p>
          <p className="text-2xl font-black text-white mt-1">{sales.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Colis</p>
          <p className="text-2xl font-black text-white mt-1">3</p>
        </div>
      </div>

      {/* By mode */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Par mode de paiement</p>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(byMode).map(([mode, amt]) => (
            <span key={mode} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm">
              <span className="text-slate-400">{mode}:</span>{' '}
              <span className="text-white font-semibold">{formatXAF(amt)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Transaction list */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Transactions récentes</p>
        <div className="space-y-2">
          {sales.map((s, i) => (
            <div key={i} className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-slate-500 tabular-nums">{s.heure}</span>
                <div>
                  <p className="text-sm font-medium text-white">{s.passager}</p>
                  <p className="text-xs text-slate-500">{s.destination} · {s.mode}</p>
                </div>
              </div>
              <span className="text-sm font-bold text-teal-300">{formatXAF(s.prix)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

type DemoRoleKey = keyof typeof ROLE_PERMISSIONS;

const DEMO_ROLES: DemoRoleKey[] = ['STATION_AGENT', 'SUPERVISOR', 'CASHIER', 'AGENCY_MANAGER'];

export function StationAgentApp() {
  const [roleIdx, setRoleIdx]   = useState(0);
  const roleKey                  = DEMO_ROLES[roleIdx] as DemoRoleKey;
  const permissions              = ROLE_PERMISSIONS[roleKey] ?? [];
  const TABS                     = filterTabs(permissions);
  const [tab, setTab]            = useState<Tab>(() => filterTabs(permissions)[0]?.id ?? 'vente');

  // Reset tab when role changes and tab is no longer visible
  const visibleIds = TABS.map(t => t.id);
  const effectiveTab: Tab = visibleIds.includes(tab) ? tab : (visibleIds[0] ?? 'vente');

  return (
    <div
      className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-600 rounded-full flex items-center justify-center font-bold text-sm">NA</div>
          <div>
            <p className="text-sm font-bold text-white">Nadège Nkounkou</p>
            <p className="text-xs text-slate-400">Gare Routière de Pointe-Noire</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Role switcher démo */}
          <select
            value={roleIdx}
            onChange={e => { const idx = Number(e.target.value); setRoleIdx(idx); const tabs = filterTabs(ROLE_PERMISSIONS[DEMO_ROLES[idx]!] ?? []); setTab(tabs[0]?.id ?? 'vente'); }}
            className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1 focus:outline-none"
          >
            {DEMO_ROLES.map((r, i) => <option key={r} value={i}>{r}</option>)}
          </select>
          <span className="text-xs bg-emerald-900/60 text-emerald-300 border border-emerald-700 px-2 py-1 rounded-lg font-semibold">
            En service
          </span>
          <span className="text-sm font-mono text-slate-400">
            {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </header>

      {/* Tabs — filtrés par permissions */}
      <div className="flex border-b border-slate-800 shrink-0 bg-slate-900">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 flex flex-col items-center gap-1 py-3 text-xs font-semibold uppercase tracking-wide transition-colors',
              effectiveTab === t.id
                ? 'text-teal-400 border-b-2 border-teal-500 bg-slate-800'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50',
            )}
          >
            <span className="text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
        {TABS.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-3 text-xs text-slate-600">
            Aucune permission configurée
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {effectiveTab === 'vente'   && <TabVente />}
        {effectiveTab === 'checkin' && <TabCheckin />}
        {effectiveTab === 'colis'   && <TabColis />}
        {effectiveTab === 'caisse'  && <TabCaisse />}
      </div>
    </div>
  );
}

export default StationAgentApp;
