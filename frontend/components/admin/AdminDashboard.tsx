/**
 * AdminDashboard — Portail d'administration TranslogPro
 *
 * Navigation entièrement conditionnée par les permissions du user connecté.
 * Structure :
 *   SidebarLayout (navigation filtrée) → page active
 *
 * Pages disponibles selon profil :
 *   dashboard        → KPIs + graphiques (STATS_READ ou tout admin)
 *   trips            → Trajets du jour
 *   trips-planning   → Planning hebdomadaire
 *   routes           → Lignes & routes
 *   trips-delays     → Retards & alertes
 *   tickets-new      → Vendre un billet
 *   tickets-list     → Billets émis
 *   tickets-cancel   → Annulations
 *   manifests        → Manifestes
 *   parcels-list     → Suivi colis
 *   parcel-new       → Enregistrer colis
 *   shipments        → Expéditions groupées
 *   sav-claims       → Réclamations SAV
 *   cashier          → Caisse
 *   pricing-grid     → Grille tarifaire
 *   pricing-yield    → Yield Management
 *   invoices         → Facturation
 *   analytics        → Tableaux analytiques
 *   ai-routes        → Lignes rentables
 *   ai-fleet         → Optimisation flotte
 *   fleet-vehicles   → Véhicules
 *   fleet-seats      → Plans de sièges
 *   maintenance-list → Maintenance
 *   drivers          → Chauffeurs
 *   staff-list       → Personnel
 *   crm-clients      → CRM clients
 *   crm-campaigns    → Campagnes
 *   crm-feedback     → Feedbacks
 *   display-screens  → Écrans gare
 *   display-quais    → Gestion quais
 *   safety-incidents → Incidents
 *   workflow-studio  → Workflow Studio
 *   wf-blueprints    → Blueprints
 *   modules          → Modules & extensions
 *   white-label      → White-label & thème
 *   integrations     → Intégrations API
 *   documents-templates → Modèles de documents
 *   iam-users        → Utilisateurs
 *   iam-roles        → Rôles
 *   tenants          → Gestion tenants (SUPER_ADMIN)
 *   impersonation    → Impersonation JIT (SUPER_ADMIN)
 */

import { useState, useMemo } from 'react';
import {
  LayoutDashboard, Bell, MapPin, Ticket, Package, MessageSquareWarning,
  Landmark, Tags, Receipt, BarChart3, Brain, Bus, Wrench, Users, Users2,
  Megaphone, Star, MessageCircle, Monitor, ShieldAlert, GitFork, Puzzle,
  Palette, Link2, ShieldCheck, Building2, Terminal, TrendingUp, Activity,
  CalendarDays, Route, AlertTriangle, ScanLine, ClipboardList, Truck,
  Boxes, FileWarning, Flag, RotateCcw, Grid3x3, Percent, FileBarChart,
  Zap, LayoutGrid, Clock, MapPinned, Volume2, Radar, Siren, ScrollText,
  PlayCircle, Store, PenLine, User, Shield, BookOpen, KeyRound, UserCog,
  UserCheck, Bug, RefreshCw, Coffee, GraduationCap, ClipboardCheck,
  AlertOctagon, Gavel, FileText, type LucideIcon,
} from 'lucide-react';
import { cn }                    from '../../lib/utils';
import { useNavigation, ROLE_PERMISSIONS } from '../../lib/hooks/useNavigation';
import { ADMIN_NAV }             from '../../lib/navigation/nav.config';
import type { ResolvedNavItem } from '../../lib/navigation/nav.types';
import { PageFleetDocs }         from '../pages/PageFleetDocs';
import { PageDriverProfile }     from '../pages/PageDriverProfile';
import { PageCrewBriefing }      from '../pages/PageCrewBriefing';
import { PageQhse }              from '../pages/PageQhse';
import { PageWorkflowStudio }    from '../pages/PageWorkflowStudio';
import { PageProfitability }     from '../pages/PageProfitability';
import { PageBranding }          from '../pages/PageBranding';

