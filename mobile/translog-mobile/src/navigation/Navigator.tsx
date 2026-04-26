import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  createBottomTabNavigator,
  type BottomTabNavigationOptions,
} from '@react-navigation/bottom-tabs';
import { type ComponentType } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { LoginScreen } from '../screens/LoginScreen';
import { CashierHomeScreen } from '../cashier/CashierHomeScreen';
import { SellTicketScreen } from '../cashier/SellTicketScreen';
import { CashierTicketsScreen } from '../cashier/CashierTicketsScreen';
import { CashierMyStatsScreen } from '../cashier/CashierMyStatsScreen';
import { IncidentReportScreen } from '../incidents/IncidentReportScreen';
import { DriverHomeScreen } from '../driver/DriverHomeScreen';
import { TripDetailScreen } from '../driver/TripDetailScreen';
import { BriefingScreen } from '../driver/BriefingScreen';
import { CheckinScreen } from '../driver/CheckinScreen';
import { BoardingScanScreen } from '../driver/BoardingScanScreen';
import { ParcelScanScreen } from '../driver/ParcelScanScreen';
import { EndReportScreen } from '../driver/EndReportScreen';
import { DriverDocumentsScreen } from '../driver/DriverDocumentsScreen';
import { DriverRestScreen } from '../driver/DriverRestScreen';
import { StationHomeScreen } from '../station/StationHomeScreen';
import { StationSellTicketScreen } from '../station/StationSellTicketScreen';
import { StationLuggageScreen } from '../station/StationLuggageScreen';
import { StationBoardScreen } from '../station/StationBoardScreen';
import { StationCustomerLookupScreen } from '../station/StationCustomerLookupScreen';
import { QuaiHomeScreen } from '../quai/QuaiHomeScreen';
import { QuaiBulkScanScreen } from '../quai/QuaiBulkScanScreen';
import { QuaiManifestScreen } from '../quai/QuaiManifestScreen';
import { QuaiParcelActionsScreen } from '../quai/QuaiParcelActionsScreen';
import { AdminHomeScreen } from '../admin/AdminHomeScreen';
import { AdminChartsScreen } from '../admin/AdminChartsScreen';
import { AdminSavScreen } from '../admin/AdminSavScreen';
import { AdminTeamsScreen } from '../admin/AdminTeamsScreen';
import { AdminTripsScreen } from '../admin/AdminTripsScreen';
import { AdminIncidentsScreen } from '../admin/AdminIncidentsScreen';
import { AdminLiveScreen } from '../admin/AdminLiveScreen';
import { AdminFleetScreen } from '../admin/AdminFleetScreen';
import { AdminPlanningScreen } from '../admin/AdminPlanningScreen';
import { AdminFinancesScreen } from '../admin/AdminFinancesScreen';
import { CustomerHomeScreen } from '../customer/CustomerHomeScreen';
import { CustomerBookingScreen } from '../customer/CustomerBookingScreen';
import { CustomerMyItemsScreen } from '../customer/CustomerMyItemsScreen';
import { CustomerSavScreen } from '../customer/CustomerSavScreen';
import { CustomerProfileScreen } from '../customer/CustomerProfileScreen';
import { CustomerVouchersScreen } from '../customer/CustomerVouchersScreen';
import { PlatformDashboardScreen } from '../platform/PlatformDashboardScreen';
import { PlatformTenantsScreen } from '../platform/PlatformTenantsScreen';
import { PlatformSecurityScreen } from '../platform/PlatformSecurityScreen';
import { PlatformMoreScreen } from '../platform/PlatformMoreScreen';
import { ChangePasswordScreen } from '../auth/ChangePasswordScreen';
import { portalForUser } from './portalForUser';
import {
  type IconProps,
  TabIconBoard, TabIconOperations, TabIconTeams, TabIconMore,
  TabIconCash, TabIconSell, TabIconTickets,
  TabIconStation, TabIconManifest,
  TabIconDock,
  TabIconTrips,
  TabIconHome,
  TabIconPlatform, TabIconTenants, TabIconSecurity,
  IconWarn,
} from '../ui/icons';

