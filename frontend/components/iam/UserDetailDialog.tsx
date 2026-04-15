/**
 * UserDetailDialog — Modale "Voir utilisateur" avec 3 onglets
 *
 *   · Informations — identité, rôle, agence, dates
 *   · Sécurité     — sessions actives (révocable), MFA (scaffold)
 *   · Historique   — 50 dernières tentatives de connexion (succès + échec)
 *
 * Endpoints consommés :
 *   GET    /api/v1/tenants/:tid/iam/users/:uid
 *   GET    /api/v1/tenants/:tid/iam/users/:uid/sessions
 *   GET    /api/v1/tenants/:tid/iam/users/:uid/login-history
 *   POST   /api/v1/tenants/:tid/iam/users/:uid/revoke-sessions
 *
 * MFA : les endpoints existent (POST /api/v1/mfa/*) mais la vérification à la
 * connexion n'est pas encore branchée — d'où le bloc "Bientôt disponible".
 */
import { useEffect, useState } from 'react';
import {
  Monitor, LogOut, KeyRound, ShieldCheck, ShieldOff,
  Calendar, CheckCircle2, XCircle,
} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { apiGet, apiPost } from '../../lib/api';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/Tabs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserDetail {
  id:            string;
  email:         string;
  name:          string | null;
  userType:      string;
  roleId:        string | null;
  agencyId:      string | null;
  createdAt:     string;
  updatedAt:     string;
  mfaEnabled:    boolean;
  mfaVerifiedAt: string | null;
  lastLoginAt:   string | null;
  role?:   { id: string; name: string } | null;
  agency?: { id: string; name: string } | null;
}

interface SessionItem {
  id:         string;
  ipAddress:  string | null;
  userAgent:  string | null;
  createdAt:  string;
  expiresAt:  string;
}

interface LoginHistoryItem {
  id:         string;
  at:         string;
  success:    boolean;
  ipAddress:  string | null;
  userAgent:  string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null, email: string): string {
  const src = (name ?? email).trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  }) + ' à ' + new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit',
  });
}

