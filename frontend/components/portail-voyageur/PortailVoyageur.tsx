/**
 * PortailVoyageur — Portail public de réservation de billets
 *
 * Structure :
 *   HeroSection    → barre de recherche principale (départ/arrivée/date/passagers)
 *   TripResults    → liste des trajets disponibles avec filtres
 *   TripCard       → carte résultat (agence, horaire, durée, prix, places)
 *   BookingDrawer  → tunnel de réservation (3 étapes : passager → paiement → confirmation)
 *
 * Design : fond blanc/gris clair, accents teal, typographie claire.
 * Mobile-first. Responsive.
 */

import { useState, type FormEvent } from 'react';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TripResult {
  id:          string;
  agence:      string;
  agenceLogo?: string;
  depart:      string;   // nom ville
  arrivee:     string;
  heureDepart: string;   // ex. "07:30"
  heureArrivee:string;
  dureeMin:    number;
  prix:        number;   // XAF
  placesLibres:number;
  busType:     string;
  amenities:   string[];
}

interface PassengerInfo {
  prenom:    string;
  nom:       string;
  telephone: string;
  email:     string;
  typePlace: 'STANDARD' | 'VIP';
}

// ─── Données de démo ─────────────────────────────────────────────────────────

const DEMO_TRIPS: TripResult[] = [
  {
    id: 't1', agence: 'Dakar Dem Dikk', depart: 'Dakar', arrivee: 'Saint-Louis',
    heureDepart: '07:00', heureArrivee: '11:30', dureeMin: 270,
    prix: 3500, placesLibres: 12, busType: 'Mercedes Actros', amenities: ['Clim', 'Wifi'],
  },
  {
    id: 't2', agence: 'Mouride Express', depart: 'Dakar', arrivee: 'Saint-Louis',
    heureDepart: '09:15', heureArrivee: '14:00', dureeMin: 285,
    prix: 3000, placesLibres: 4, busType: 'King Long', amenities: ['Clim'],
  },
  {
    id: 't3', agence: 'Ndiaga Ndiaye Transport', depart: 'Dakar', arrivee: 'Saint-Louis',
    heureDepart: '11:30', heureArrivee: '16:15', dureeMin: 285,
    prix: 2800, placesLibres: 27, busType: 'Yutong', amenities: ['Clim', 'Chargeurs USB'],
  },
  {
    id: 't4', agence: 'Dakar Dem Dikk', depart: 'Dakar', arrivee: 'Saint-Louis',
    heureDepart: '14:00', heureArrivee: '18:30', dureeMin: 270,
    prix: 3500, placesLibres: 0, busType: 'Mercedes Actros', amenities: ['Clim', 'Wifi', 'Toilettes'],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuree(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

function formatXAF(n: number) {
  return new Intl.NumberFormat('fr-SN', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n);
}

// ─── Composants partiels ─────────────────────────────────────────────────────

function AmenityChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 border border-teal-100">
      {label === 'Clim' && <span>❄</span>}
      {label === 'Wifi' && <span>⚡</span>}
      {label === 'Toilettes' && <span>◉</span>}
      {label === 'Chargeurs USB' && <span>⚑</span>}
      {label}
    </span>
  );
}

function TripCard({
  trip,
  onBook,
}: { trip: TripResult; onBook: (t: TripResult) => void }) {
  const complet = trip.placesLibres === 0;
  const urgence = trip.placesLibres > 0 && trip.placesLibres <= 5;

  return (
    <div
      className={cn(
        'bg-white rounded-2xl border shadow-sm hover:shadow-md transition-shadow',
        complet ? 'border-slate-200 opacity-70' : 'border-slate-200 hover:border-teal-300',
      )}
    >
      {/* Header agence */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-600">{trip.agence}</p>
          <p className="text-xs text-slate-400 mt-0.5">{trip.busType}</p>
        </div>
        <div className="flex gap-1.5">
          {trip.amenities.map(a => <AmenityChip key={a} label={a} />)}
        </div>
      </div>

      {/* Horaires */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{trip.heureDepart}</p>
          <p className="text-sm text-slate-500 mt-0.5">{trip.depart}</p>
        </div>

        <div className="flex flex-col items-center gap-1 flex-1 px-4">
          <p className="text-xs text-slate-400 font-medium">{formatDuree(trip.dureeMin)}</p>
          <div className="relative w-full">
            <div className="absolute inset-y-1/2 left-0 right-0 border-t-2 border-dashed border-slate-200" />
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-teal-500" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-teal-500" />
          </div>
          <p className="text-[10px] text-slate-400">Direct</p>
        </div>

        <div className="text-center">
          <p className="text-3xl font-bold text-slate-900 tabular-nums">{trip.heureArrivee}</p>
          <p className="text-sm text-slate-500 mt-0.5">{trip.arrivee}</p>
        </div>
      </div>

      {/* Footer : prix + places + bouton */}
      <div className="flex items-center justify-between px-5 pb-5 gap-4">
        <div>
          <p className="text-2xl font-bold text-teal-700">{formatXAF(trip.prix)}</p>
          <p className="text-xs text-slate-400">par passager</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {complet && (
            <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Complet</span>
          )}
          {urgence && (
            <span className="text-xs font-semibold text-amber-600 animate-pulse">
              Plus que {trip.placesLibres} places !
            </span>
          )}
          {!complet && !urgence && (
            <span className="text-xs text-slate-400">{trip.placesLibres} places disponibles</span>
          )}
          <button
            disabled={complet}
            onClick={() => onBook(trip)}
            className={cn(
              'px-5 py-2.5 rounded-xl text-sm font-semibold transition-all',
              complet
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-teal-600 text-white hover:bg-teal-700 active:scale-95 shadow-sm',
            )}
          >
            {complet ? 'Indisponible' : 'Réserver'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Booking drawer ───────────────────────────────────────────────────────────

type BookingStep = 'passenger' | 'payment' | 'confirmation';

function BookingDrawer({
  trip,
  onClose,
}: { trip: TripResult; onClose: () => void }) {
  const [step, setStep]             = useState<BookingStep>('passenger');
  const [passenger, setPassenger]   = useState<Partial<PassengerInfo>>({});
  const [ticketCode]                = useState(() => `TLP-${Date.now().toString(36).toUpperCase()}`);

  const progress: Record<BookingStep, number> = { passenger: 1, payment: 2, confirmation: 3 };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full sm:max-w-lg bg-white sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <div>
            <p className="font-bold text-slate-900">{trip.depart} → {trip.arrivee}</p>
            <p className="text-sm text-slate-500">{trip.heureDepart} · {trip.agence} · {formatXAF(trip.prix)}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-400">
            ✕
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {(['passenger', 'payment', 'confirmation'] as BookingStep[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1 last:flex-none">
                <div className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                  progress[step] > i
                    ? 'bg-teal-600 text-white'
                    : progress[step] === i + 1
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 text-slate-400',
                )}>
                  {progress[step] > i + 1 ? '✓' : i + 1}
                </div>
                <span className={cn(
                  'text-xs font-medium hidden sm:block',
                  step === s ? 'text-teal-700' : 'text-slate-400',
                )}>
                  {s === 'passenger' ? 'Passager' : s === 'payment' ? 'Paiement' : 'Confirmation'}
                </span>
                {i < 2 && <div className="flex-1 h-px bg-slate-200" />}
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'passenger' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800">Informations passager</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Prénom</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="Moussa"
                    value={passenger.prenom || ''}
                    onChange={e => setPassenger(p => ({ ...p, prenom: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nom</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="Diallo"
                    value={passenger.nom || ''}
                    onChange={e => setPassenger(p => ({ ...p, nom: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Téléphone</label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="+221 77 000 00 00"
                  value={passenger.telephone || ''}
                  onChange={e => setPassenger(p => ({ ...p, telephone: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email (optionnel)</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="moussa@exemple.com"
                  value={passenger.email || ''}
                  onChange={e => setPassenger(p => ({ ...p, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Type de place</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['STANDARD', 'VIP'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setPassenger(p => ({ ...p, typePlace: t }))}
                      className={cn(
                        'p-3 rounded-xl border-2 text-sm font-medium transition-all',
                        passenger.typePlace === t
                          ? 'border-teal-500 bg-teal-50 text-teal-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300',
                      )}
                    >
                      {t === 'STANDARD' ? '💺 Standard' : '⭐ VIP'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 'payment' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800">Paiement</h3>
              <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Billet {trip.depart} → {trip.arrivee}</span>
                  <span className="font-medium">{formatXAF(trip.prix)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Frais de service</span>
                  <span className="font-medium">{formatXAF(200)}</span>
                </div>
                <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-teal-700">
                  <span>Total</span>
                  <span>{formatXAF(trip.prix + 200)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Mode de paiement</p>
                {[
                  { id: 'wave', label: 'Wave', desc: '+221 XX XXX XX XX' },
                  { id: 'orange', label: 'Orange Money', desc: '+221 XX XXX XX XX' },
                  { id: 'mtn', label: 'Free Money', desc: '+221 XX XXX XX XX' },
                ].map(m => (
                  <label key={m.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-teal-300 transition-colors">
                    <input type="radio" name="payment" className="text-teal-600" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">{m.label}</p>
                      <p className="text-xs text-slate-400">{m.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 'confirmation' && (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto text-3xl">
                ✓
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Réservation confirmée !</h3>
                <p className="text-slate-500 text-sm mt-1">
                  Votre billet a été envoyé par SMS et email.
                </p>
              </div>
              <div className="bg-teal-50 rounded-2xl p-5 border border-teal-100">
                <p className="text-xs text-teal-600 uppercase tracking-wider font-semibold mb-1">Code de billet</p>
                <p className="text-3xl font-mono font-bold text-teal-800 tracking-widest">{ticketCode}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2">
                <InfoRow label="Trajet" value={`${trip.depart} → ${trip.arrivee}`} />
                <InfoRow label="Date" value={new Date().toLocaleDateString('fr-SN', { weekday: 'long', day: 'numeric', month: 'long' })} />
                <InfoRow label="Départ" value={trip.heureDepart} />
                <InfoRow label="Agence" value={trip.agence} />
                <InfoRow label="Passager" value={`${passenger.prenom || ''} ${passenger.nom || ''}`.trim() || 'N/A'} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-slate-100">
          {step === 'passenger' && (
            <button
              onClick={() => setStep('payment')}
              className="w-full py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-colors"
            >
              Continuer vers le paiement
            </button>
          )}
          {step === 'payment' && (
            <div className="flex gap-3">
              <button
                onClick={() => setStep('passenger')}
                className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-medium hover:bg-slate-50"
              >
                Retour
              </button>
              <button
                onClick={() => setStep('confirmation')}
                className="flex-1 py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700"
              >
                Payer {formatXAF(trip.prix + 200)}
              </button>
            </div>
          )}
          {step === 'confirmation' && (
            <button
              onClick={onClose}
              className="w-full py-3 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800"
            >
              Fermer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PortailVoyageur() {
  const [depart, setDepart]           = useState('Dakar');
  const [arrivee, setArrivee]         = useState('Saint-Louis');
  const [date, setDate]               = useState(new Date().toISOString().slice(0, 10));
  const [_passengers, _setPassengers]  = useState(1);
  const [searched, setSearched]       = useState(false);
  const [sortBy, setSortBy]           = useState<'prix' | 'heure'>('heure');
  const [selectedTrip, setSelectedTrip] = useState<TripResult | null>(null);

  const VILLES = ['Dakar', 'Saint-Louis', 'Thiès', 'Kaolack', 'Ziguinchor', 'Tambacounda', 'Diourbel'];

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSearched(true);
  }

  function swapVilles() {
    const tmp = depart;
    setDepart(arrivee);
    setArrivee(tmp);
  }

  const results = searched
    ? [...DEMO_TRIPS].sort((a, b) =>
        sortBy === 'prix'
          ? a.prix - b.prix
          : a.heureDepart.localeCompare(b.heureDepart),
      )
    : [];

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* ── Navbar ──────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold text-sm">
              T
            </div>
            <span className="font-bold text-slate-900 text-lg">TranslogPro</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="#" className="text-sm text-slate-600 hover:text-teal-700 font-medium hidden sm:block">
              Mes réservations
            </a>
            <button className="text-sm bg-teal-600 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-teal-700">
              Connexion
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-teal-700 via-teal-600 to-teal-800 text-white">
        <div className="max-w-4xl mx-auto px-4 pt-12 pb-8">
          <h1 className="text-3xl sm:text-4xl font-extrabold mb-2 leading-tight">
            Voyagez partout au Sénégal
          </h1>
          <p className="text-teal-100 mb-8 text-lg">
            Comparez et réservez vos billets de bus en quelques secondes.
          </p>

          {/* Search form */}
          <form
            onSubmit={handleSearch}
            className="bg-white rounded-2xl p-4 sm:p-5 shadow-xl"
          >
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_1fr_auto] gap-3 items-end">
              {/* Départ */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Départ
                </label>
                <select
                  value={depart}
                  onChange={e => setDepart(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                >
                  {VILLES.map(v => <option key={v}>{v}</option>)}
                </select>
              </div>

              {/* Swap */}
              <button
                type="button"
                onClick={swapVilles}
                className="self-end mb-0.5 p-2.5 rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-teal-600 transition-colors"
                title="Inverser"
              >
                ⇄
              </button>

              {/* Arrivée */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Arrivée
                </label>
                <select
                  value={arrivee}
                  onChange={e => setArrivee(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                >
                  {VILLES.map(v => <option key={v}>{v}</option>)}
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="self-end bg-teal-600 text-white rounded-xl px-5 py-2.5 font-semibold hover:bg-teal-700 transition-colors whitespace-nowrap text-sm"
              >
                Rechercher
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ── Résultats ─────────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {!searched ? (
          /* Suggestions populaires */
          <div>
            <h2 className="text-lg font-bold text-slate-800 mb-4">Trajets populaires</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { from: 'Dakar', to: 'Thiès', prix: 1800 },
                { from: 'Dakar', to: 'Saint-Louis', prix: 3500 },
                { from: 'Dakar', to: 'Kaolack', prix: 2500 },
                { from: 'Dakar', to: 'Ziguinchor', prix: 8000 },
              ].map(t => (
                <button
                  key={t.to}
                  onClick={() => { setDepart(t.from); setArrivee(t.to); setSearched(true); }}
                  className="bg-white rounded-xl p-4 border border-slate-200 hover:border-teal-300 hover:shadow-sm transition-all text-left group"
                >
                  <p className="text-sm font-semibold text-slate-800 group-hover:text-teal-700">{t.from} → {t.to}</p>
                  <p className="text-xs text-teal-600 font-medium mt-1">dès {formatXAF(t.prix)}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            {/* Résultats header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-slate-900 text-lg">
                  {depart} → {arrivee}
                </h2>
                <p className="text-sm text-slate-500">
                  {new Date(date).toLocaleDateString('fr-SN', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {' · '}
                  {results.filter(t => t.placesLibres > 0).length} trajet(s) disponible(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 hidden sm:block">Trier par :</span>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'prix' | 'heure')}
                  className="rounded-lg border border-slate-200 text-sm px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="heure">Heure de départ</option>
                  <option value="prix">Prix</option>
                </select>
              </div>
            </div>

            <div className="space-y-4">
              {results.map(trip => (
                <TripCard key={trip.id} trip={trip} onBook={setSelectedTrip} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-white mt-12 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-400">© 2026 TranslogPro — Tous droits réservés</p>
          <div className="flex gap-5 text-sm text-slate-500">
            <a href="#" className="hover:text-teal-700">CGV</a>
            <a href="#" className="hover:text-teal-700">Confidentialité</a>
            <a href="#" className="hover:text-teal-700">Contact</a>
          </div>
        </div>
      </footer>

      {/* ── Booking drawer ────────────────────────────────────────────────── */}
      {selectedTrip && (
        <BookingDrawer trip={selectedTrip} onClose={() => setSelectedTrip(null)} />
      )}
    </div>
  );
}

export default PortailVoyageur;
