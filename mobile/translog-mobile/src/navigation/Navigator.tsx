import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../auth/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { CashierHomeScreen } from '../cashier/CashierHomeScreen';
import { SellTicketScreen } from '../cashier/SellTicketScreen';
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
import { CustomerHomeScreen } from '../customer/CustomerHomeScreen';
import { CustomerBookingScreen } from '../customer/CustomerBookingScreen';
import { CustomerMyItemsScreen } from '../customer/CustomerMyItemsScreen';
import { CustomerSavScreen } from '../customer/CustomerSavScreen';
import { CustomerProfileScreen } from '../customer/CustomerProfileScreen';
import { portalForUser } from './portalForUser';

const RootStack    = createNativeStackNavigator();
const DriverStack  = createNativeStackNavigator();
const StationStack = createNativeStackNavigator();
const QuaiStack    = createNativeStackNavigator();
const AdminStack     = createNativeStackNavigator();
const CustomerStack  = createNativeStackNavigator();
const Tab            = createBottomTabNavigator();

function DriverBottomTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Trajets"  component={DriverHomeScreen} />
      {/* Manifest : on réutilise QuaiManifestScreen (sélection trip + génération
          + signature géo-stampée). Permission backend : MANIFEST_GENERATE/SIGN
          déjà accordées au DRIVER ; le composant est trip-driven, pas
          rôle-spécifique. Évite duplication d'UI. */}
      <Tab.Screen name="Manifest" component={QuaiManifestScreen} />
      <Tab.Screen name="Incident" component={IncidentReportScreen} />
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
      {/* Scan rafale chauffeur — même écran que l'agent quai (QuaiBulkScan)
          mais avec defaultIntent='board'. Le toggle check-in/board reste
          accessible selon capabilities. */}
      <DriverStack.Screen name="DriverBulkScan"      component={QuaiBulkScanScreen} initialParams={{ defaultIntent: 'board' }} />
      <DriverStack.Screen name="DriverParcelScan"    component={ParcelScanScreen} />
      <DriverStack.Screen name="DriverEndReport"     component={EndReportScreen} />
      <DriverStack.Screen name="DriverDocuments"     component={DriverDocumentsScreen} />
      <DriverStack.Screen name="DriverRest"          component={DriverRestScreen} />
    </DriverStack.Navigator>
  );
}

function CashierTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Caisse"   component={CashierHomeScreen} />
      <Tab.Screen name="Vente"    component={SellTicketScreen} />
      <Tab.Screen name="Incident" component={IncidentReportScreen} />
    </Tab.Navigator>
  );
}

function CustomerBottomTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Accueil"     component={CustomerHomeScreen} />
      <Tab.Screen name="Signalement" component={IncidentReportScreen} />
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
    </CustomerStack.Navigator>
  );
}

function StationBottomTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Gare"     component={StationHomeScreen} />
      {/* Manifest : agent gare doit aussi générer + signer (manifest_generate
          + manifest_sign accordées par défaut au STATION_AGENT). Même composant
          que Quai/Driver — trip-driven, perm-gated server-side. */}
      <Tab.Screen name="Manifest" component={QuaiManifestScreen} />
      <Tab.Screen name="Incident" component={IncidentReportScreen} />
    </Tab.Navigator>
  );
}

function StationNav() {
  return (
    <StationStack.Navigator screenOptions={{ headerShown: false }}>
      <StationStack.Screen name="StationHome"       component={StationBottomTabs} />
      <StationStack.Screen name="StationSellTicket" component={StationSellTicketScreen} />
      <StationStack.Screen name="StationLuggage"    component={StationLuggageScreen} />
      <StationStack.Screen name="StationBoard"      component={StationBoardScreen} />
    </StationStack.Navigator>
  );
}

function QuaiBottomTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Quai"     component={QuaiHomeScreen} />
      {/* Manifest : on utilise QuaiManifestScreen (sélection trip + vue live
          passagers/colis + signature), pas le legacy ManifestSignScreen qui
          n'affiche rien d'autre qu'un champ texte + pad. */}
      <Tab.Screen name="Manifest" component={QuaiManifestScreen} />
      <Tab.Screen name="Incident" component={IncidentReportScreen} />
    </Tab.Navigator>
  );
}

function QuaiNav() {
  return (
    <QuaiStack.Navigator screenOptions={{ headerShown: false }}>
      <QuaiStack.Screen name="QuaiHome"          component={QuaiBottomTabs} />
      <QuaiStack.Screen name="QuaiBulkScan"      component={QuaiBulkScanScreen} />
      <QuaiStack.Screen name="QuaiManifest"     component={QuaiManifestScreen} />
      <QuaiStack.Screen name="QuaiParcelActions" component={QuaiParcelActionsScreen} />
    </QuaiStack.Navigator>
  );
}

function AdminBottomTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Admin"    component={AdminHomeScreen} />
      <Tab.Screen name="Incident" component={IncidentReportScreen} />
    </Tab.Navigator>
  );
}

function AdminNav() {
  return (
    <AdminStack.Navigator screenOptions={{ headerShown: false }}>
      <AdminStack.Screen name="AdminHome"      component={AdminBottomTabs} />
      <AdminStack.Screen name="AdminCharts"    component={AdminChartsScreen} />
      <AdminStack.Screen name="AdminSav"       component={AdminSavScreen} />
      <AdminStack.Screen name="AdminTeams"     component={AdminTeamsScreen} />
      <AdminStack.Screen name="AdminTrips"     component={AdminTripsScreen} />
      <AdminStack.Screen name="AdminIncidents" component={AdminIncidentsScreen} />
    </AdminStack.Navigator>
  );
}

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
              case 'cashier':  return <RootStack.Screen name="Cashier"  component={CashierTabs} />;
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