/** Détection basique du navigateur/OS depuis le User-Agent — assez bon pour l'affichage. */
function parseUA(ua: string | null): { browser: string; os: string } {
  if (!ua) return { browser: '—', os: '—' };
  const browser =
    /edg\//i.test(ua)      ? 'Edge'
    : /chrome\//i.test(ua) ? 'Chrome'
    : /firefox\//i.test(ua)? 'Firefox'
    : /safari\//i.test(ua) ? 'Safari'
    : 'Autre';
  const os =
    /windows/i.test(ua)    ? 'Windows'
    : /mac os x/i.test(ua) ? 'macOS'
    : /android/i.test(ua)  ? 'Android'
    : /iphone|ipad/i.test(ua) ? 'iOS'
    : /linux/i.test(ua)    ? 'Linux'
    : '—';
  return { browser, os };
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function UserDetailDialog({
  tenantId, userId, open, onClose,
}: {
  tenantId: string;
  userId:   string | null;
  open:     boolean;
  onClose:  () => void;
}) {
  const [user,     setUser]     = useState<UserDetail | null>(null);
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [history,  setHistory]  = useState<LoginHistoryItem[] | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [tab,      setTab]      = useState('info');

  const base = `/api/v1/tenants/${tenantId}/iam/users/${userId}`;

  // (Re)chargement à l'ouverture
  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setLoading(true); setErr(null);
    setTab('info');
    Promise.all([
      apiGet<UserDetail>(base),
      apiGet<SessionItem[]>(`${base}/sessions`),
      apiGet<LoginHistoryItem[]>(`${base}/login-history`),
    ])
      .then(([u, s, h]) => {
        if (cancelled) return;
        setUser(u); setSessions(s); setHistory(h);
      })
      .catch(e => { if (!cancelled) setErr((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, userId, base]);

  const handleRevokeAll = async () => {
    if (!userId) return;
    if (!confirm('Révoquer toutes les sessions actives de cet utilisateur ?')) return;
    setRevoking(true);
    try {
      await apiPost(`${base}/revoke-sessions`);
      const fresh = await apiGet<SessionItem[]>(`${base}/sessions`);
      setSessions(fresh);
    } catch (e) { setErr((e as Error).message); }
    finally { setRevoking(false); }
  };

  if (!open) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm
            data-[state=open]:animate-in data-[state=closed]:animate-out
            data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0`}
        />
        <DialogPrimitive.Content
          className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2
            rounded-xl bg-white dark:bg-slate-900 shadow-2xl
            border border-slate-200 dark:border-slate-800
            focus:outline-none w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto
            data-[state=open]:animate-in data-[state=closed]:animate-out
            data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0
            data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95`}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="text-emerald-500">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/>
              </svg>
              <DialogPrimitive.Title className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Détails de l&apos;utilisateur
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Description className="sr-only">
              Informations détaillées, sessions et historique de connexion
            </DialogPrimitive.Description>
            <DialogPrimitive.Close
              className="shrink-0 rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 transition-colors"
              aria-label="Fermer"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M12 4 4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            {loading && <p className="text-sm text-slate-500">Chargement…</p>}
            {err && (
              <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
                {err}
              </div>
            )}
            {!loading && user && (
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="info">Informations</TabsTrigger>
                  <TabsTrigger value="sec">Sécurité</TabsTrigger>
                  <TabsTrigger value="hist">Historique</TabsTrigger>
                </TabsList>

                {/* ─── Onglet Informations ───────────────────────────────── */}
                <TabsContent value="info">
                  {/* Carte identité */}
                  <div className="flex items-center gap-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pink-500 text-white font-semibold">
                      {initials(user.name, user.email)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-slate-900 dark:text-white truncate">
                        {user.name ?? '—'}
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                      {user.role && (
                        <div className="mt-1"><Badge variant="success">{user.role.name}</Badge></div>
                      )}
                    </div>
                  </div>

                  {/* Grille infos */}
                  <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                    <Field label="Nom complet"  value={user.name ?? '—'} />
                    <Field label="Email"        value={user.email} />
                    <Field label="Entité"       value={user.agency?.name ?? '—'} />
                    <Field label="Rôle"         value={user.role?.name ?? '—'} />
                    <Field label="Type"         value={user.userType} />
                    <Field label="Statut"       value={<Badge variant="success">Actif</Badge>} />
                    <Field
                      label="Date d'enregistrement"
                      icon={<Calendar size={14} className="text-slate-400" />}
                      value={formatDate(user.createdAt)}
                    />
                    <Field
                      label="Dernière connexion"
                      icon={<Calendar size={14} className="text-slate-400" />}
                      value={formatDate(user.lastLoginAt)}
                    />
                  </dl>
                </TabsContent>

                {/* ─── Onglet Sécurité ───────────────────────────────────── */}
                <TabsContent value="sec">
                  {/* Sessions actives */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Monitor size={16} className="text-slate-500" />
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Sessions actives
                      </h3>
                    </div>
                    {sessions && sessions.length > 0 && (
                      <Button
                        variant="outline"
                        onClick={handleRevokeAll}
                        disabled={revoking}
                        className="text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <LogOut size={14} className="mr-1.5" />
                        {revoking ? 'Révocation…' : 'Tout déconnecter'}
                      </Button>
                    )}
                  </div>

                  {sessions && sessions.length === 0 && (
                    <div className="mt-4 py-10 text-center">
                      <Monitor size={32} className="mx-auto text-slate-300" />
                      <p className="mt-2 text-sm font-medium text-slate-500">Aucune session active</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Toutes les sessions ont expiré ou l&apos;utilisateur n&apos;est pas connecté
                      </p>
                    </div>
                  )}

                  {sessions && sessions.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {sessions.map(s => {
                        const ua = parseUA(s.userAgent);
                        return (
                          <li key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                            <div className="min-w-0 text-xs">
                              <p className="font-medium text-slate-700 dark:text-slate-200">
                                {ua.browser} · {ua.os}
                              </p>
                              <p className="text-slate-500">
                                {s.ipAddress ?? '—'} · depuis le {formatDateTime(s.createdAt)}
                              </p>
                            </div>
                            <Badge variant="success">Active</Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* MFA */}
                  <div className="mt-8 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {user.mfaEnabled
                          ? <ShieldCheck size={16} className="text-emerald-500" />
                          : <ShieldOff   size={16} className="text-slate-400" />}
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                          Authentification multi-facteurs (MFA)
                        </h3>
                      </div>
                      <Badge variant={user.mfaEnabled ? 'success' : 'default'}>
                        {user.mfaEnabled ? 'Activé' : 'Non activé'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {user.mfaEnabled
                        ? `Activé le ${formatDateTime(user.mfaVerifiedAt)}`
                        : 'Configuration disponible prochainement dans le menu "Mon compte" de l\'utilisateur.'}
                    </p>
                  </div>

                  {/* Reset mot de passe (placeholder — à brancher quand endpoint prêt) */}
                  <div className="mt-4">
                    <Button variant="outline" disabled>
                      <KeyRound size={14} className="mr-1.5" />
                      Réinitialiser le mot de passe
                    </Button>
                  </div>
                </TabsContent>

                {/* ─── Onglet Historique ─────────────────────────────────── */}
                <TabsContent value="hist">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
                    Historique des connexions
                  </h3>
                  {history && history.length === 0 && (
                    <p className="text-sm text-slate-500 py-6 text-center">Aucune connexion enregistrée.</p>
                  )}
                  {history && history.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <th className="py-2 pr-3 font-medium">Date & heure</th>
                            <th className="py-2 pr-3 font-medium">IP</th>
                            <th className="py-2 pr-3 font-medium">Navigateur</th>
                            <th className="py-2 pr-3 font-medium">Système</th>
                            <th className="py-2 pr-3 font-medium">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map(h => {
                            const ua = parseUA(h.userAgent);
                            return (
                              <tr key={h.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                <td className="py-2 pr-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                  {formatDateTime(h.at)}
                                </td>
                                <td className="py-2 pr-3 text-slate-500 font-mono">{h.ipAddress ?? '—'}</td>
                                <td className="py-2 pr-3 text-slate-500">{ua.browser}</td>
                                <td className="py-2 pr-3 text-slate-500">{ua.os}</td>
                                <td className="py-2 pr-3">
                                  {h.success
                                    ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} />Succès</span>
                                    : <span className="inline-flex items-center gap-1 text-red-600"><XCircle size={12} />Échec</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ─── Petit helper d'affichage ────────────────────────────────────────────────

function Field({ label, value, icon }: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        {icon}{label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}
