/**
 * NavIcon — Résolution d'icônes Lucide par nom string
 *
 * Usage :
 *   <NavIcon name="LayoutDashboard" />
 *   <NavIcon name="Bus" className="text-teal-400 w-5 h-5" />
 *
 * Fallback : LayoutDashboard si le nom est inconnu.
 */
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
import { cn } from '../../lib/utils';

// ─── Registre des icônes ──────────────────────────────────────────────────────

export const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Bell, MapPin, Ticket, Package, MessageSquareWarning,
  Landmark, Tags, Receipt, BarChart3, Brain, Bus, Wrench, Users, Users2,
  Megaphone, Star, MessageCircle, Monitor, ShieldAlert, GitFork, Puzzle,
  Palette, Link2, ShieldCheck, Building2, Terminal, TrendingUp, Activity,
  CalendarDays, Route, AlertTriangle, ScanLine, ClipboardList, Truck,
  Boxes, FileWarning, Flag, RotateCcw, Grid3x3, Percent, FileBarChart,
  Zap, LayoutGrid, Clock, MapPinned, Volume2, Radar, Siren, ScrollText,
  PlayCircle, Store, PenLine, User, Shield, BookOpen, KeyRound, UserCog,
  UserCheck, Bug, RefreshCw,
  // Aliases métier
  Steer: Bus, CalendarRange: CalendarDays, CalendarClock: CalendarDays,
  FileType: ScrollText, List: ClipboardList, PackagePlus: Package,
  FileCheck: ClipboardList, FileWarningIcon: FileWarning,
  PlusCircle: TrendingUp, XCircle: AlertTriangle, Luggage: Package,
  // Fleet & safety
  Coffee, GraduationCap, ClipboardCheck, AlertOctagon, Gavel, FileText,
  DriverRest: Coffee, DriverTraining: GraduationCap,
  AccidentReport: AlertOctagon, DisputeTracking: Gavel,
  CrewChecklist: ClipboardCheck,
};

// ─── Composant ────────────────────────────────────────────────────────────────

export interface NavIconProps {
  /** Nom de l'icône dans le registre ICONS */
  name:       string;
  className?: string;
}

export function NavIcon({ name, className }: NavIconProps) {
  const Icon = ICONS[name] ?? LayoutDashboard;
  return <Icon className={cn('w-4 h-4', className)} aria-hidden />;
}
