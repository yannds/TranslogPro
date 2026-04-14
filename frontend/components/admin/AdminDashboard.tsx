/**
 * AdminDashboard — Panneau d'administration TranslogPro (desktop)
 *
 * Interface complète de gestion pour les administrateurs de l'agence/plateforme.
 * Intègre le SidebarLayout existant.
 *
 * Structure :
 *   SidebarLayout  → navigation principale
 *   Pages :
 *     Dashboard    → KPIs + graphiques + activité récente
 *     Flotte       → liste des bus avec statuts
 *     Trajets      → tableau des trajets + filtres
 *     Billetterie  → ventes et remboursements
 *     Rentabilité  → snapshots coûts/marges par trajet
 *     Paramètres   → white-label + config tarifs
 */

import { useState } from 'react';
import { SidebarLayout } from '../layout/SidebarLayout';
import { StatusBadge }   from '../ui/Badge';
import { cn }            from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminPage =
  | 'dashboard'
  | 'flotte'
  | 'trajets'
  | 'billetterie'
  | 'rentabilite'
  | 'parametres';

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, delta, icon, accent = 'teal',
}: {
  label:  string;
  value:  string;
  sub?:   string;
  delta?: { value: string; up: boolean };
  icon:   string;
  accent?: 'teal' | 'amber' | 'emerald' | 'purple' | 'red';
}) {
  const colors: Record<string, string> = {
    teal:    'bg-teal-500/10 text-teal-400',
    amber:   'bg-amber-500/10 text-amber-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    purple:  'bg-purple-500/10 text-purple-400',
    red:     'bg-red-500/10 text-red-400',
  };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-lg', colors[accent])}>
          {icon}
        </div>
        {delta && (
          <span className={cn(
            'text-xs font-semibold px-2 py-0.5 rounded-full',
            delta.up
              ? 'bg-emerald-900/60 text-emerald-400'
              : 'bg-red-900/60 text-red-400',
          )}>
            {delta.up ? '↑' : '↓'} {delta.value}
          </span>
        )}
      </div>
      <p className="text-3xl font-black text-white tabular-nums">{value}</p>
      <p className="text-sm font-medium text-slate-400 mt-1">{label}</p>
      {sub && <p className="text-xs text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Mini Bar Chart ───────────────────────────────────────────────────────────

function MiniBarChart({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const max = Math.max(...data.map(d => d.value));
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
      <p className="text-sm font-semibold text-slate-300 mb-4">{label}</p>
      <div className="flex items-end gap-2 h-24">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full bg-teal-600 rounded-t-sm hover:bg-teal-500 transition-colors cursor-pointer"
              style={{ height: `${max > 0 ? (d.value / max) * 100 : 0}%` }}
              title={`${d.label}: ${d.value}`}
            />
            <span className="text-[9px] text-slate-500 truncate w-full text-center">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page: Dashboard ─────────────────────────────────────────────────────────

function PageDashboard() {
  const recent = [
    { id: 't1', time: '08:15', route: 'Dakar → Ziguinchor', passagers: 47, revenue: 376000, status: 'EN_COURS' },
    { id: 't2', time: '07:00', route: 'Dakar → Saint-Louis', passagers: 38, revenue: 133000, status: 'ARRIVED' },
    { id: 't3', time: '06:30', route: 'Dakar → Kaolack',    passagers: 42, revenue: 117600, status: 'ARRIVED' },
    { id: 't4', time: '09:00', route: 'Dakar → Tambacounda', passagers: 0,  revenue: 0,      status: 'SCHEDULED' },
    { id: 't5', time: '09:15', route: 'Dakar → Diourbel',   passagers: 0,  revenue: 0,      status: 'SCHEDULED' },
  ];

  const chartData = [
    { label: 'Lun', value: 42 },
    { label: 'Mar', value: 38 },
    { label: 'Mer', value: 51 },
    { label: 'Jeu', value: 45 },
    { label: 'Ven', value: 63 },
    { label: 'Sam', value: 78 },
    { label: 'Dim', value: 56 },
  ];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Revenus aujourd'hui"   value="628 300 FCFA" delta={{ value: '12%', up: true }}   icon="💰" accent="emerald" />
        <KpiCard label="Trajets actifs"         value="4"           sub="sur 7 prévus"                   icon="🚌" accent="teal" />
        <KpiCard label="Passagers transportés" value="127"          delta={{ value: '8%', up: true }}    icon="👥" accent="purple" />
        <KpiCard label="Taux d'occupation moy." value="76%"         delta={{ value: '3%', up: false }}   icon="📊" accent="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart */}
        <div className="lg:col-span-2">
          <MiniBarChart data={chartData} label="Passagers transportés — 7 derniers jours" />
        </div>

        {/* Status summary */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <p className="text-sm font-semibold text-slate-300 mb-4">Flotte aujourd'hui</p>
          <div className="space-y-3">
            {[
              { label: 'Bus en service',   count: 4,  color: 'bg-teal-500' },
              { label: 'En maintenance',   count: 1,  color: 'bg-amber-500' },
              { label: 'Disponibles',      count: 3,  color: 'bg-slate-700' },
              { label: 'Hors service',     count: 0,  color: 'bg-red-500' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn('w-2 h-2 rounded-full', item.color)} />
                  <span className="text-sm text-slate-400">{item.label}</span>
                </div>
                <span className="text-sm font-bold text-white">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent trips */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <p className="text-sm font-semibold text-slate-300">Activité récente</p>
          <button className="text-xs text-teal-400 hover:underline">Voir tout →</button>
        </div>
        <div className="divide-y divide-slate-800">
          {recent.map(t => (
            <div key={t.id} className="flex items-center gap-4 px-5 py-3">
              <span className="text-sm font-mono text-slate-500 w-10 shrink-0 tabular-nums">{t.time}</span>
              <span className="flex-1 text-sm text-white font-medium">{t.route}</span>
              <span className="text-sm text-slate-400 hidden md:block">
                {t.passagers > 0 ? `${t.passagers} pax` : '—'}
              </span>
              <span className="text-sm font-semibold text-teal-300 hidden lg:block tabular-nums w-28 text-right">
                {t.revenue > 0 ? `${t.revenue.toLocaleString('fr-SN')} F` : '—'}
              </span>
              <StatusBadge status={t.status} size="sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page: Flotte ─────────────────────────────────────────────────────────────

function PageFlotte() {
  const buses = [
    { id: 'b1', plaque: 'DK 4321 EF', modele: 'Mercedes Actros', capacite: 50, statut: 'IN_SERVICE',  chauffeur: 'Ousmane Faye',     km: 145000 },
    { id: 'b2', plaque: 'DK 1234 AB', modele: 'King Long XMQ6130Y', capacite: 50, statut: 'IN_SERVICE', chauffeur: 'Mamadou Diallo', km: 89000 },
    { id: 'b3', plaque: 'TH 0011 CD', modele: 'Yutong ZK6122HQ',    capacite: 44, statut: 'MAINTENANCE', chauffeur: '—',             km: 201000 },
    { id: 'b4', plaque: 'DK 7722 IJ', modele: 'Mercedes Actros',    capacite: 50, statut: 'AVAILABLE',  chauffeur: '—',              km: 67000 },
    { id: 'b5', plaque: 'SL 9900 GH', modele: 'King Long XMQ6130Y', capacite: 50, statut: 'AVAILABLE',  chauffeur: '—',              km: 134000 },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <p className="text-sm font-semibold text-slate-300">Gestion de la flotte</p>
        <button className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-teal-700">
          + Ajouter un bus
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left">
              {['Plaque', 'Modèle', 'Capacité', 'Kilométrage', 'Chauffeur', 'Statut', ''].map(h => (
                <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {buses.map(b => (
              <tr key={b.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="px-5 py-3 font-mono font-semibold text-white">{b.plaque}</td>
                <td className="px-5 py-3 text-slate-300">{b.modele}</td>
                <td className="px-5 py-3 text-slate-400">{b.capacite} sièges</td>
                <td className="px-5 py-3 text-slate-400 tabular-nums">{b.km.toLocaleString('fr-SN')} km</td>
                <td className="px-5 py-3 text-slate-300">{b.chauffeur}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={b.statut} size="sm" />
                </td>
                <td className="px-5 py-3">
                  <button className="text-xs text-teal-400 hover:underline">Détails</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page: Rentabilité ────────────────────────────────────────────────────────

function PageRentabilite() {
  const snapshots = [
    { id: 's1', date: '14/04/2026', route: 'Dakar → Ziguinchor',  revenue: 376000, cost: 280000, margin: 96000,  fillRate: 0.94, tag: 'PROFITABLE' },
    { id: 's2', date: '14/04/2026', route: 'Dakar → Saint-Louis', revenue: 133000, cost: 112000, margin: 21000,  fillRate: 0.76, tag: 'PROFITABLE' },
    { id: 's3', date: '13/04/2026', route: 'Dakar → Tambacounda', revenue: 88000,  cost: 95000,  margin: -7000,  fillRate: 0.32, tag: 'DEFICIT' },
    { id: 's4', date: '13/04/2026', route: 'Dakar → Kaolack',     revenue: 117600, cost: 115000, margin: 2600,   fillRate: 0.84, tag: 'BREAK_EVEN' },
    { id: 's5', date: '12/04/2026', route: 'Dakar → Diourbel',    revenue: 96800,  cost: 82000,  margin: 14800,  fillRate: 0.88, tag: 'PROFITABLE' },
  ];

  const tagConfig: Record<string, string> = {
    PROFITABLE: 'bg-emerald-900/60 text-emerald-300 border-emerald-700',
    BREAK_EVEN: 'bg-amber-900/60 text-amber-300 border-amber-700',
    DEFICIT:    'bg-red-900/60 text-red-300 border-red-700',
  };

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Marge nette totale" value="126 400 F" delta={{ value: '4%', up: true }} icon="📈" accent="emerald" />
        <KpiCard label="Trajets rentables"  value="4/5"       sub="80% cette semaine"          icon="✅" accent="teal" />
        <KpiCard label="Taux remplissage moyen" value="74.8%"  delta={{ value: '2%', up: false }}  icon="💺" accent="amber" />
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <p className="text-sm font-semibold text-slate-300">Snapshots de rentabilité</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['Date', 'Trajet', 'Revenu', 'Coûts', 'Marge nette', 'Taux remplissage', 'Tag'].map(h => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {snapshots.map(s => (
                <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3 text-slate-500 tabular-nums text-xs">{s.date}</td>
                  <td className="px-5 py-3 text-white font-medium">{s.route}</td>
                  <td className="px-5 py-3 text-slate-300 tabular-nums">{s.revenue.toLocaleString('fr-SN')} F</td>
                  <td className="px-5 py-3 text-slate-300 tabular-nums">{s.cost.toLocaleString('fr-SN')} F</td>
                  <td className={cn('px-5 py-3 font-bold tabular-nums', s.margin >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {s.margin >= 0 ? '+' : ''}{s.margin.toLocaleString('fr-SN')} F
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', s.fillRate >= 0.8 ? 'bg-emerald-500' : s.fillRate >= 0.5 ? 'bg-amber-500' : 'bg-red-500')}
                          style={{ width: `${s.fillRate * 100}%` }}
                        />
                      </div>
                      <span className="text-slate-400 tabular-nums text-xs">{Math.round(s.fillRate * 100)}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn('text-[10px] font-bold px-2 py-1 rounded border uppercase', tagConfig[s.tag])}>
                      {s.tag.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Page: Paramètres (White Label) ──────────────────────────────────────────

function PageParametres() {
  const [brand, setBrand] = useState({
    brandName:    'Dakar Dem Dikk',
    primaryColor: '#0d9488',
    secondaryColor: '#1a3a5c',
    accentColor:  '#f59e0b',
    bgColor:      '#ffffff',
    textColor:    '#111827',
    fontFamily:   'Inter, sans-serif',
    metaTitle:    'Dakar Dem Dikk — Réservez votre billet',
  });
  const [saved, setSaved] = useState(false);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* White-label form */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <p className="text-sm font-semibold text-slate-300">Personnalisation de la marque</p>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Nom de la marque</label>
          <input
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={brand.brandName}
            onChange={e => setBrand(b => ({ ...b, brandName: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Couleur primaire',   key: 'primaryColor' },
            { label: 'Couleur secondaire', key: 'secondaryColor' },
            { label: 'Couleur accent',     key: 'accentColor' },
            { label: 'Couleur texte',      key: 'textColor' },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  className="w-8 h-8 rounded border border-slate-700 bg-slate-800 cursor-pointer"
                  value={(brand as any)[key]}
                  onChange={e => setBrand(b => ({ ...b, [key]: e.target.value }))}
                />
                <input
                  className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
                  value={(brand as any)[key]}
                  onChange={e => setBrand(b => ({ ...b, [key]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Titre de page (SEO)</label>
          <input
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={brand.metaTitle}
            onChange={e => setBrand(b => ({ ...b, metaTitle: e.target.value }))}
          />
        </div>

        <button
          onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
          className="w-full py-2.5 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 text-sm"
        >
          {saved ? '✓ Enregistré !' : 'Sauvegarder les modifications'}
        </button>
      </div>

      {/* Live preview */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Aperçu en temps réel</p>
        <div
          className="rounded-xl overflow-hidden border border-slate-700 shadow-lg"
          style={{ fontFamily: brand.fontFamily, backgroundColor: brand.bgColor, color: brand.textColor }}
        >
          {/* Mini navbar */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#e2e8f0' }}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: brand.primaryColor }}>
                {brand.brandName.charAt(0)}
              </div>
              <span className="text-sm font-bold">{brand.brandName}</span>
            </div>
            <div className="w-14 h-5 rounded text-[10px] font-semibold flex items-center justify-center text-white" style={{ backgroundColor: brand.primaryColor }}>
              Connexion
            </div>
          </div>
          {/* Mini hero */}
          <div className="px-4 py-5 text-white text-center" style={{ background: `linear-gradient(135deg, ${brand.primaryColor}, ${brand.secondaryColor})` }}>
            <p className="text-sm font-bold">Voyagez partout</p>
            <p className="text-xs opacity-80 mt-0.5">Réservez vos billets</p>
            <div className="mt-3 bg-white rounded-lg px-3 py-1.5 inline-block">
              <span className="text-xs font-semibold" style={{ color: brand.primaryColor }}>Rechercher un trajet</span>
            </div>
          </div>
          {/* Mini button preview */}
          <div className="px-4 py-3 flex gap-2">
            <div className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold" style={{ backgroundColor: brand.primaryColor }}>
              Réserver
            </div>
            <div className="px-3 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: brand.accentColor, color: brand.accentColor }}>
              En savoir plus
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-600 mt-3 text-center">
          {brand.metaTitle}
        </p>
      </div>
    </div>
  );
}

// ─── Page: Trajets ────────────────────────────────────────────────────────────

function PageTrajets() {
  const trips = [
    { id: 't1', ref: 'TRP-20260414-001', route: 'Dakar → Ziguinchor',  heure: '08:15', bus: 'DK 4321 EF', chauffeur: 'Ousmane Faye',     pax: 47, status: 'IN_TRANSIT' },
    { id: 't2', ref: 'TRP-20260414-002', route: 'Dakar → Saint-Louis', heure: '07:00', bus: 'DK 1234 AB', chauffeur: 'Mamadou Diallo',    pax: 38, status: 'COMPLETED' },
    { id: 't3', ref: 'TRP-20260414-003', route: 'Dakar → Tambacounda', heure: '09:00', bus: 'DK 7722 IJ', chauffeur: 'Abdoulaye Ndiaye',  pax: 0,  status: 'SCHEDULED' },
    { id: 't4', ref: 'TRP-20260414-004', route: 'Dakar → Diourbel',    heure: '09:15', bus: 'DB 5544 KL', chauffeur: 'Alassane Mbaye',    pax: 0,  status: 'SCHEDULED' },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <p className="text-sm font-semibold text-slate-300">Trajets — 14 avril 2026</p>
        <button className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-teal-700">
          + Planifier un trajet
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              {['Référence', 'Trajet', 'Heure', 'Bus', 'Chauffeur', 'Passagers', 'Statut'].map(h => (
                <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {trips.map(t => (
              <tr key={t.id} className="hover:bg-slate-800/30 transition-colors cursor-pointer">
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{t.ref}</td>
                <td className="px-5 py-3 text-white font-medium">{t.route}</td>
                <td className="px-5 py-3 text-slate-300 tabular-nums font-semibold">{t.heure}</td>
                <td className="px-5 py-3 font-mono text-slate-400 text-xs">{t.bus}</td>
                <td className="px-5 py-3 text-slate-300">{t.chauffeur}</td>
                <td className="px-5 py-3 text-slate-400 tabular-nums">{t.pax > 0 ? t.pax : '—'}</td>
                <td className="px-5 py-3"><StatusBadge status={t.status} size="sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page: Billetterie ────────────────────────────────────────────────────────

function PageBilletterie() {
  const tickets = [
    { id: 'TLP-A1B2C3', passager: 'Moussa Diallo',   route: 'Dakar → Ziguinchor',  prix: 8000,  mode: 'Wave',         status: 'CONFIRMED' },
    { id: 'TLP-D4E5F6', passager: 'Fatou Ba',         route: 'Dakar → Kaolack',     prix: 2800,  mode: 'Cash',         status: 'BOARDED' },
    { id: 'TLP-G7H8I9', passager: 'Ibrahima Seck',    route: 'Dakar → Saint-Louis', prix: 3500,  mode: 'Orange Money', status: 'CONFIRMED' },
    { id: 'TLP-J1K2L3', passager: 'Aissatou Diallo',  route: 'Dakar → Tambacounda', prix: 5500,  mode: 'Wave',         status: 'PENDING' },
    { id: 'TLP-M4N5O6', passager: 'Cheikh Touré',     route: 'Dakar → Ziguinchor',  prix: 8000,  mode: 'Cash',         status: 'CANCELLED' },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800">
        <p className="text-sm font-semibold text-slate-300">Billets du jour</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              {['Code', 'Passager', 'Trajet', 'Prix', 'Mode', 'Statut'].map(h => (
                <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {tickets.map(t => (
              <tr key={t.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="px-5 py-3 font-mono text-xs text-teal-400">{t.id}</td>
                <td className="px-5 py-3 text-white font-medium">{t.passager}</td>
                <td className="px-5 py-3 text-slate-300">{t.route}</td>
                <td className="px-5 py-3 text-slate-300 tabular-nums">{t.prix.toLocaleString('fr-SN')} F</td>
                <td className="px-5 py-3 text-slate-400 text-xs">{t.mode}</td>
                <td className="px-5 py-3"><StatusBadge status={t.status} size="sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Icônes SVG mini ─────────────────────────────────────────────────────────

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    dashboard:     'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    bus:           'M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM4 10h16M4 6h16M6 6v4m12-4v4M3 10l1 7h16l1-7',
    tickets:       'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z',
    chart:         'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    settings:      'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    route:         'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  };
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] || paths['dashboard']} />
    </svg>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function AdminDashboard() {
  const [page, setPage] = useState<AdminPage>('dashboard');

  const PAGE_TITLES: Record<AdminPage, string> = {
    dashboard:    'Tableau de bord',
    flotte:       'Gestion de la flotte',
    trajets:      'Trajets',
    billetterie:  'Billetterie',
    rentabilite:  'Rentabilité',
    parametres:   'Paramètres',
  };

  const navGroups = [
    {
      items: [
        { label: 'Tableau de bord', href: '#', icon: <Icon name="dashboard" />,  active: page === 'dashboard',   onClick: () => setPage('dashboard') },
      ],
    },
    {
      title: 'Opérations',
      items: [
        { label: 'Flotte',       href: '#', icon: <Icon name="bus" />,   active: page === 'flotte',      onClick: () => setPage('flotte') },
        { label: 'Trajets',      href: '#', icon: <Icon name="route" />, active: page === 'trajets',     onClick: () => setPage('trajets') },
        { label: 'Billetterie',  href: '#', icon: <Icon name="tickets" />, active: page === 'billetterie', onClick: () => setPage('billetterie') },
      ],
    },
    {
      title: 'Analytique',
      items: [
        { label: 'Rentabilité', href: '#', icon: <Icon name="chart" />,    active: page === 'rentabilite', onClick: () => setPage('rentabilite') },
      ],
    },
    {
      title: 'Configuration',
      items: [
        { label: 'Paramètres', href: '#', icon: <Icon name="settings" />, active: page === 'parametres',  onClick: () => setPage('parametres') },
      ],
    },
  ];

  // Wrap nav items to intercept clicks (SidebarLayout uses <a> tags)
  const navGroupsWithClick = navGroups.map(group => ({
    ...group,
    items: group.items.map(item => ({
      ...item,
      href: '#',
    })),
  }));

  const logo = (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 bg-teal-600 rounded-md flex items-center justify-center text-white font-black text-xs">T</div>
      <span className="font-bold text-white text-sm">TranslogPro</span>
    </div>
  );

  const userPanel = (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
        AD
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-200 truncate">Admin Dakar Dem Dikk</p>
        <p className="text-[10px] text-slate-500 truncate">admin@ddd.sn</p>
      </div>
    </div>
  );

  return (
    <div onClick={e => {
      // Capture nav link clicks
      const target = (e.target as HTMLElement).closest('a');
      if (target) {
        e.preventDefault();
        const label = target.querySelector('span.flex-1')?.textContent;
        const map: Record<string, AdminPage> = {
          'Tableau de bord': 'dashboard',
          'Flotte': 'flotte',
          'Trajets': 'trajets',
          'Billetterie': 'billetterie',
          'Rentabilité': 'rentabilite',
          'Paramètres': 'parametres',
        };
        if (label && map[label]) setPage(map[label]);
      }
    }}>
      <SidebarLayout
        logo={logo}
        navGroups={navGroupsWithClick}
        userPanel={userPanel}
      >
        {/* Page content */}
        <div className="p-6 space-y-6 min-h-screen bg-slate-950">
          {/* Page header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white">{PAGE_TITLES[page]}</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {new Date().toLocaleDateString('fr-SN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Page body */}
          {page === 'dashboard'   && <PageDashboard />}
          {page === 'flotte'      && <PageFlotte />}
          {page === 'trajets'     && <PageTrajets />}
          {page === 'billetterie' && <PageBilletterie />}
          {page === 'rentabilite' && <PageRentabilite />}
          {page === 'parametres'  && <PageParametres />}
        </div>
      </SidebarLayout>
    </div>
  );
}

export default AdminDashboard;
