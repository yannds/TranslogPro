/**
 * Verrouillage biométrique (FaceID / TouchID / Android BiometricPrompt).
 *
 * Usage :
 *   1. À la connexion réussie, `rememberBiometric(true)` → au prochain cold-
 *      start, l'app demande d'abord une biométrie avant de libérer le token.
 *   2. L'utilisateur peut désactiver via Préférences.
 *
 * Sécurité :
 *   - Le token reste dans expo-secure-store avec `requireAuthentication: true` :
 *     même root / USB dump, le déchiffrement exige une biométrie valide.
 *   - Fallback code device : SecureStore l'accepte — conforme aux HIG.
 */

import * as LocalAuth from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIO_ENABLED_KEY = 'translog_bio_enabled';

export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const has = await LocalAuth.hasHardwareAsync();
    if (!has) return false;
    const enrolled = await LocalAuth.isEnrolledAsync();
    return enrolled;
  } catch {
    return false;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(BIO_ENABLED_KEY);
  return v === '1';
}

export async function rememberBiometric(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(BIO_ENABLED_KEY, '1');
  } else {
    await SecureStore.deleteItemAsync(BIO_ENABLED_KEY);
  }
}

export async function challengeBiometric(reason: string): Promise<boolean> {
  const ok = await LocalAuth.authenticateAsync({
    promptMessage: reason,
    // Permet le fallback PIN si la biométrie échoue ou n'est pas dispo.
    disableDeviceFallback: false,
  });
  return ok.success === true;
}