const RootStack    = createNativeStackNavigator();
const DriverStack  = createNativeStackNavigator();
const StationStack = createNativeStackNavigator();
const QuaiStack    = createNativeStackNavigator();
const AdminStack     = createNativeStackNavigator();
const CustomerStack  = createNativeStackNavigator();
const PlatformStack  = createNativeStackNavigator();
const CashierStack   = createNativeStackNavigator();
const Tab            = createBottomTabNavigator();

/* ── Helpers tab bar ───────────────────────────────────────────────────── */

function makeTabIcon(Icon: ComponentType<IconProps>) {
  return ({ color, size }: { color: string; size: number }) => (
    <Icon size={size} color={color} strokeWidth={2} />
  );
}

/** Options globales bottom-tab — couleurs theme-aware, hauteur cohérente. */
function useTabScreenOptions(): BottomTabNavigationOptions {
  const { colors } = useTheme();
  return {
    headerShown:           false,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.textMuted,
    tabBarStyle: {
      backgroundColor: colors.surface,
      borderTopColor:  colors.border,
      borderTopWidth:  StyleSheet_hairline(),
      height:          60,
      paddingBottom:   8,
      paddingTop:      6,
    },
    tabBarLabelStyle: {
      fontSize:   11,
      fontWeight: '600',
      marginTop:  2,
    },
  };
}

// Helper local pour éviter d'importer StyleSheet juste pour hairlineWidth.
function StyleSheet_hairline(): number {
  // Approx 1 / pixelRatio — 0.5 sur la plupart des devices, suffisant pour
  // un séparateur subtil cohérent avec iOS/Android natif.
  return 0.5;
}

/* ── DRIVER ─────────────────────────────────────────────────────────────── */

function DriverBottomTabs() {
  const opts = useTabScreenOptions();
  return (
    <Tab.Navigator screenOptions={opts}>
      <Tab.Screen
        name="Trajets"
        component={DriverHomeScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconTrips) }}
      />
      <Tab.Screen
        name="Manifest"
        component={QuaiManifestScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconManifest) }}
      />
      <Tab.Screen
        name="Incident"
        component={IncidentReportScreen}
        options={{ tabBarIcon: makeTabIcon(IconWarn) }}
      />
    </Tab.Navigator>
  );
}

function DriverNav() {
  return (
    <DriverStack.Navigator screenOptions={{ headerShown: false }}>
      <DriverStack.Screen name="DriverHome"          component={DriverBottomTabs} />
      <DriverStack.Screen name="DriverTripDetail"    component={TripDetailScreen} />
      <DriverStack.Screen name="DriverBriefing"      component={BriefingScreen} />
      <DriverStack.Screen name="DriverCheckin"       component={CheckinScreen} />
      <DriverStack.Screen name="DriverBoardingScan"  component={BoardingScanScreen} />
      <DriverStack.Screen name="DriverBulkScan"      component={QuaiBulkScanScreen} initialParams={{ defaultIntent: 'board' }} />
      <DriverStack.Screen name="DriverParcelScan"    component={ParcelScanScreen} />
      <DriverStack.Screen name="DriverEndReport"     component={EndReportScreen} />
      <DriverStack.Screen name="DriverDocuments"     component={DriverDocumentsScreen} />
      <DriverStack.Screen name="DriverRest"          component={DriverRestScreen} />
      <DriverStack.Screen name="ChangePassword"      component={ChangePasswordScreen} />
    </DriverStack.Navigator>
  );
}

/* ── CASHIER ────────────────────────────────────────────────────────────── */

function CashierTabs() {
  const opts = useTabScreenOptions();
  return (
    <Tab.Navigator screenOptions={opts}>
      <Tab.Screen
        name="Caisse"
        component={CashierHomeScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconCash) }}
      />
      <Tab.Screen
        name="Vente"
        component={SellTicketScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconSell) }}
      />
      <Tab.Screen
        name="Billets"
        component={CashierTicketsScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconTickets) }}
      />
      <Tab.Screen
        name="Incident"
        component={IncidentReportScreen}
        options={{ tabBarIcon: makeTabIcon(IconWarn) }}
      />
    </Tab.Navigator>
  );
}

