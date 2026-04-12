export const STORAGE_SERVICE = 'IStorageService';

export enum DocumentType {
  PARCEL_LABEL    = 'PARCEL_LABEL',
  TICKET_PDF      = 'TICKET_PDF',
  INCIDENT_PHOTO  = 'INCIDENT_PHOTO',
  ID_PHOTO_SAV    = 'ID_PHOTO_SAV',   // Donnée biométrique — TTL 15min MAX
  MAINTENANCE_DOC = 'MAINTENANCE_DOC',
  CHECKLIST_DOC   = 'CHECKLIST_DOC',
  SIGNATURE       = 'SIGNATURE',
}

export const SIGNED_URL_TTL_SECONDS: Record<DocumentType, number> = {
  [DocumentType.PARCEL_LABEL]:    86400,  // 24h
  [DocumentType.TICKET_PDF]:      7200,   // 2h
  [DocumentType.INCIDENT_PHOTO]:  3600,   // 1h
  [DocumentType.ID_PHOTO_SAV]:    900,    // 15min — biométrique
  [DocumentType.MAINTENANCE_DOC]: 14400,  // 4h
  [DocumentType.CHECKLIST_DOC]:   1800,   // 30min
  [DocumentType.SIGNATURE]:       86400 * 365 * 7, // 7 ans (légal)
};

export interface IStorageService {
  /** Génère une URL présignée pour upload */
  getUploadUrl(tenantId: string, key: string, type: DocumentType): Promise<SignedUrl>;

  /** Génère une URL présignée pour téléchargement */
  getDownloadUrl(tenantId: string, key: string, type: DocumentType): Promise<SignedUrl>;

  /** Supprime un objet */
  deleteObject(tenantId: string, key: string): Promise<void>;

  /** Vérifie que l'objet appartient au bucket tenant */
  assertObjectBelongsToTenant(tenantId: string, key: string): boolean;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
  key: string;
}
