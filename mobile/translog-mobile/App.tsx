import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { I18nProvider } from './src/i18n/useI18n';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { AppNavigator } from './src/navigation/Navigator';
import { startSyncLoop } from './src/offline/outbox';
import { getDb } from './src/offline/db';
import { installGlobalErrorCapture } from './src/telemetry/telemetry';

export default function App() {
  useEffect(() => {
    // Init : SQLite offline + sync loop + capture globale erreurs.
    void getDb();
    const stop = startSyncLoop();
    installGlobalErrorCapture();
    return stop;
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <StatusBar style="auto" />
              <AppNavigator />
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