function CashierNav() {
  return (
    <CashierStack.Navigator screenOptions={{ headerShown: false }}>
      <CashierStack.Screen name="CashierHome"   component={CashierTabs} />
      <CashierStack.Screen name="CashierMyStats" component={CashierMyStatsScreen} />
      <CashierStack.Screen name="ChangePassword" component={ChangePasswordScreen} />
    </CashierStack.Navigator>
  );
}

/* ── CUSTOMER ───────────────────────────────────────────────────────────── */

function CustomerBottomTabs() {
  const opts = useTabScreenOptions();
  return (
    <Tab.Navigator screenOptions={opts}>
      <Tab.Screen
        name="Accueil"
        component={CustomerHomeScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconHome) }}
      />
      <Tab.Screen
        name="Signalement"
        component={IncidentReportScreen}
        options={{ tabBarIcon: makeTabIcon(IconWarn) }}
      />
    </Tab.Navigator>
  );
}

function CustomerNav() {
  return (
    <CustomerStack.Navigator screenOptions={{ headerShown: false }}>
      <CustomerStack.Screen name="CustomerHome"     component={CustomerBottomTabs} />
      <CustomerStack.Screen name="CustomerBooking"  component={CustomerBookingScreen} />
      <CustomerStack.Screen name="CustomerMyItems"  component={CustomerMyItemsScreen} />
      <CustomerStack.Screen name="CustomerSav"      component={CustomerSavScreen} />
      <CustomerStack.Screen name="CustomerProfile"  component={CustomerProfileScreen} />
      <CustomerStack.Screen name="CustomerVouchers" component={CustomerVouchersScreen} />
      <CustomerStack.Screen name="ChangePassword"   component={ChangePasswordScreen} />
    </CustomerStack.Navigator>
  );
}

/* ── STATION ────────────────────────────────────────────────────────────── */

function StationBottomTabs() {
  const opts = useTabScreenOptions();
  return (
    <Tab.Navigator screenOptions={opts}>
      <Tab.Screen
        name="Gare"
        component={StationHomeScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconStation) }}
      />
      <Tab.Screen
        name="Manifest"
        component={QuaiManifestScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconManifest) }}
      />
      <Tab.Screen
        name="Incident"
        component={IncidentReportScreen}
        options={{ tabBarIcon: makeTabIcon(IconWarn) }}
      />
    </Tab.Navigator>
  );
}

function StationNav() {
  return (
    <StationStack.Navigator screenOptions={{ headerShown: false }}>
      <StationStack.Screen name="StationHome"           component={StationBottomTabs} />
      <StationStack.Screen name="StationSellTicket"     component={StationSellTicketScreen} />
      <StationStack.Screen name="StationLuggage"        component={StationLuggageScreen} />
      <StationStack.Screen name="StationBoard"          component={StationBoardScreen} />
      <StationStack.Screen name="StationCustomerLookup" component={StationCustomerLookupScreen} />
      <StationStack.Screen name="ChangePassword"        component={ChangePasswordScreen} />
    </StationStack.Navigator>
  );
}

/* ── QUAI ───────────────────────────────────────────────────────────────── */

function QuaiBottomTabs() {
  const opts = useTabScreenOptions();
  return (
    <Tab.Navigator screenOptions={opts}>
      <Tab.Screen
        name="Quai"
        component={QuaiHomeScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconDock) }}
      />
      <Tab.Screen
        name="Manifest"
        component={QuaiManifestScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconManifest) }}
      />
      <Tab.Screen
        name="Incident"
        component={IncidentReportScreen}
        options={{ tabBarIcon: makeTabIcon(IconWarn) }}
      />
    </Tab.Navigator>
  );
}

function QuaiNav() {
  return (
    <QuaiStack.Navigator screenOptions={{ headerShown: false }}>
      <QuaiStack.Screen name="QuaiHome"          component={QuaiBottomTabs} />
      <QuaiStack.Screen name="QuaiBulkScan"      component={QuaiBulkScanScreen} />
      <QuaiStack.Screen name="QuaiManifest"      component={QuaiManifestScreen} />
      <QuaiStack.Screen name="QuaiParcelActions" component={QuaiParcelActionsScreen} />
      <QuaiStack.Screen name="ChangePassword"    component={ChangePasswordScreen} />
    </QuaiStack.Navigator>
  );
}

