export const SECRET_SERVICE = 'ISecretService';

export interface ISecretService {
  /** Récupère une valeur depuis Vault KV v2 */
  getSecret(path: string, key: string): Promise<string>;

  /** Récupère un objet entier depuis Vault KV v2 */
  getSecretObject<T = Record<string, string>>(path: string): Promise<T>;

  /** Écrit/met à jour un secret dans Vault KV v2 */
  putSecret(path: string, data: Record<string, string>): Promise<void>;

  /** Génère un certificat TLS via le PKI Engine de Vault */
  issueCertificate(commonName: string, ttl?: string): Promise<VaultCertificate>;

  /** Supprime un secret (toutes versions) dans Vault KV v2 */
  deleteSecret(path: string): Promise<void>;

  /** Vérifie que la connexion à Vault est active */
  healthCheck(): Promise<boolean>;
}

export interface VaultCertificate {
  certificate: string;
  privateKey: string;
  issuingCa: string;
  serialNumber: string;
  expiresAt: Date;
}
