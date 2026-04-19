/**
 * Stockage sécurisé du token (Keychain iOS / Keystore Android via expo-secure-store).
 * Utilisé par apiFetch et AuthContext.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'translog_auth_token';

export async function getAuthToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(KEY); } catch { return null; }
}

export async function setAuthToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
}

export async function clearAuthToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