/* ── ADMIN TENANT ───────────────────────────────────────────────────────── */

function AdminBottomTabs() {
  const opts = useTabScreenOptions();
  return (
    <Tab.Navigator screenOptions={opts}>
      <Tab.Screen
        name="Bord"
        component={AdminHomeScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconBoard) }}
      />
      <Tab.Screen
        name="Trajets"
        component={AdminTripsScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconOperations) }}
      />
      <Tab.Screen
        name="Incidents"
        component={AdminIncidentsScreen}
        options={{ tabBarIcon: makeTabIcon(IconWarn) }}
      />
      <Tab.Screen
        name="Équipes"
        component={AdminTeamsScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconTeams) }}
      />
    </Tab.Navigator>
  );
}

function AdminNav() {
  // Note : Trajets, Incidents, Équipes sont des tabs dans AdminBottomTabs.
  // On ne les répète PAS comme stack screens pour éviter les ambiguïtés
  // de navigation (navigate('Trajets') depuis Bord change de tab proprement).
  // Charts et SAV restent en stack — accessibles via le drawer header (L5).
  return (
    <AdminStack.Navigator screenOptions={{ headerShown: false }}>
      <AdminStack.Screen name="AdminHome"     component={AdminBottomTabs} />
      <AdminStack.Screen name="AdminCharts"   component={AdminChartsScreen} />
      <AdminStack.Screen name="AdminSav"      component={AdminSavScreen} />
      <AdminStack.Screen name="AdminLive"     component={AdminLiveScreen} />
      <AdminStack.Screen name="AdminFleet"    component={AdminFleetScreen} />
      <AdminStack.Screen name="AdminPlanning" component={AdminPlanningScreen} />
      <AdminStack.Screen name="AdminFinances" component={AdminFinancesScreen} />
      <AdminStack.Screen name="ChangePassword" component={ChangePasswordScreen} />
    </AdminStack.Navigator>
  );
}

/* ── PLATFORM (SUPER-ADMIN) ─────────────────────────────────────────────── */

function PlatformBottomTabs() {
  const opts = useTabScreenOptions();
  return (
    <Tab.Navigator screenOptions={opts}>
      <Tab.Screen
        name="Plateforme"
        component={PlatformDashboardScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconPlatform) }}
      />
      <Tab.Screen
        name="Tenants"
        component={PlatformTenantsScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconTenants) }}
      />
      <Tab.Screen
        name="Sécurité"
        component={PlatformSecurityScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconSecurity) }}
      />
      <Tab.Screen
        name="Plus"
        component={PlatformMoreScreen}
        options={{ tabBarIcon: makeTabIcon(TabIconMore) }}
      />
    </Tab.Navigator>
  );
}

function PlatformNav() {
  return (
    <PlatformStack.Navigator screenOptions={{ headerShown: false }}>
      <PlatformStack.Screen name="PlatformHome"     component={PlatformBottomTabs} />
      <PlatformStack.Screen name="ChangePassword"   component={ChangePasswordScreen} />
    </PlatformStack.Navigator>
  );
}

/* ── ROOT NAVIGATOR ─────────────────────────────────────────────────────── */

export function AppNavigator() {
  const { user, loading } = useAuth();
  if (loading) return null;

  return (
    <NavigationContainer>
      {!user ? (
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="Login" component={LoginScreen} />
        </RootStack.Navigator>
      ) : (
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          {(() => {
            const portal = portalForUser(user);
            switch (portal) {
              case 'platform': return <RootStack.Screen name="Platform" component={PlatformNav} />;
              case 'cashier':  return <RootStack.Screen name="Cashier"  component={CashierNav} />;
              case 'driver':   return <RootStack.Screen name="Driver"   component={DriverNav} />;
              case 'station':  return <RootStack.Screen name="Station"  component={StationNav} />;
              case 'quai':     return <RootStack.Screen name="Quai"     component={QuaiNav} />;
              case 'admin':    return <RootStack.Screen name="Admin"    component={AdminNav} />;
              case 'customer': return <RootStack.Screen name="Customer" component={CustomerNav} />;
            }
          })()}
        </RootStack.Navigator>
      )}
    </NavigationContainer>
  );
}
