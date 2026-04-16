/**
 * Dictionnaire complet — 8 langues
 *
 * fr  : Français
 * en  : English
 * ln  : Lingala  (Congo-Brazzaville / RDC)
 * ktu : Kituba   (Congo-Brazzaville)
 * es  : Español
 * pt  : Português
 * ar  : العربية  (RTL)
 * wo  : Wolof    (Sénégal / Gambie)
 *
 * NOTE : Les noms de villes restent dans leur graphie officielle locale
 * (ex. Brazzaville, Pointe-Noire) mais leur prononciation / affichage
 * peut être enrichi par le config du tenant.
 */

import type { TranslogTranslations } from './types';

export const TRANSLATIONS: TranslogTranslations = {

  // ── Navigation / Mode ──────────────────────────────────────────────────────
  board: {
    departures: {
      fr: 'Départs',      en: 'Departures',  ln: 'Bakei',        ktu: 'Bakei',
      es: 'Salidas',      pt: 'Partidas',    ar: 'المغادرة',     wo: 'Dem yi',
    },
    arrivals: {
      fr: 'Arrivées',     en: 'Arrivals',    ln: 'Bakomi',       ktu: 'Bakwisa',
      es: 'Llegadas',     pt: 'Chegadas',    ar: 'الوصول',       wo: 'Dellu yi',
    },
    mode_toggle: {
      fr: 'Basculer',     en: 'Switch',      ln: 'Kobongola',    ktu: 'Kobongola',
      es: 'Cambiar',      pt: 'Alternar',    ar: 'تبديل',        wo: 'Soppal',
    },
  },

  // ── Colonnes tableau ───────────────────────────────────────────────────────
  col: {
    time: {
      fr: 'Heure',        en: 'Time',        ln: 'Ntango',       ktu: 'Ntangu',
      es: 'Hora',         pt: 'Hora',        ar: 'الوقت',        wo: 'Waxtaan',
    },
    destination: {
      fr: 'Destination',  en: 'Destination', ln: 'Esika ya kokɛnda', ktu: 'Esika',
      es: 'Destino',      pt: 'Destino',     ar: 'الوجهة',       wo: 'Bopp',
    },
    origin: {
      fr: 'Provenance',   en: 'Origin',      ln: 'Esika ya kobima',  ktu: 'Esika ya kobima',
      es: 'Origen',       pt: 'Origem',      ar: 'المصدر',       wo: 'Dëkk bi',
    },
    bus: {
      fr: 'Bus',          en: 'Bus',         ln: 'Otobisi',      ktu: 'Otobisi',
      es: 'Bus',          pt: 'Ônibus',      ar: 'حافلة',        wo: 'Kar bi',
    },
    agency: {
      fr: 'Agence',       en: 'Agency',      ln: 'Eteyelo',      ktu: 'Kompani',
      es: 'Agencia',      pt: 'Agência',     ar: 'وكالة',        wo: 'Agence bi',
    },
    platform: {
      fr: 'Quai',         en: 'Platform',    ln: 'Libanda',      ktu: 'Libanda',
      es: 'Andén',        pt: 'Plataforma',  ar: 'الرصيف',       wo: 'Kër bi',
    },
    status: {
      fr: 'Statut',       en: 'Status',      ln: 'Bokɛi',        ktu: 'Makambu',
      es: 'Estado',       pt: 'Estado',      ar: 'الحالة',       wo: 'Xam-xam',
    },
    remarks: {
      fr: 'Remarque',     en: 'Remarks',     ln: 'Maloba',       ktu: 'Maloba',
      es: 'Observación',  pt: 'Observação',  ar: 'ملاحظة',       wo: 'Xam',
    },
    driver: {
      fr: 'Chauffeur',    en: 'Driver',      ln: 'Molaki-motuka', ktu: 'Molaki-motuka',
      es: 'Conductor',    pt: 'Motorista',   ar: 'السائق',       wo: 'Jëf-jëf',
    },
    passengers: {
      fr: 'Passagers',    en: 'Passengers',  ln: 'Bakɛi',        ktu: 'Batu',
      es: 'Pasajeros',    pt: 'Passageiros', ar: 'الركاب',       wo: 'Dem ak dem yi',
    },
    parcels: {
      fr: 'Colis',        en: 'Parcels',     ln: 'Mipako',       ktu: 'Mipako',
      es: 'Paquetes',     pt: 'Encomendas',  ar: 'الطرود',       wo: 'Sos yi',
    },
    eta: {
      fr: 'Arrivée prév.', en: 'Est. Arrival', ln: 'Kokɔma ntango', ktu: 'Ntangu ya kokwisa',
      es: 'Llegada est.',  pt: 'Chegada est.', ar: 'الوصول المتوقع', wo: 'Dellu ci',
    },
    delay: {
      fr: 'Retard',       en: 'Delay',       ln: 'Elɔkɔ',        ktu: 'Elɔkɔ',
      es: 'Retraso',      pt: 'Atraso',      ar: 'تأخير',        wo: 'Rëdd',
    },
    distance: {
      fr: 'Distance',     en: 'Distance',    ln: 'Ndelo',        ktu: 'Ndelo',
      es: 'Distancia',    pt: 'Distância',   ar: 'المسافة',      wo: 'Dëkk',
    },
    stop: {
      fr: 'Arrêt',        en: 'Stop',        ln: 'Esimama',      ktu: 'Esimama',
      es: 'Parada',       pt: 'Parada',      ar: 'توقف',         wo: 'Tànn',
    },
  },

  // ── Statuts ────────────────────────────────────────────────────────────────
  status: {
    SCHEDULED: {
      fr: 'Prévu',        en: 'Scheduled',   ln: 'Elakisami',    ktu: 'Elakisi',
      es: 'Programado',   pt: 'Programado',  ar: 'مجدول',        wo: 'Yëgël',
    },
    BOARDING: {
      fr: 'Embarquement', en: 'Boarding',    ln: 'Kolɛkɛ',       ktu: 'Kokela',
      es: 'Embarcando',   pt: 'Embarcando',  ar: 'صعود',         wo: 'Yëngël',
    },
    BOARDING_COMPLETE: {
      fr: 'Terminé',      en: 'Complete',    ln: 'Esilemba',     ktu: 'Esilisa',
      es: 'Completo',     pt: 'Completo',    ar: 'اكتمل',        wo: 'Sàqu',
    },
    DEPARTED: {
      fr: 'Parti',        en: 'Departed',    ln: 'Akei',         ktu: 'Akei',
      es: 'Partido',      pt: 'Partiu',      ar: 'غادر',         wo: 'Dem',
    },
    DELAYED: {
      fr: 'Retard',       en: 'Delayed',     ln: 'Elɔkɔ',        ktu: 'Elɔkɔ',
      es: 'Retrasado',    pt: 'Atrasado',    ar: 'متأخر',        wo: 'Rëdd',
    },
    CANCELLED: {
      fr: 'Annulé',       en: 'Cancelled',   ln: 'Etiki',        ktu: 'Etiki',
      es: 'Cancelado',    pt: 'Cancelado',   ar: 'ملغى',         wo: 'Yokk',
    },
    ON_TIME: {
      fr: 'À l\'heure',   en: 'On Time',     ln: 'Na ntango',    ktu: 'Na ntangu',
      es: 'A tiempo',     pt: 'No horário',  ar: 'في الموعد',    wo: 'Ci waxtaan',
    },
    ARRIVED: {
      fr: 'Arrivé',       en: 'Arrived',     ln: 'Akokɔma',      ktu: 'Akwisa',
      es: 'Llegado',      pt: 'Chegou',      ar: 'وصل',          wo: 'Dellu',
    },
    IN_TRANSIT: {
      fr: 'En route',     en: 'In Transit',  ln: 'Na nzela',     ktu: 'Na nzela',
      es: 'En tránsito',  pt: 'Em trânsito', ar: 'في الطريق',    wo: 'Ci yoon bi',
    },
    MAINTENANCE: {
      fr: 'Maintenance',  en: 'Maintenance', ln: 'Kosala malamu', ktu: 'Kosala malamu',
      es: 'Mantenimiento', pt: 'Manutenção', ar: 'صيانة',        wo: 'Dëkkat',
    },
  },

  // ── Actions communes ────────────────────────────────────────────────────────
  common: {
    save:        { fr: 'Enregistrer',   en: 'Save',        ln: 'Kobomba',      ktu: 'Kobomba',      es: 'Guardar',     pt: 'Salvar',       ar: 'حفظ',          wo: 'Denc' },
    create:      { fr: 'Créer',         en: 'Create',      ln: 'Kokela',       ktu: 'Kokela',       es: 'Crear',       pt: 'Criar',        ar: 'إنشاء',        wo: 'Sos' },
    edit:        { fr: 'Modifier',      en: 'Edit',        ln: 'Kobongola',    ktu: 'Kobongola',    es: 'Editar',      pt: 'Editar',       ar: 'تعديل',        wo: 'Soppal' },
    delete:      { fr: 'Supprimer',     en: 'Delete',      ln: 'Kolongola',    ktu: 'Kolongola',    es: 'Eliminar',    pt: 'Excluir',      ar: 'حذف',          wo: 'Far' },
    cancel:      { fr: 'Annuler',       en: 'Cancel',      ln: 'Kotika',       ktu: 'Kotika',       es: 'Cancelar',    pt: 'Cancelar',     ar: 'إلغاء',        wo: 'Yokk' },
    close:       { fr: 'Fermer',        en: 'Close',       ln: 'Kokanga',      ktu: 'Kokanga',      es: 'Cerrar',      pt: 'Fechar',       ar: 'إغلاق',        wo: 'Tëj' },
    add:         { fr: 'Ajouter',       en: 'Add',         ln: 'Kobakisa',     ktu: 'Kobakisa',     es: 'Añadir',      pt: 'Adicionar',    ar: 'إضافة',        wo: 'Yokk' },
    remove:      { fr: 'Retirer',       en: 'Remove',      ln: 'Kolongola',    ktu: 'Kolongola',    es: 'Quitar',      pt: 'Remover',      ar: 'إزالة',        wo: 'Genn' },
    archive:     { fr: 'Archiver',      en: 'Archive',     ln: 'Kobomba',      ktu: 'Kobomba',      es: 'Archivar',    pt: 'Arquivar',     ar: 'أرشفة',        wo: 'Denc' },
    suspend:     { fr: 'Suspendre',     en: 'Suspend',     ln: 'Kosimisa',     ktu: 'Kosimisa',     es: 'Suspender',   pt: 'Suspender',    ar: 'تعليق',        wo: 'Taxaw' },
    reactivate:  { fr: 'Réactiver',     en: 'Reactivate',  ln: 'Kolamusa',     ktu: 'Kolamusa',     es: 'Reactivar',   pt: 'Reativar',     ar: 'إعادة تفعيل',  wo: 'Soppi' },
    export:      { fr: 'Exporter',      en: 'Export',       ln: 'Kobimisa',     ktu: 'Kobimisa',     es: 'Exportar',    pt: 'Exportar',     ar: 'تصدير',        wo: 'Yóbbu' },
    filter:      { fr: 'Filtrer',       en: 'Filter',      ln: 'Kopona',       ktu: 'Kopona',       es: 'Filtrar',     pt: 'Filtrar',      ar: 'تصفية',        wo: 'Tànn' },
    saving:      { fr: 'Enregistrement…', en: 'Saving…',   ln: 'Kobomba…',     ktu: 'Kobomba…',     es: 'Guardando…',  pt: 'Salvando…',    ar: '…جارٍ الحفظ',   wo: 'Di denc…' },
    creating:    { fr: 'Création…',     en: 'Creating…',   ln: 'Kokela…',      ktu: 'Kokela…',      es: 'Creando…',    pt: 'Criando…',     ar: '…جارٍ الإنشاء', wo: 'Di sos…' },
    deleting:    { fr: 'Suppression…',  en: 'Deleting…',   ln: 'Kolongola…',   ktu: 'Kolongola…',   es: 'Eliminando…', pt: 'Excluindo…',   ar: '…جارٍ الحذف',   wo: 'Di far…' },
    yes:         { fr: 'Oui',           en: 'Yes',         ln: 'Iyo',          ktu: 'Inga',         es: 'Sí',          pt: 'Sim',          ar: 'نعم',           wo: 'Waaw' },
    no:          { fr: 'Non',           en: 'No',          ln: 'Te',           ktu: 'Ve',           es: 'No',          pt: 'Não',          ar: 'لا',            wo: 'Déet' },
    actions:     { fr: 'Actions',       en: 'Actions',     ln: 'Misala',       ktu: 'Misala',       es: 'Acciones',    pt: 'Ações',        ar: 'إجراءات',       wo: 'Jëf yi' },
    details:     { fr: 'Détails',       en: 'Details',     ln: 'Makambu',      ktu: 'Makambu',      es: 'Detalles',    pt: 'Detalhes',     ar: 'تفاصيل',        wo: 'Njeexital' },
    settings:    { fr: 'Paramètres',    en: 'Settings',    ln: 'Bobongisi',    ktu: 'Bobongisi',    es: 'Ajustes',     pt: 'Configurações', ar: 'إعدادات',      wo: 'Sàkkal' },
    name:        { fr: 'Nom',           en: 'Name',        ln: 'Nkombo',       ktu: 'Nkombo',       es: 'Nombre',      pt: 'Nome',         ar: 'الاسم',         wo: 'Tur' },
    email:       { fr: 'Email',         en: 'Email',       ln: 'Email',        ktu: 'Email',        es: 'Correo',      pt: 'Email',        ar: 'بريد',          wo: 'Email' },
    phone:       { fr: 'Téléphone',     en: 'Phone',       ln: 'Telefone',     ktu: 'Telefone',     es: 'Teléfono',    pt: 'Telefone',     ar: 'هاتف',          wo: 'Telefon' },
    address:     { fr: 'Adresse',       en: 'Address',     ln: 'Adresse',      ktu: 'Adresse',      es: 'Dirección',   pt: 'Endereço',     ar: 'عنوان',         wo: 'Adres' },
    role:        { fr: 'Rôle',          en: 'Role',        ln: 'Mosala',       ktu: 'Mosala',       es: 'Rol',         pt: 'Função',       ar: 'دور',           wo: 'Liggéey' },
    agency:      { fr: 'Agence',        en: 'Agency',      ln: 'Eteyelo',      ktu: 'Kompani',      es: 'Agencia',     pt: 'Agência',      ar: 'وكالة',         wo: 'Agence' },
    date:        { fr: 'Date',          en: 'Date',        ln: 'Mokolo',       ktu: 'Lumbu',        es: 'Fecha',       pt: 'Data',         ar: 'تاريخ',         wo: 'Bés' },
    type:        { fr: 'Type',          en: 'Type',        ln: 'Lolenge',      ktu: 'Lolenge',      es: 'Tipo',        pt: 'Tipo',         ar: 'نوع',           wo: 'Xeet' },
    description: { fr: 'Description',   en: 'Description', ln: 'Ndimbola',     ktu: 'Ndimbola',     es: 'Descripción', pt: 'Descrição',    ar: 'وصف',           wo: 'Njeexital' },
    password:    { fr: 'Mot de passe',  en: 'Password',    ln: 'Mot ya nkɔtɔ', ktu: 'Mot ya nkɔtɔ', es: 'Contraseña', pt: 'Senha',        ar: 'كلمة المرور',   wo: 'Baatu jëf' },
    select:      { fr: '— Sélectionner —', en: '— Select —', ln: '— Pona —',  ktu: '— Pona —',     es: '— Seleccionar —', pt: '— Selecionar —', ar: '— اختر —', wo: '— Tànn —' },
    none:        { fr: 'Aucun',         en: 'None',        ln: 'Ata moko te',  ktu: 'Ata moko te',  es: 'Ninguno',     pt: 'Nenhum',       ar: 'لا شيء',        wo: 'Dara' },
    all:         { fr: 'Tous',          en: 'All',         ln: 'Nyonso',       ktu: 'Nyonso',       es: 'Todos',       pt: 'Todos',        ar: 'الكل',          wo: 'Yépp' },
    active:      { fr: 'Actif',         en: 'Active',      ln: 'Esalaka',      ktu: 'Esalaka',      es: 'Activo',      pt: 'Ativo',        ar: 'نشط',           wo: 'Dox' },
    suspended:   { fr: 'Suspendu',      en: 'Suspended',   ln: 'Esimisami',    ktu: 'Esimisami',    es: 'Suspendido',  pt: 'Suspenso',     ar: 'معلّق',         wo: 'Taxaw' },
    archived:    { fr: 'Archivé',       en: 'Archived',    ln: 'Ebombami',     ktu: 'Ebombami',     es: 'Archivado',   pt: 'Arquivado',    ar: 'مؤرشف',         wo: 'Denc' },
    view:        { fr: 'Voir',          en: 'View',        ln: 'Kotala',       ktu: 'Kotala',       es: 'Ver',         pt: 'Ver',          ar: 'عرض',           wo: 'Xool' },
    required:    { fr: 'Obligatoire',   en: 'Required',    ln: 'Esengeli',     ktu: 'Esengeli',     es: 'Obligatorio', pt: 'Obrigatório',  ar: 'مطلوب',         wo: 'Waajib' },
    optional:    { fr: 'Optionnel',     en: 'Optional',    ln: 'Na nzela',     ktu: 'Na nzela',     es: 'Opcional',    pt: 'Opcional',     ar: 'اختياري',       wo: 'Bàyyi' },
    documents:   { fr: 'Documents',     en: 'Documents',   ln: 'Mikanda',      ktu: 'Mikanda',      es: 'Documentos',  pt: 'Documentos',   ar: 'وثائق',         wo: 'Xët yi' },
  },

  // ── Interface générale ─────────────────────────────────────────────────────
  ui: {
    loading: {
      fr: 'Chargement…',   en: 'Loading…',      ln: 'Kozela…',       ktu: 'Kozela…',
      es: 'Cargando…',     pt: 'Carregando…',   ar: '…جارٍ التحميل', wo: 'Di jëfandikoo…',
    },
    no_data: {
      fr: 'Aucune donnée',  en: 'No data',       ln: 'Liloba te',     ktu: 'Eloko te',
      es: 'Sin datos',      pt: 'Sem dados',     ar: 'لا بيانات',     wo: 'Dara woon du am',
    },
    updated_at: {
      fr: 'Mis à jour',     en: 'Updated',       ln: 'Ebongwaki',     ktu: 'Ebongwaki',
      es: 'Actualizado',    pt: 'Atualizado',    ar: 'تم التحديث',    wo: 'Yeesal',
    },
    next_stop: {
      fr: 'Prochain arrêt', en: 'Next stop',     ln: 'Esimama oyo',  ktu: 'Esimama oyo',
      es: 'Próxima parada', pt: 'Próxima parada', ar: 'التوقف التالي', wo: 'Tànn bi ci kanam',
    },
    current_stop: {
      fr: 'Arrêt actuel',   en: 'Current stop',  ln: 'Esimama oyo',  ktu: 'Esimama ya joñ',
      es: 'Parada actual',  pt: 'Parada atual',  ar: 'التوقف الحالي', wo: 'Tànn bi léegi',
    },
    passed_stops: {
      fr: 'Arrêts passés',  en: 'Passed stops',  ln: 'Bisimama elɔtaki', ktu: 'Bisimama',
      es: 'Paradas pasadas', pt: 'Paradas passadas', ar: 'توقفات مرّت', wo: 'Tànn yi wëcci',
    },
    board_title: {
      fr: 'Tableau des',     en: 'Board',          ln: 'Tableau ya',    ktu: 'Tableau ya',
      es: 'Panel de',        pt: 'Painel de',      ar: 'لوحة',          wo: 'Lekkël yi',
    },
    platform_label: {
      fr: 'Quai',            en: 'Platform',       ln: 'Libanda',       ktu: 'Libanda',
      es: 'Andén',           pt: 'Cais',           ar: 'الرصيف',        wo: 'Kër bi',
    },
    departure_in: {
      fr: 'Départ dans',     en: 'Departs in',     ln: 'Kokei na',      ktu: 'Bakei na',
      es: 'Sale en',         pt: 'Parte em',       ar: 'المغادرة في',   wo: 'Dem ci',
    },
    on_board: {
      fr: 'À bord',          en: 'On board',       ln: 'Na kati ya otobisi', ktu: 'Na kati',
      es: 'A bordo',         pt: 'A bordo',        ar: 'على متن',       wo: 'Ci bus bi',
    },
    sos: {
      fr: 'SOS',             en: 'SOS',            ln: 'LISALISI',      ktu: 'LISALISI',
      es: 'SOS',             pt: 'SOS',            ar: 'نداء استغاثة',  wo: 'NDËNDOO',
    },
    checklist: {
      fr: 'Checklist',       en: 'Checklist',      ln: 'Lisosoli',      ktu: 'Lisosoli',
      es: 'Lista de control', pt: 'Lista de verificação', ar: 'قائمة التحقق', wo: 'Listu bi',
    },
    scan: {
      fr: 'Scanner',         en: 'Scan',           ln: 'Kotala',        ktu: 'Kotala',
      es: 'Escanear',        pt: 'Escanear',       ar: 'مسح ضوئي',      wo: 'Xool',
    },
    sell: {
      fr: 'Vente',           en: 'Sales',          ln: 'Koteka',        ktu: 'Koteka',
      es: 'Ventas',          pt: 'Vendas',         ar: 'مبيعات',        wo: 'Jaay',
    },
    checkin: {
      fr: 'Check-in',        en: 'Check-in',       ln: 'Kolembwa',      ktu: 'Kolembwa',
      es: 'Registro',        pt: 'Embarque',       ar: 'تسجيل الوصول',  wo: 'Setal',
    },
    parcels: {
      fr: 'Colis',           en: 'Parcels',        ln: 'Mipako',        ktu: 'Mipako',
      es: 'Paquetes',        pt: 'Encomendas',     ar: 'الطرود',        wo: 'Sos yi',
    },
    cashier: {
      fr: 'Caisse',          en: 'Cashier',        ln: 'Caisse',        ktu: 'Caisse',
      es: 'Caja',            pt: 'Caixa',          ar: 'الصندوق',       wo: 'Caisse bi',
    },
    confirm: {
      fr: 'Confirmer',       en: 'Confirm',        ln: 'Kolobela',      ktu: 'Kolobela',
      es: 'Confirmar',       pt: 'Confirmar',      ar: 'تأكيد',         wo: 'Dëgg',
    },
    cancel: {
      fr: 'Annuler',         en: 'Cancel',         ln: 'Kotika',        ktu: 'Kotika',
      es: 'Cancelar',        pt: 'Cancelar',       ar: 'إلغاء',         wo: 'Yokk',
    },
    back: {
      fr: 'Retour',          en: 'Back',           ln: 'Kozonga',       ktu: 'Kozonga',
      es: 'Volver',          pt: 'Voltar',         ar: 'رجوع',          wo: 'Dellu',
    },
    search: {
      fr: 'Rechercher',      en: 'Search',         ln: 'Koluka',        ktu: 'Koluka',
      es: 'Buscar',          pt: 'Pesquisar',      ar: 'بحث',           wo: 'Sabar',
    },
    book: {
      fr: 'Réserver',        en: 'Book',           ln: 'Kozwa esika',   ktu: 'Kozwa esika',
      es: 'Reservar',        pt: 'Reservar',       ar: 'حجز',           wo: 'Tekki',
    },
    full: {
      fr: 'Complet',         en: 'Full',           ln: 'Eza na ebele',  ktu: 'Ezali na ebele',
      es: 'Completo',        pt: 'Lotado',         ar: 'ممتلئ',         wo: 'Sëkk',
    },
    available: {
      fr: 'Disponible',      en: 'Available',      ln: 'Ezali',         ktu: 'Ezali',
      es: 'Disponible',      pt: 'Disponível',     ar: 'متاح',          wo: 'Amna',
    },
  },

  // ── Météo ──────────────────────────────────────────────────────────────────
  weather: {
    sunny: {
      fr: 'Ensoleillé',      en: 'Sunny',          ln: 'Moyi mpenza',   ktu: 'Moyi mpenza',
      es: 'Soleado',         pt: 'Ensolarado',     ar: 'مشمس',          wo: 'Tëdd',
    },
    cloudy: {
      fr: 'Nuageux',         en: 'Cloudy',         ln: 'Mapɛpɛ mingi',  ktu: 'Mapɛpɛ',
      es: 'Nublado',         pt: 'Nublado',        ar: 'غائم',          wo: 'Rëdd ak Ndox',
    },
    partly_cloudy: {
      fr: 'Partiellement nuageux', en: 'Partly cloudy', ln: 'Mapɛpɛ mwa', ktu: 'Mapɛpɛ mwa',
      es: 'Parcialmente nublado',  pt: 'Parcialmente nublado', ar: 'غائم جزئيًا', wo: 'Dëkk bu baax',
    },
    rainy: {
      fr: 'Pluvieux',        en: 'Rainy',          ln: 'Mbula esali',   ktu: 'Mbula esali',
      es: 'Lluvioso',        pt: 'Chuvoso',        ar: 'ممطر',          wo: 'Ñog',
    },
    stormy: {
      fr: 'Orageux',         en: 'Stormy',         ln: 'Mopɛpɛ makasi', ktu: 'Mopɛpɛ makasi',
      es: 'Tormentoso',      pt: 'Tempestuoso',    ar: 'عاصف',          wo: 'Tàmbëli',
    },
    foggy: {
      fr: 'Brumeux',         en: 'Foggy',          ln: 'Mpɔpɔ',         ktu: 'Mpɔpɔ',
      es: 'Brumoso',         pt: 'Enevoado',       ar: 'ضبابي',         wo: 'Sopii',
    },
    windy: {
      fr: 'Venteux',         en: 'Windy',          ln: 'Mopɛpɛ',        ktu: 'Mopɛpɛ',
      es: 'Ventoso',         pt: 'Ventoso',        ar: 'عاصف',          wo: 'Fëjël',
    },
    at_destination: {
      fr: 'À destination',   en: 'At destination', ln: 'Na esika',      ktu: 'Na esika',
      es: 'En destino',      pt: 'No destino',     ar: 'في الوجهة',     wo: 'Ci bopp bi',
    },
    feels_like: {
      fr: 'Ressenti',        en: 'Feels like',     ln: 'Kolinga',       ktu: 'Kolinga',
      es: 'Sensación térmica', pt: 'Sensação',     ar: 'الإحساس',       wo: 'Làmm',
    },
    humidity: {
      fr: 'Humidité',        en: 'Humidity',       ln: 'Mayi na mpamba', ktu: 'Mayi na mpamba',
      es: 'Humedad',         pt: 'Humidade',       ar: 'الرطوبة',       wo: 'Ngub',
    },
  },

  // ── Notifications ticker ───────────────────────────────────────────────────
  notifications: {
    info: {
      fr: 'INFO',            en: 'INFO',           ln: 'SANGO',         ktu: 'SANGO',
      es: 'INFO',            pt: 'INFO',           ar: 'معلومات',       wo: 'XIBAAR',
    },
    weather: {
      fr: 'MÉTÉO',           en: 'WEATHER',        ln: 'BOZALISI',      ktu: 'BOZALISI',
      es: 'CLIMA',           pt: 'TEMPO',          ar: 'طقس',           wo: 'ÀDDINA',
    },
    delay: {
      fr: 'RETARD',          en: 'DELAY',          ln: 'ELƆKƆ',         ktu: 'ELƆKƆ',
      es: 'RETRASO',         pt: 'ATRASO',         ar: 'تأخير',         wo: 'RËDD',
    },
    alert: {
      fr: 'ALERTE',          en: 'ALERT',          ln: 'LIKEBI',        ktu: 'LIKEBI',
      es: 'ALERTA',          pt: 'ALERTA',         ar: 'تنبيه',         wo: 'TÉGGIN',
    },
    news: {
      fr: 'ACTUALITÉ',       en: 'NEWS',           ln: 'SANGO',         ktu: 'SANGO YANGO',
      es: 'NOTICIAS',        pt: 'NOTÍCIAS',       ar: 'أخبار',         wo: 'XIBAAR YËWËM',
    },
  },
};
