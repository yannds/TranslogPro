/**
 * Icônes — set Lucide React Native unifié.
 *
 * Pourquoi un fichier central :
 *   - Cohérence visuelle stricte avec le web (`lucide-react`).
 *   - Un seul endroit où changer une icône (synonymes : map ici, pas dans
 *     chaque écran).
 *   - Treeshaking : on importe nommément, pas le pack entier.
 *
 * Convention : nommé d'après le rôle métier (TabIconHome) plutôt que la forme
 * (HouseIcon) — ça permet de remapper sans toucher aux usages.
 */

import {
  // Tabs principaux
  Home, LayoutDashboard, BarChart2, BarChart3, Activity, CalendarDays,
  Banknote, Wallet, Users, MoreHorizontal, Building2, Building,
  Shield, ShieldCheck, ScanLine, Package, ClipboardList, ClipboardCheck,
  Tag, Ticket, Headphones, Train, Route as RouteIcon,
  Bus, MessageCircle, User as UserIcon, UserCircle, Briefcase, Coffee,
  // Actions
  ArrowLeft, X, Search, RefreshCw, Plus, Check, ChevronRight, ChevronLeft,
  ChevronDown, ChevronUp, Edit2, Trash2, Eye, EyeOff,
  // Status / signals
  AlertTriangle, AlertCircle, CheckCircle2, Clock, MapPin, Phone, Mail,
  Bell, BellOff, Filter, Calendar, FileText, Camera, Pencil,
  // Specifiques
  TrendingUp, TrendingDown, Star, Award, Settings, LogOut, Power,
  PackageSearch, PackageCheck, PackageX, Truck, Send, ArrowRight,
  Lock, KeyRound, Smartphone, Globe, Languages, Info, HelpCircle,
} from 'lucide-react-native';

/* ─── Tabs des 6 profils ─────────────────────────────────────────────────── */

// Super-admin
export const TabIconPlatform = BarChart3;
export const TabIconTenants  = Building2;
export const TabIconSecurity = Shield;

// Admin tenant
export const TabIconBoard       = LayoutDashboard;
export const TabIconOperations  = Activity;
export const TabIconPlanning    = CalendarDays;
export const TabIconFinances    = Banknote;
export const TabIconTeams       = Users;

// Caissier
export const TabIconCash       = Wallet;
export const TabIconSell       = Tag;
export const TabIconTickets    = Ticket;

// Gare / Quai / Driver
export const TabIconStation    = Train;
export const TabIconService    = Headphones;
export const TabIconManifest   = ClipboardList;
export const TabIconDock       = Package;
export const TabIconScanner    = ScanLine;
export const TabIconTrips      = RouteIcon;
export const TabIconBriefing   = ClipboardCheck;
export const TabIconCabin      = Bus;

// Voyageur
export const TabIconHome      = Home;
export const TabIconMyDocs    = Briefcase;
export const TabIconSav       = MessageCircle;
export const TabIconProfile   = UserIcon;

// Misc tabs
export const TabIconMore = MoreHorizontal;

/* ─── Actions courantes ──────────────────────────────────────────────────── */

export const IconBack       = ArrowLeft;
export const IconClose      = X;
export const IconSearch     = Search;
export const IconRefresh    = RefreshCw;
export const IconAdd        = Plus;
export const IconCheck      = Check;
export const IconChevronR   = ChevronRight;
export const IconChevronL   = ChevronLeft;
export const IconChevronD   = ChevronDown;
export const IconChevronU   = ChevronUp;
export const IconEdit       = Edit2;
export const IconDelete     = Trash2;
export const IconEye        = Eye;
export const IconEyeOff     = EyeOff;
export const IconFilter     = Filter;
export const IconCamera     = Camera;
export const IconPencil     = Pencil;
export const IconSend       = Send;
export const IconArrowR     = ArrowRight;
export const IconSettings   = Settings;
export const IconLogout     = LogOut;
export const IconPower      = Power;
export const IconLock       = Lock;
export const IconKey        = KeyRound;
export const IconPhone      = Smartphone;
export const IconGlobe      = Globe;
export const IconLanguage   = Languages;

/* ─── Status / signals ──────────────────────────────────────────────────── */

export const IconWarn       = AlertTriangle;
export const IconAlert      = AlertCircle;
export const IconOk         = CheckCircle2;
export const IconClock      = Clock;
export const IconLocation   = MapPin;
export const IconPhoneCall  = Phone;
export const IconMail       = Mail;
export const IconBell       = Bell;
export const IconBellOff    = BellOff;
export const IconCalendar   = Calendar;
export const IconFile       = FileText;
export const IconInfo       = Info;
export const IconHelp       = HelpCircle;
export const IconTrendUp    = TrendingUp;
export const IconTrendDown  = TrendingDown;
export const IconStar       = Star;
export const IconAward      = Award;
export const IconTruck      = Truck;
export const IconParcelSearch = PackageSearch;
export const IconParcelOk     = PackageCheck;
export const IconParcelKo     = PackageX;
export const IconUserCircle   = UserCircle;
export const IconBuilding     = Building;
export const IconShieldOk     = ShieldCheck;
export const IconCoffee       = Coffee;

export type IconProps = {
  size?:   number;
  color?:  string;
  strokeWidth?: number;
};