// ─── Lucide icon resolver ─────────────────────────────────────────────────────

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Bell, MapPin, Ticket, Package, MessageSquareWarning,
  Landmark, Tags, Receipt, BarChart3, Brain, Bus, Wrench, Users, Users2,
  Megaphone, Star, MessageCircle, Monitor, ShieldAlert, GitFork, Puzzle,
  Palette, Link2, ShieldCheck, Building2, Terminal, TrendingUp, Activity,
  CalendarDays, Route, AlertTriangle, ScanLine, ClipboardList, Truck,
  Boxes, FileWarning, Flag, RotateCcw, Grid3x3, Percent, FileBarChart,
  Zap, LayoutGrid, Clock, MapPinned, Volume2, Radar, Siren, ScrollText,
  PlayCircle, Store, PenLine, User, Shield, BookOpen, KeyRound, UserCog,
  UserCheck, Bug, RefreshCw,
  // aliases
  Steer: Bus, CalendarRange: CalendarDays, CalendarClock: CalendarDays,
  FileType: ScrollText, List: ClipboardList, PackagePlus: Package,
  FileCheck: ClipboardList, FileWarningIcon: FileWarning,
  PlusCircle: TrendingUp, XCircle: AlertTriangle, Luggage: Package,
  // New fleet & safety aliases
  Coffee, GraduationCap, ClipboardCheck, AlertOctagon, Gavel, FileText,
  DriverRest: Coffee, DriverTraining: GraduationCap,
  AccidentReport: AlertOctagon, DisputeTracking: Gavel,
  CrewChecklist: ClipboardCheck,
};

function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? LayoutDashboard;
  return <Icon className={cn('w-4 h-4', className)} aria-hidden />;
}

// ─── Types locaux ──────────────────────────────────────────────────────────────

type RoleKey = keyof typeof ROLE_PERMISSIONS;

interface MockUser {
  name:        string;
  role:        RoleKey;
  agence:      string;
  avatar:      string;
}

// ─── Données de démo ──────────────────────────────────────────────────────────

