export const STORAGE_SERVICE = 'IStorageService';

export enum DocumentType {
  PARCEL_LABEL    = 'PARCEL_LABEL',
  TICKET_PDF      = 'TICKET_PDF',
  INCIDENT_PHOTO  = 'INCIDENT_PHOTO',
  ID_PHOTO_SAV    = 'ID_PHOTO_SAV',     // Donnée biométrique — TTL 15min MAX
  MAINTENANCE_DOC = 'MAINTENANCE_DOC',
  CHECKLIST_DOC   = 'CHECKLIST_DOC',
  SIGNATURE       = 'SIGNATURE',
  MANIFEST_HTML   = 'MANIFEST_HTML',    // Manifeste de bord (HTML certifié backend)
  INVOICE_HTML    = 'INVOICE_HTML',     // Facture (HTML certifié — conservation légale)
  TEMPLATE_SOURCE = 'TEMPLATE_SOURCE',  // Fichier source template (.hbs) — persistant
  EXCEL_EXPORT    = 'EXCEL_EXPORT',     // Export Excel généré côté serveur
  WORD_EXPORT     = 'WORD_EXPORT',      // Export Word généré côté serveur
  BUS_PHOTO       = 'BUS_PHOTO',        // Photo véhicule (intérieur/extérieur, Portail Voyageur)
}

export const SIGNED_URL_TTL_SECONDS: Record<DocumentType, number> = {
  [DocumentType.PARCEL_LABEL]:    86400,            // 24h
  [DocumentType.TICKET_PDF]:      7200,             // 2h
  [DocumentType.INCIDENT_PHOTO]:  3600,             // 1h
  [DocumentType.ID_PHOTO_SAV]:    900,              // 15min — biométrique
  [DocumentType.MAINTENANCE_DOC]: 14400,            // 4h
  [DocumentType.CHECKLIST_DOC]:   1800,             // 30min
  [DocumentType.SIGNATURE]:       86400 * 365 * 7,  // 7 ans (légal)
  [DocumentType.MANIFEST_HTML]:   28800,            // 8h (journée de travail)
  [DocumentType.INVOICE_HTML]:    86400,            // 24h (régénérable à la demande)
  [DocumentType.TEMPLATE_SOURCE]: 86400 * 365,      // 1 an (source persistante)
  [DocumentType.EXCEL_EXPORT]:    3600,             // 1h
  [DocumentType.WORD_EXPORT]:     3600,             // 1h
  [DocumentType.BUS_PHOTO]:       86400,            // 24h (affichage Portail Voyageur)
};

export interface IStorageService {
  /** Génère une URL présignée pour upload (client-side upload) */
  getUploadUrl(tenantId: string, key: string, type: DocumentType): Promise<SignedUrl>;

  /** Génère une URL présignée pour téléchargement */
  getDownloadUrl(tenantId: string, key: string, type: DocumentType): Promise<SignedUrl>;

  /** Upload direct d'un buffer depuis le backend (ex: PDF Puppeteer) */
  putObject(tenantId: string, key: string, buffer: Buffer, contentType: string): Promise<void>;

  /** Télécharge un objet et retourne le buffer (ex: source template .hbs) */
  getObject(tenantId: string, key: string): Promise<Buffer>;

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