const DEMO_USERS: MockUser[] = [
  { name: 'Evariste Moukala',     role: 'SUPER_ADMIN',    agence: 'Plateforme',               avatar: 'EM' },
  { name: 'Christelle Itoua',     role: 'TENANT_ADMIN',   agence: 'Congo Express — Direction', avatar: 'CI' },
  { name: 'Patrick Ngouabi',      role: 'AGENCY_MANAGER', agence: 'Congo Express — BZV',       avatar: 'PN' },
  { name: 'Aurore Batéké',        role: 'SUPERVISOR',     agence: 'Congo Express — BZV',       avatar: 'AB' },
  { name: 'Sylvère Makosso',      role: 'CASHIER',        agence: 'Congo Express — BZV',       avatar: 'SM' },
  { name: 'Nadège Nkounkou',      role: 'STATION_AGENT',  agence: 'Congo Express — PNR',       avatar: 'NN' },
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, delta, icon, accent = 'teal',
}: {
  label:   string;
  value:   string;
  sub?:    string;
  delta?:  { value: string; up: boolean };
  icon:    string;
  accent?: 'teal' | 'amber' | 'emerald' | 'purple' | 'red' | 'blue';
}) {
  const colors: Record<string, string> = {
    teal:    'bg-teal-500/10 text-teal-400',
    amber:   'bg-amber-500/10 text-amber-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    purple:  'bg-purple-500/10 text-purple-400',
    red:     'bg-red-500/10 text-red-400',
    blue:    'bg-blue-500/10 text-blue-400',
  };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', colors[accent])}>
          <NavIcon name={icon} className="w-5 h-5" />
        </div>
        {delta && (
          <span className={cn(
            'text-xs font-semibold px-2 py-0.5 rounded-full',
            delta.up ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/60 text-red-400',
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

// ─── Mini bar chart ───────────────────────────────────────────────────────────

function MiniBarChart({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const max = Math.max(...data.map(d => d.value));
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{label}</p>
      <div className="flex items-end gap-1.5 h-24">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full rounded-t-sm bg-teal-500/70 hover:bg-teal-400 transition-colors"
              style={{ height: `${(d.value / max) * 100}%` }}
              title={`${d.label}: ${d.value}`}
            />
            <span className="text-[9px] text-slate-600">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function PageDashboard() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Tableau de bord</h1>
        <p className="text-slate-400 text-sm mt-1">Aujourd'hui — Mardi 14 avril 2026</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Trajets du jour"         value="24"     sub="6 en cours"      delta={{ value: '8%', up: true }}  icon="MapPin"    accent="teal" />
        <KpiCard label="Billets vendus"           value="1 284"  sub="depuis 06:00"    delta={{ value: '12%', up: true }} icon="Ticket"    accent="emerald" />
        <KpiCard label="Recette brute"            value="6,8 M"  sub="FCFA aujourd'hui" delta={{ value: '3%', up: true }} icon="Landmark"  accent="amber" />
        <KpiCard label="Taux remplissage moyen"   value="78 %"   sub="sur 24 bus"      delta={{ value: '2%', up: false }} icon="BarChart3" accent="purple" />
      </div>

      {/* Second row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Colis enregistrés"  value="312"  sub="18 en retard"    icon="Package"   accent="blue" />
        <KpiCard label="Réclamations SAV"   value="7"    sub="3 critiques"     delta={{ value: '2', up: false }} icon="MessageSquareWarning" accent="red" />
        <KpiCard label="Bus en maintenance" value="3"    sub="1 urgent"        icon="Wrench"    accent="amber" />
        <KpiCard label="Agents connectés"   value="14"   sub="sur 18 prévus"   icon="Users"     accent="teal" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <MiniBarChart
            label="Ventes par heure"
            data={[
              { label: '6h', value: 42 }, { label: '7h', value: 87 }, { label: '8h', value: 134 },
              { label: '9h', value: 156 }, { label: '10h', value: 98 }, { label: '11h', value: 110 },
              { label: '12h', value: 76 }, { label: '13h', value: 88 }, { label: '14h', value: 145 },
            ]}
          />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Top lignes du jour</p>
          {[
            { route: 'BZV → PNR', pax: 312, pct: 92 },
            { route: 'BZV → DOL', pax: 198, pct: 74 },
            { route: 'PNR → BZV', pax: 287, pct: 88 },
            { route: 'BZV → NKY', pax: 156, pct: 65 },
          ].map((r, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300 font-medium">{r.route}</span>
                <span className="text-slate-500">{r.pax} pax</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5">
                <div className="bg-teal-500 h-1.5 rounded-full" style={{ width: `${r.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Activité récente</p>
        <div className="space-y-2">
          {[
            { time: '14:22', msg: 'Trajet BZV→PNR 14:00 — Embarquement terminé (48/50 pax)', type: 'ok' },
            { time: '14:18', msg: 'Retard 25 min signalé — BZV→DOL départ 14:15',            type: 'warn' },
            { time: '14:05', msg: 'Nouvelle réclamation SAV #1284 — Bagage manquant',          type: 'err' },
            { time: '13:58', msg: 'Caisse #3 ouverte par Sylvère Makosso',                    type: 'ok' },
            { time: '13:45', msg: 'Bus KA-4421-B affecté au garage — maintenance préventive',  type: 'warn' },
          ].map((e, i) => (
            <div key={i} className="flex items-start gap-3 text-sm">
              <span className="text-slate-600 tabular-nums shrink-0 pt-0.5">{e.time}</span>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full mt-1.5 shrink-0',
                e.type === 'ok' ? 'bg-emerald-500' : e.type === 'warn' ? 'bg-amber-500' : 'bg-red-500',
              )} />
              <span className="text-slate-300">{e.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PageTrips() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Trajets du jour</h1>
        <button className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <NavIcon name="MapPin" /> Nouveau trajet
        </button>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left p-4 text-slate-500 font-medium">Départ</th>
              <th className="text-left p-4 text-slate-500 font-medium">Destination</th>
              <th className="text-left p-4 text-slate-500 font-medium">Heure</th>
              <th className="text-left p-4 text-slate-500 font-medium">Quai</th>
              <th className="text-left p-4 text-slate-500 font-medium">Pax</th>
              <th className="text-left p-4 text-slate-500 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {[
              { from: 'Brazzaville', to: 'Pointe-Noire', time: '08:00', quai: 'A2', pax: '48/50', status: 'En route',     color: 'text-blue-400' },
              { from: 'Brazzaville', to: 'Dolisie',      time: '08:30', quai: 'B3', pax: '32/45', status: 'En route',     color: 'text-blue-400' },
              { from: 'Brazzaville', to: 'Nkayi',        time: '09:15', quai: 'C1', pax: '50/50', status: 'Embarquement', color: 'text-amber-400' },
              { from: 'Brazzaville', to: 'Pointe-Noire', time: '10:00', quai: 'A3', pax: '22/50', status: 'Prévu',        color: 'text-sky-400' },
              { from: 'Pointe-Noire','to': 'Brazzaville',time: '07:00', quai: 'D1', pax: '50/50', status: 'Arrivé',       color: 'text-teal-400' },
              { from: 'Brazzaville', to: 'Ouesso',       time: '06:00', quai: 'B1', pax: '38/42', status: 'Retard',       color: 'text-orange-400' },
            ].map((r, i) => (
              <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                <td className="p-4 text-slate-300">{r.from}</td>
                <td className="p-4 text-slate-100 font-medium">{r.to}</td>
                <td className="p-4 text-slate-400 tabular-nums">{r.time}</td>
                <td className="p-4 text-slate-400">{r.quai}</td>
                <td className="p-4 text-slate-400 tabular-nums">{r.pax}</td>
                <td className="p-4"><span className={cn('font-medium', r.color)}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PageAnalytics() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Tableaux analytiques</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <MiniBarChart
            label="Recette 7 derniers jours (FCFA ×1M)"
            data={[
              { label: 'Lun', value: 5.2 }, { label: 'Mar', value: 6.8 }, { label: 'Mer', value: 4.9 },
              { label: 'Jeu', value: 7.1 }, { label: 'Ven', value: 8.4 }, { label: 'Sam', value: 9.2 },
              { label: 'Dim', value: 6.7 },
            ]}
          />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <MiniBarChart
            label="Passagers par ligne (milliers)"
            data={[
              { label: 'BZV↔PNR', value: 42 }, { label: 'BZV↔DOL', value: 28 }, { label: 'BZV↔NKY', value: 18 },
              { label: 'PNR↔DOL', value: 14 }, { label: 'BZV↔OUE', value: 9 },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function PageAiRoutes() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Lignes rentables — Recommandations IA</h1>
      <div className="grid gap-4">
        {[
          { route: 'BZV → PNR', score: 94, marge: '+38%', freq: '8x/j', conseil: 'Augmenter la fréquence le vendredi soir. Envisager un bus premium.' },
          { route: 'BZV → DOL', score: 78, marge: '+22%', freq: '4x/j', conseil: 'Taux remplissage 82%. Ajouter 1 départ à 17h pour capter retour travail.' },
          { route: 'PNR → DOL', score: 71, marge: '+18%', freq: '2x/j', conseil: 'Faible concurrence. Potentiel d\'augmentation tarifaire de 10-15%.' },
          { route: 'BZV → NKY', score: 62, marge: '+12%', freq: '3x/j', conseil: 'Envisager bus de 30 places au lieu de 50. Économies carburant +8%.' },
          { route: 'BZV → OUE', score: 41, marge: '-4%',  freq: '1x/j', conseil: 'Ligne déficitaire. Recommandation : supprimer ou réduire à 3x/semaine.' },
        ].map((r, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-bold text-white text-lg">{r.route}</span>
                  <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',
                    r.marge.startsWith('+') ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/60 text-red-400'
                  )}>{r.marge} marge</span>
                  <span className="text-xs text-slate-500">{r.freq}</span>
                </div>
                <p className="text-slate-400 text-sm">{r.conseil}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className={cn('text-3xl font-black tabular-nums',
                  r.score >= 80 ? 'text-emerald-400' : r.score >= 60 ? 'text-amber-400' : 'text-red-400'
                )}>{r.score}</div>
                <div className="text-xs text-slate-600">score</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageFleet() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Flotte de véhicules</h1>
        <button className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <NavIcon name="Bus" /> Ajouter bus
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { id: 'KA-4421-B', model: 'Yutong ZK6122H', capacity: 50, status: 'En route',    km: '124 540', nextMaint: 'dans 2 200 km', color: 'text-blue-400' },
          { id: 'KA-2218-C', model: 'King Long XMQ',  capacity: 45, status: 'Disponible',  km: '89 320',  nextMaint: 'dans 8 100 km', color: 'text-emerald-400' },
          { id: 'KA-0033-A', model: 'Golden Dragon',  capacity: 42, status: 'Maintenance', km: '201 800', nextMaint: 'En cours',      color: 'text-red-400' },
          { id: 'KA-1876-D', model: 'Yutong ZK6852H', capacity: 35, status: 'Disponible',  km: '56 000',  nextMaint: 'dans 12 000 km', color: 'text-emerald-400' },
          { id: 'KA-5544-E', model: 'Higer KLQ6122',  capacity: 50, status: 'En route',    km: '148 000', nextMaint: 'dans 500 km',   color: 'text-amber-400' },
        ].map((v, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-bold text-white">{v.id}</p>
                <p className="text-xs text-slate-500 mt-0.5">{v.model}</p>
              </div>
              <span className={cn('text-xs font-semibold', v.color)}>{v.status}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-slate-600 text-xs">Capacité</p>
                <p className="text-slate-300">{v.capacity} sièges</p>
              </div>
              <div>
                <p className="text-slate-600 text-xs">Kilométrage</p>
                <p className="text-slate-300 tabular-nums">{v.km} km</p>
              </div>
              <div className="col-span-2">
                <p className="text-slate-600 text-xs">Prochaine maintenance</p>
                <p className={cn('text-sm font-medium',
                  v.nextMaint.includes('500') || v.nextMaint === 'En cours' ? 'text-red-400' : 'text-slate-300'
                )}>{v.nextMaint}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageCashier() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Caisse</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Caisse #2 — ouverture 08:00</p>
              <p className="text-3xl font-black text-white tabular-nums mt-1">1 248 500 <span className="text-sm font-normal text-slate-500">FCFA</span></p>
            </div>
            <button className="bg-red-900/40 hover:bg-red-800/60 text-red-400 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              Clôturer caisse
            </button>
          </div>
          <div className="border-t border-slate-800 pt-4 space-y-2">
            {[
              { time: '14:20', op: 'Vente billet BZV→PNR — M. Loemba',    montant: '+8 500', ok: true },
              { time: '14:18', op: 'Vente billet BZV→DOL — Mme Nzinga',   montant: '+5 200', ok: true },
              { time: '14:10', op: 'Remboursement #1281 — M. Tchibamba',   montant: '-8 500', ok: false },
              { time: '13:55', op: 'Colis enregistré — Expéditeur Bakala', montant: '+2 500', ok: true },
              { time: '13:45', op: 'Vente billet BZV→NKY — M. Kimbuta',   montant: '+4 000', ok: true },
            ].map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1">
                <div className="flex items-center gap-3">
                  <span className="text-slate-600 tabular-nums w-12 shrink-0">{t.time}</span>
                  <span className="text-slate-300">{t.op}</span>
                </div>
                <span className={cn('tabular-nums font-semibold shrink-0', t.ok ? 'text-emerald-400' : 'text-red-400')}>
                  {t.montant}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Résumé du jour</p>
            {[
              { label: 'Ventes billets',  value: '1 324 000', color: 'text-emerald-400' },
              { label: 'Ventes colis',    value: '87 500',    color: 'text-emerald-400' },
              { label: 'Remboursements',  value: '-163 000',  color: 'text-red-400' },
              { label: 'Net',             value: '1 248 500', color: 'text-white font-bold' },
            ].map((r, i) => (
              <div key={i} className="flex justify-between py-1.5 border-b border-slate-800 last:border-0 text-sm">
                <span className="text-slate-400">{r.label}</span>
                <span className={cn('tabular-nums', r.color)}>{r.value} FCFA</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PageCrm() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">CRM — Clients</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Clients actifs"     value="18 432" sub="ce mois"       icon="Users2"    accent="teal" />
        <KpiCard label="Nouveaux ce mois"   value="1 284"  sub="+12% vs N-1"   icon="TrendingUp" accent="emerald" />
        <KpiCard label="NPS Score"          value="72"     sub="cible : 75"    icon="Star"       accent="amber" />
        <KpiCard label="Réclamations"       value="48"     sub="7 non résolues" icon="MessageCircle" accent="red" />
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Clients récents</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left p-3 text-slate-500 font-medium">Nom</th>
              <th className="text-left p-3 text-slate-500 font-medium">Téléphone</th>
              <th className="text-left p-3 text-slate-500 font-medium">Trajets</th>
              <th className="text-left p-3 text-slate-500 font-medium">Fidélité</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: 'Alphonse Moubamba', tel: '+242 06 123 4567', trips: 24, points: 2400, tier: 'Gold' },
              { name: 'Berthe Louzolo',    tel: '+242 05 987 6543', trips: 8,  points: 800,  tier: 'Silver' },
              { name: 'Constant Nkounkou', tel: '+242 06 456 7890', trips: 42, points: 4200, tier: 'Platinum' },
              { name: 'Denise Batsimba',   tel: '+242 05 321 0987', trips: 3,  points: 300,  tier: 'Bronze' },
            ].map((c, i) => (
              <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                <td className="p-3 text-slate-100 font-medium">{c.name}</td>
                <td className="p-3 text-slate-400 tabular-nums">{c.tel}</td>
                <td className="p-3 text-slate-400 tabular-nums">{c.trips}</td>
                <td className="p-3">
                  <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',
                    c.tier === 'Platinum' ? 'bg-purple-900/60 text-purple-300' :
                    c.tier === 'Gold'     ? 'bg-amber-900/60 text-amber-300' :
                    c.tier === 'Silver'   ? 'bg-slate-700 text-slate-300' :
                                           'bg-amber-950/40 text-amber-700',
                  )}>{c.tier}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PageIam() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Utilisateurs & Rôles</h1>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left p-4 text-slate-500 font-medium">Nom</th>
              <th className="text-left p-4 text-slate-500 font-medium">Rôle</th>
              <th className="text-left p-4 text-slate-500 font-medium">Agence</th>
              <th className="text-left p-4 text-slate-500 font-medium">Statut</th>
              <th className="text-left p-4 text-slate-500 font-medium">Dernière connexion</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_USERS.map((u, i) => (
              <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                <td className="p-4 text-slate-100 font-medium">{u.name}</td>
                <td className="p-4">
                  <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">{u.role}</span>
                </td>
                <td className="p-4 text-slate-400">{u.agence}</td>
                <td className="p-4"><span className="text-xs text-emerald-400 font-semibold">Actif</span></td>
                <td className="p-4 text-slate-500 tabular-nums">14/04/2026 14:22</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PageSafety() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Sécurité & Incidents</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-red-950/30 border border-red-900/50 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-red-900/60 flex items-center justify-center">
              <NavIcon name="Siren" className="text-red-400" />
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Alerte active — RN1 km 145</p>
              <p className="text-xs text-red-400">Il y a 18 minutes</p>
            </div>
          </div>
          <p className="text-sm text-slate-300">Ralentissement important dû à des travaux. 3 bus TranslogPro actuellement sur ce tronçon. Délai estimé : +30 min.</p>
        </div>
        <div className="bg-amber-950/20 border border-amber-900/30 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-amber-900/40 flex items-center justify-center">
              <NavIcon name="AlertTriangle" className="text-amber-400" />
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Signalement — Bus KA-4421-B</p>
              <p className="text-xs text-amber-400">Il y a 1h 42min</p>
            </div>
          </div>
          <p className="text-sm text-slate-300">Chauffeur Mabou signale une vibration anormale. Bus redirigé vers Dolisie pour inspection technique.</p>
        </div>
      </div>
    </div>
  );
}

function PageDisplay() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Écrans & Afficheurs</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { name: 'Grand Hall — Tableaux Départs',  type: 'DepartureBoard',  status: 'En ligne',  last: '14:22:01' },
          { name: 'Quai A — Écran Bus',             type: 'BusScreen',       status: 'En ligne',  last: '14:22:18' },
          { name: 'Quai B — Écran Bus',             type: 'BusScreen',       status: 'En ligne',  last: '14:21:55' },
          { name: 'Quai C — Écran Quai',            type: 'QuaiScreen',      status: 'En ligne',  last: '14:22:10' },
          { name: 'Salle Attente — Infos',          type: 'InfoBoard',       status: 'Hors ligne', last: '10:15:44' },
          { name: 'Entrée — Kiosque',               type: 'Kiosk',           status: 'En ligne',  last: '14:21:58' },
        ].map((s, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-white text-sm">{s.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.type}</p>
              </div>
              <span className={cn('text-xs font-semibold', s.status === 'En ligne' ? 'text-emerald-400' : 'text-red-400')}>
                {s.status}
              </span>
            </div>
            <p className="text-xs text-slate-600">Dernière mise à jour : {s.last}</p>
            <button className="mt-3 w-full text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 py-1.5 rounded-lg transition-colors">
              Configurer
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageWip({ title }: { title: string }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
        <NavIcon name="Puzzle" className="w-8 h-8 text-slate-500" />
      </div>
      <h1 className="text-xl font-bold text-white">{title}</h1>
      <p className="text-slate-500 max-w-sm text-sm">Cette page est en cours de développement. Elle sera disponible dans le prochain sprint.</p>
      <span className="text-xs bg-amber-900/40 text-amber-400 px-3 py-1 rounded-full font-semibold">En développement</span>
    </div>
  );
}

// ─── Routeur local (SPA sans react-router) ────────────────────────────────────

function PageRouter({ activeId }: { activeId: string | null }) {
  switch (activeId) {
    case 'dashboard':          return <PageDashboard />;
    case 'trips':
    case 'trips-list':         return <PageTrips />;
    case 'trips-planning':     return <PageWip title="Planning hebdomadaire" />;
    case 'routes':             return <PageWip title="Lignes & Routes" />;
    case 'trips-delays':       return <PageWip title="Retards & Alertes" />;
    case 'tickets-new':        return <PageWip title="Vendre un billet" />;
    case 'tickets-list':       return <PageWip title="Billets émis" />;
    case 'tickets-cancel':     return <PageWip title="Annulations" />;
    case 'manifests':          return <PageWip title="Manifestes" />;
    case 'parcel-new':         return <PageWip title="Enregistrer un colis" />;
    case 'parcels-list':       return <PageWip title="Suivi colis" />;
    case 'shipments':          return <PageWip title="Expéditions groupées" />;
    case 'sav-claims':         return <PageWip title="Réclamations SAV" />;
    case 'sav-reports':        return <PageWip title="Signalements" />;
    case 'sav-returns':        return <PageWip title="Remboursements" />;
    case 'cashier':            return <PageCashier />;
    case 'pricing-grid':       return <PageWip title="Grille tarifaire" />;
    case 'pricing-yield':      return <PageProfitability />;
    case 'pricing-promo':      return <PageWip title="Promotions" />;
    case 'invoices':           return <PageWip title="Facturation" />;
    case 'analytics':          return <PageAnalytics />;
    case 'ai-routes':          return <PageAiRoutes />;
    case 'ai-fleet':           return <PageWip title="Optimisation flotte" />;
    case 'ai-demand':          return <PageWip title="Prévisions demande" />;
    case 'ai-pricing':         return <PageWip title="Tarifs dynamiques" />;
    case 'reports':            return <PageWip title="Rapports périodiques" />;
    case 'fleet-vehicles':     return <PageFleet />;
    case 'fleet-seats':        return <PageWip title="Plans de sièges" />;
    case 'maintenance-list':   return <PageWip title="Fiches de maintenance" />;
    case 'maintenance-planning': return <PageWip title="Planning garage" />;
    case 'maintenance-alerts': return <PageWip title="Alertes techniques" />;
    // Fleet docs & consumables
    case 'fleet-docs':         return <PageFleetDocs />;
    case 'fleet-docs-alerts':  return <PageFleetDocs />;
    // Drivers
    case 'drivers':            return <PageDriverProfile />;
    case 'driver-licenses':    return <PageDriverProfile />;
    case 'driver-rest':        return <PageDriverProfile />;
    case 'driver-trainings':   return <PageDriverProfile />;
    case 'driver-remediation': return <PageDriverProfile />;
    // Crew briefing
    case 'crew-briefing':      return <PageCrewBriefing />;
    case 'staff-list':         return <PageWip title="Personnel" />;
    case 'crew-planning':      return <PageWip title="Planning équipages" />;
    // QHSE
    case 'qhse-accidents':     return <PageQhse />;
    case 'qhse-disputes':      return <PageQhse />;
    case 'qhse-procedures':    return <PageQhse />;
    case 'crm-clients':        return <PageCrm />;
    case 'crm-campaigns':      return <PageWip title="Campagnes marketing" />;
    case 'crm-loyalty':        return <PageWip title="Programme fidélité" />;
    case 'crm-feedback':       return <PageWip title="Avis & Feedbacks" />;
    case 'display-screens':    return <PageDisplay />;
    case 'display-quais':      return <PageWip title="Gestion des quais" />;
    case 'display-announcements': return <PageWip title="Annonces gare" />;
    case 'safety-incidents':   return <PageSafety />;
    case 'safety-monitor':     return <PageWip title="Suivi temps réel" />;
    case 'safety-sos':         return <PageWip title="Alertes SOS" />;
    case 'workflow-studio':    return <PageWorkflowStudio />;
    case 'wf-blueprints':      return <PageWorkflowStudio />;
    case 'wf-marketplace':     return <PageWorkflowStudio />;
    case 'wf-simulate':        return <PageWorkflowStudio />;
    case 'modules':            return <PageWip title="Modules & Extensions" />;
    case 'white-label':        return <PageBranding />;
    case 'integrations':       return <PageWip title="Intégrations API" />;
    case 'documents-templates': return <PageWip title="Modèles de documents" />;
    case 'iam-users':          return <PageIam />;
    case 'iam-roles':          return <PageWip title="Rôles" />;
    case 'iam-audit':          return <PageWip title="Journal d'accès" />;
    case 'iam-sessions':       return <PageWip title="Sessions" />;
    case 'tenants':            return <PageWip title="Gestion des tenants" />;
    case 'platform-staff':     return <PageWip title="Staff plateforme" />;
    case 'impersonation':      return <PageWip title="Impersonation JIT" />;
    case 'debug-workflow':     return <PageWip title="Workflow debug" />;
    case 'debug-outbox':       return <PageWip title="Outbox replay" />;
    case 'notifications':      return <PageWip title="Notifications" />;
    default:                   return <PageDashboard />;
  }
}

// ─── Sidebar nav items renderer ──────────────────────────────────────────────

function SidebarNavItem({
  item, activeId, onSelect, depth: _depth = 0,
}: {
  item:     ResolvedNavItem;
  activeId: string | null;
  onSelect: (id: string) => void;
  depth?:   number;
}) {
  const [expanded, setExpanded] = useState(() => {
    if (!item.children) return false;
    return item.children.some(c => c.id === activeId);
  });
  const isActive = item.id === activeId || item.children?.some(c => c.id === activeId);

  if (item.children) {
    return (
      <li>
        <button
          onClick={() => setExpanded(e => !e)}
          className={cn(
            'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left',
            isActive ? 'bg-slate-700/60 text-slate-100' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
          )}
        >
          <NavIcon name={item.icon} />
          <span className="flex-1 truncate">{item.label}</span>
          <svg
            className={cn('w-3.5 h-3.5 shrink-0 transition-transform', expanded ? 'rotate-180' : '')}
            viewBox="0 0 20 20" fill="currentColor" aria-hidden
          >
            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </button>
        {expanded && (
          <ul className="mt-0.5 ml-3 pl-3 border-l border-slate-800 space-y-0.5">
            {item.children.map(child => (
              <li key={child.id}>
                <button
                  onClick={() => onSelect(child.id)}
                  disabled={child.wip}
                  className={cn(
                    'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors text-left',
                    child.id === activeId
                      ? 'bg-teal-900/40 text-teal-300 font-medium'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60',
                    child.wip && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <NavIcon name={child.icon} className="w-3.5 h-3.5" />
                  <span className="flex-1 truncate">{child.label}</span>
                  {child.wip && <span className="text-[9px] bg-amber-900/40 text-amber-500 px-1 rounded">WIP</span>}
                  {child.badge != null && (
                    <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {child.badge}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        onClick={() => onSelect(item.id)}
        disabled={item.wip}
        className={cn(
          'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left',
          item.id === activeId
            ? 'bg-teal-900/40 text-teal-300'
            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
          item.wip && 'opacity-40 cursor-not-allowed',
        )}
      >
        <NavIcon name={item.icon} />
        <span className="flex-1 truncate">{item.label}</span>
        {item.wip && <span className="text-[9px] bg-amber-900/40 text-amber-500 px-1 rounded">WIP</span>}
        {item.badge != null && (
          <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {item.badge}
          </span>
        )}
      </button>
    </li>
  );
}

// ─── AdminDashboard ───────────────────────────────────────────────────────────

export function AdminDashboard() {
  const [currentUserIdx, setCurrentUserIdx] = useState(0);
  const currentUser = DEMO_USERS[currentUserIdx]!;
  const permissions = ROLE_PERMISSIONS[currentUser.role] ?? [];

  const { sections, activeId, setActiveId: _setActiveId } = useNavigation({
    config:      ADMIN_NAV,
    permissions,
    currentHref: '/admin',
  });

  const [localActiveId, setLocalActiveId] = useState<string | null>('dashboard');

  const effectiveActiveId = localActiveId ?? activeId;

  const handleSelect = (id: string) => setLocalActiveId(id);

  // Build custom sidebar content from resolved sections
  const sidebarContent = useMemo(() => (
    <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4" aria-label="Navigation principale">
      {sections.map(section => (
        <div key={section.id}>
          {section.title && (
            <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {section.title}
            </div>
          )}
          <ul role="list" className="space-y-0.5">
            {section.items.map(item => (
              <SidebarNavItem
                key={item.id}
                item={item}
                activeId={effectiveActiveId}
                onSelect={handleSelect}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  ), [sections, effectiveActiveId]);

  const logo = (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white font-black text-sm">T</div>
      <span className="font-bold text-white text-sm tracking-wide">TranslogPro</span>
    </div>
  );

  const userPanel = (
    <div className="space-y-3">
      {/* Role switcher (démo uniquement) */}
      <div>
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1">Démo — profil</p>
        <select
          value={currentUserIdx}
          onChange={e => { setCurrentUserIdx(Number(e.target.value)); setLocalActiveId('dashboard'); }}
          className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          {DEMO_USERS.map((u, i) => (
            <option key={i} value={i}>{u.role}</option>
          ))}
        </select>
      </div>
      {/* User info */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
          {currentUser.avatar}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200 truncate">{currentUser.name}</p>
          <p className="text-[10px] text-slate-500 truncate">{currentUser.agence}</p>
        </div>
      </div>
      <div className="text-[10px] text-slate-600 tabular-nums">
        {sections.reduce((acc, s) => acc + s.items.reduce((a, i) => a + 1 + (i.children?.length ?? 0), 0), 0)} items visibles
        {' '}· {permissions.length} permissions
      </div>
    </div>
  );

  // Custom sidebar bypassing SidebarLayout's internal nav rendering
  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Sidebar desktop */}
      <aside
        aria-label="Navigation principale"
        className="hidden lg:flex flex-col w-64 shrink-0 bg-slate-900 border-r border-slate-800"
      >
        <div className="flex h-14 items-center px-4 border-b border-slate-800 shrink-0">
          {logo}
        </div>
        {sidebarContent}
        <div className="shrink-0 border-t border-slate-800 p-3">
          {userPanel}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-slate-950" role="main">
        <PageRouter activeId={effectiveActiveId} />
      </main>
    </div>
  );
}
