/**
 * workflowI18n — Traductions spécifiques au Workflow Studio.
 *
 * Deux contenus :
 *   1. WORKFLOW_VERBS : verbes d'actions de workflow courantes (infinitif) par
 *      langue. Couvre les verbes seedés dans les blueprints système ; les
 *      verbes métier custom fallback sur le nom brut.
 *   2. renderSentence() : assemble une phrase à partir d'un StructuredStep
 *      ou StructuredConclusion + la langue courante de l'I18nProvider.
 *
 * Langues : fr, en, ln (Lingala), ktu (Kituba), es, pt, ar, wo (Wolof).
 */
import type { Language } from '../../lib/i18n/types';
import { translate } from '../../lib/i18n/useI18n';

type TranslationMap = Record<Language, string>;

// ─── Verbes workflow ─────────────────────────────────────────────────────────
// Infinitifs (forme canonique) — conjugué au présent 3e singulier via template.
// Les Lingala/Kituba/Wolof utilisent la forme "faire X" quand pas d'équivalent direct.
// Fallback "fr" si la langue manque, puis verbe brut si verbe inconnu.

export const WORKFLOW_VERBS: Record<string, TranslationMap> = {
  sell:              { fr: 'vendre',      en: 'sell',        ln: 'kotekisa',         ktu: 'kutekisa',        es: 'vender',       pt: 'vender',       ar: 'بيع',        wo: 'jaay' },
  validate:          { fr: 'valider',     en: 'validate',    ln: 'kondimisa',        ktu: 'kundimisa',       es: 'validar',      pt: 'validar',      ar: 'التحقق',     wo: 'seet' },
  board:             { fr: 'embarquer',   en: 'board',       ln: 'kokɔta',           ktu: 'kukota',          es: 'embarcar',     pt: 'embarcar',     ar: 'الصعود',     wo: 'dugg' },
  complete:          { fr: 'finaliser',   en: 'complete',    ln: 'kosilisa',         ktu: 'kumana',          es: 'finalizar',    pt: 'finalizar',    ar: 'إتمام',      wo: 'jeex' },
  cancel:            { fr: 'annuler',     en: 'cancel',      ln: 'kobuna',           ktu: 'kukatula',        es: 'cancelar',     pt: 'cancelar',     ar: 'إلغاء',      wo: 'ñaq' },
  confirm:           { fr: 'confirmer',   en: 'confirm',     ln: 'kondima',          ktu: 'kundima',         es: 'confirmar',    pt: 'confirmar',    ar: 'تأكيد',      wo: 'wóoral' },
  reject:            { fr: 'rejeter',     en: 'reject',      ln: 'koboya',           ktu: 'kubuya',          es: 'rechazar',     pt: 'rejeitar',     ar: 'رفض',        wo: 'bañ' },
  approve:           { fr: 'approuver',   en: 'approve',     ln: 'kondima',          ktu: 'kundima',         es: 'aprobar',      pt: 'aprovar',      ar: 'موافقة',     wo: 'nangu' },

  // Trip
  start_loading:     { fr: 'démarrer le chargement', en: 'start loading',       ln: 'kobanda kotondisa',     ktu: 'kubanda kufula',       es: 'iniciar carga',         pt: 'iniciar carga',          ar: 'بدء التحميل',    wo: 'tàmbali yóbbu' },
  depart:            { fr: 'faire partir',           en: 'depart',              ln: 'kokende',               ktu: 'kwenda',               es: 'partir',                pt: 'partir',                 ar: 'المغادرة',       wo: 'dem' },
  confirm_departure: { fr: 'confirmer le départ',    en: 'confirm departure',   ln: 'kondima ete ekei',      ktu: 'kundima kwenda',       es: 'confirmar salida',      pt: 'confirmar partida',      ar: 'تأكيد المغادرة', wo: 'wóoral ndem' },
  arrive:            { fr: 'arriver',                en: 'arrive',              ln: 'kokoma',                ktu: 'kukuma',               es: 'llegar',                pt: 'chegar',                 ar: 'الوصول',         wo: 'agsi' },
  report_incident:   { fr: 'signaler un incident',   en: 'report incident',     ln: 'koyebisa likama',       ktu: 'kuzabisa diambu',      es: 'reportar incidente',    pt: 'reportar incidente',     ar: 'الإبلاغ عن حادث',wo: 'yégle iñcidãa' },
  resolve_incident:  { fr: 'résoudre l\'incident',   en: 'resolve incident',    ln: 'kosilisa likama',       ktu: 'kumana diambu',        es: 'resolver incidente',    pt: 'resolver incidente',     ar: 'حل الحادث',      wo: 'rees iñcidãa' },

  // Parcel
  process:           { fr: 'traiter',          en: 'process',         ln: 'kosala',              ktu: 'kusala',             es: 'procesar',         pt: 'processar',       ar: 'معالجة',     wo: 'jëmmal' },
  dispatch:          { fr: 'expédier',         en: 'dispatch',        ln: 'kotinda',             ktu: 'kutinda',            es: 'despachar',        pt: 'despachar',       ar: 'إرسال',      wo: 'yónnee' },
  out_for_delivery:  { fr: 'mettre en livraison', en: 'send out for delivery', ln: 'kobimisa mpo ya kopesa', ktu: 'kubimisa mu kupesa', es: 'sacar para entrega', pt: 'sair para entrega', ar: 'خروج للتسليم',  wo: 'génne ngir delivrance' },
  deliver:           { fr: 'livrer',           en: 'deliver',         ln: 'kopesa',              ktu: 'kupesa',             es: 'entregar',         pt: 'entregar',        ar: 'تسليم',      wo: 'jox' },
  return_parcel:     { fr: 'retourner',        en: 'return',          ln: 'kozongisa',           ktu: 'kuvutula',           es: 'devolver',         pt: 'devolver',        ar: 'إرجاع',      wo: 'dellusi' },
  reprocess:         { fr: 'retraiter',        en: 'reprocess',       ln: 'kosala lisusu',       ktu: 'kusala diaka',       es: 'reprocesar',       pt: 'reprocessar',     ar: 'إعادة المعالجة', wo: 'jëmmal ci yoon wu bees' },

  // Claim / SAV
  assign:            { fr: 'assigner',        en: 'assign',          ln: 'kopesa mosala',       ktu: 'kupesa kisalu',      es: 'asignar',          pt: 'atribuir',        ar: 'تعيين',      wo: 'jox tas' },
  request_info:      { fr: 'demander une information', en: 'request information', ln: 'kosenga sango',   ktu: 'kulomba nsangu',    es: 'solicitar información', pt: 'solicitar informação', ar: 'طلب معلومة', wo: 'ñaan xibaar' },
  provide_info:      { fr: 'fournir l\'information', en: 'provide information', ln: 'kopesa sango',       ktu: 'kupesa nsangu',      es: 'proporcionar información', pt: 'fornecer informação', ar: 'تقديم المعلومة', wo: 'jox xibaar' },
  resolve:           { fr: 'résoudre',        en: 'resolve',         ln: 'kosilisa',            ktu: 'kumana',             es: 'resolver',         pt: 'resolver',        ar: 'حل',         wo: 'rees' },
  close:             { fr: 'clôturer',        en: 'close',           ln: 'kokanga',             ktu: 'kukanga',            es: 'cerrar',           pt: 'fechar',          ar: 'إغلاق',      wo: 'tëj' },

  // Incident
  report:            { fr: 'signaler',        en: 'report',          ln: 'koyebisa',            ktu: 'kuzabisa',           es: 'reportar',         pt: 'reportar',        ar: 'الإبلاغ',    wo: 'yégle' },
  escalate:          { fr: 'escalader',       en: 'escalate',        ln: 'komatisa',            ktu: 'kutombula',          es: 'escalar',          pt: 'escalar',         ar: 'تصعيد',      wo: 'yokk' },
  investigate:       { fr: 'enquêter',        en: 'investigate',     ln: 'kolukaluka',          ktu: 'kusosa',             es: 'investigar',       pt: 'investigar',      ar: 'التحقيق',    wo: 'sos' },

  // Generic workflow
  submit:            { fr: 'soumettre',       en: 'submit',          ln: 'kotinda',             ktu: 'kutinda',            es: 'enviar',           pt: 'enviar',          ar: 'تقديم',      wo: 'yónnee' },
  sign:              { fr: 'signer',          en: 'sign',            ln: 'kosiga',              ktu: 'kusiga',             es: 'firmar',           pt: 'assinar',         ar: 'توقيع',      wo: 'xaatim' },
  archive:           { fr: 'archiver',        en: 'archive',         ln: 'kobomba',             ktu: 'kubomba',            es: 'archivar',         pt: 'arquivar',        ar: 'أرشفة',      wo: 'denc' },
  revise:            { fr: 'réviser',         en: 'revise',          ln: 'kobongisa',           ktu: 'kubongisa',          es: 'revisar',          pt: 'rever',           ar: 'مراجعة',     wo: 'lànkat' },
};

// ─── Étiquettes génériques (pronoms, connecteurs) ────────────────────────────

export const WORKFLOW_I18N = {
  // Sujets
  anyRoleWithPerms:  { fr: 'tout profil', en: 'any profile', ln: 'moto nyonso', ktu: 'muntu yonso', es: 'cualquier perfil', pt: 'qualquer perfil', ar: 'أي ملف',    wo: 'ku mën mën' } as TranslationMap,
  simulationRole:    { fr: 'le profil simulé', en: 'the simulated profile', ln: 'moto oyo tomekaka', ktu: 'muntu beto ke meka', es: 'el perfil simulado', pt: 'o perfil simulado', ar: 'الملف المحاكى', wo: 'profil biñ simile' } as TranslationMap,

  // Templates pour chaque reason
  tmpl_success:      { fr: '{actor} peut {verb} (de {from} vers {to}).',
                       en: '{actor} can {verb} (from {from} to {to}).',
                       ln: '{actor} akoki {verb} (kobanda na {from} kino {to}).',
                       ktu: '{actor} lenda {verb} (kubanda {from} tii {to}).',
                       es: '{actor} puede {verb} (de {from} a {to}).',
                       pt: '{actor} pode {verb} (de {from} para {to}).',
                       ar: '{actor} يمكنه {verb} (من {from} إلى {to}).',
                       wo: '{actor} man na {verb} (ci {from} ba ci {to}).' } as TranslationMap,

  tmpl_perm_denied:  { fr: '{actor} n\'est pas autorisé à {verb} depuis {from}.',
                       en: '{actor} is not allowed to {verb} from {from}.',
                       ln: '{actor} apesamaki ndingisa te ya {verb} kobanda na {from}.',
                       ktu: '{actor} kele ti nzila te ya {verb} kubanda {from}.',
                       es: '{actor} no está autorizado a {verb} desde {from}.',
                       pt: '{actor} não está autorizado a {verb} desde {from}.',
                       ar: 'لا يُسمح لـ {actor} بـ {verb} من {from}.',
                       wo: '{actor} amul bayu {verb} ci {from}.' } as TranslationMap,

  tmpl_perm_hint_roles:{ fr: 'Cette action requiert la permission "{perm}", possédée par : {roles}.',
                         en: 'This action requires permission "{perm}", held by: {roles}.',
                         ln: 'Mosala oyo esengeli ndingisa "{perm}", ezwami na: {roles}.',
                         ktu: 'Kisalu yai ke lomba ndingisa "{perm}", yina ke ti: {roles}.',
                         es: 'Esta acción requiere el permiso "{perm}", en poder de: {roles}.',
                         pt: 'Esta ação requer a permissão "{perm}", detida por: {roles}.',
                         ar: 'يتطلب هذا الإجراء إذن "{perm}", الذي يملكه: {roles}.',
                         wo: 'Jëf bii dafa laaj ndigal "{perm}", mi amul am: {roles}.' } as TranslationMap,

  tmpl_perm_hint_none:{ fr: 'Cette action requiert la permission "{perm}", qui n\'est attribuée à aucun rôle.',
                        en: 'This action requires permission "{perm}", not granted to any role.',
                        ln: 'Mosala oyo esengeli ndingisa "{perm}", epesameli moto moko te.',
                        ktu: 'Kisalu yai ke lomba ndingisa "{perm}", yina kele ti muntu ve.',
                        es: 'Esta acción requiere el permiso "{perm}", que no se ha asignado a ningún rol.',
                        pt: 'Esta ação requer a permissão "{perm}", que não está atribuída a nenhum papel.',
                        ar: 'يتطلب هذا الإجراء إذن "{perm}", غير ممنوح لأي دور.',
                        wo: 'Jëf bii dafa laaj ndigal "{perm}", kenn gis ci roñ bu.' } as TranslationMap,

  tmpl_guard_blocked:{ fr: 'La condition "{guard}" empêche l\'action {verb} depuis {from}.',
                       en: 'The condition "{guard}" prevents action {verb} from {from}.',
                       ln: 'Likambo "{guard}" epekisi mosala {verb} kobanda na {from}.',
                       ktu: 'Kilongisi "{guard}" ke kakila kisalu {verb} kubanda {from}.',
                       es: 'La condición "{guard}" impide la acción {verb} desde {from}.',
                       pt: 'A condição "{guard}" impede a ação {verb} desde {from}.',
                       ar: 'الشرط "{guard}" يمنع الإجراء {verb} من {from}.',
                       wo: 'Condition bi "{guard}" mi mooyé jëf {verb} ci {from}.' } as TranslationMap,

  tmpl_guard_hint:   { fr: 'Modifiez les conditions de test à gauche pour vérifier d\'autres cas.',
                       en: 'Adjust the test conditions on the left to check other cases.',
                       ln: 'Bongola makambo ya komeka na lɛmba mpo na komona makambo mosusu.',
                       ktu: 'Bongisa makambu ya kumeka kuna lulendo mu kumona makambu ya nkaka.',
                       es: 'Modifique las condiciones de prueba a la izquierda para verificar otros casos.',
                       pt: 'Ajuste as condições de teste à esquerda para verificar outros casos.',
                       ar: 'عدّل شروط الاختبار على اليسار للتحقق من حالات أخرى.',
                       wo: 'Soppil conditions yi ci cammoñ ngir seet yeneen kas yi.' } as TranslationMap,

  tmpl_unknown:      { fr: 'Aucune transition "{verb}" n\'existe depuis l\'état {from}.',
                       en: 'No transition "{verb}" exists from state {from}.',
                       ln: 'Transition "{verb}" ezali te kobanda na {from}.',
                       ktu: 'Transition "{verb}" kele ve kubanda {from}.',
                       es: 'No existe transición "{verb}" desde el estado {from}.',
                       pt: 'Não existe transição "{verb}" desde o estado {from}.',
                       ar: 'لا توجد انتقال "{verb}" من الحالة {from}.',
                       wo: 'Amul transition "{verb}" ci estat {from}.' } as TranslationMap,

  // Bilan
  headline_all:      { fr: '{actor} peut accomplir l\'intégralité du scénario ({n} action{s}).',
                       en: '{actor} can complete the entire scenario ({n} action{s}).',
                       ln: '{actor} akoki kosilisa makambo nyonso ({n} misala).',
                       ktu: '{actor} lenda kumana makambu yonso ({n} bisalu).',
                       es: '{actor} puede completar todo el escenario ({n} acción{s}).',
                       pt: '{actor} pode concluir todo o cenário ({n} ação{s}).',
                       ar: '{actor} يمكنه إتمام السيناريو بالكامل ({n} إجراءات).',
                       wo: '{actor} man na jeex scenario bi bépp ({n} jëf).' } as TranslationMap,

  headline_none:     { fr: '{actor} ne peut effectuer aucune des {n} action{s} tentée{s}.',
                       en: '{actor} cannot perform any of the {n} attempted action{s}.',
                       ln: '{actor} akoki kosala moko te kati na misala {n}.',
                       ktu: '{actor} lenda ve kusala kisalu mosi ya bisalu {n}.',
                       es: '{actor} no puede realizar ninguna de las {n} acción{s} intentada{s}.',
                       pt: '{actor} não pode realizar nenhuma das {n} ação{s} tentada{s}.',
                       ar: '{actor} لا يمكنه تنفيذ أي من {n} الإجراءات المحاولة.',
                       wo: '{actor} manul defar jëf yi {n} yi ñu jéem.' } as TranslationMap,

  headline_partial:  { fr: '{actor} peut effectuer {ok} action{s1} sur {n}.',
                       en: '{actor} can perform {ok} of {n} action{s}.',
                       ln: '{actor} akoki kosala {ok} na {n} misala.',
                       ktu: '{actor} lenda kusala {ok} ya {n} bisalu.',
                       es: '{actor} puede realizar {ok} de {n} acción{s}.',
                       pt: '{actor} pode realizar {ok} de {n} ação{s}.',
                       ar: '{actor} يمكنه تنفيذ {ok} من أصل {n} إجراءات.',
                       wo: '{actor} man na def {ok} ci {n} jëf.' } as TranslationMap,

  headline_empty:    { fr: 'Aucune action n\'a été tentée. Choisissez une action ou utilisez le mode Auto.',
                       en: 'No action was attempted. Pick an action or use Auto mode.',
                       ln: 'Mosala moko te emekami. Pona mosala to sala na mode Auto.',
                       ktu: 'Kisalu mosi kumekana ve. Pona kisalu to sala ti mode Auto.',
                       es: 'No se intentó ninguna acción. Elija una acción o use el modo Auto.',
                       pt: 'Nenhuma ação foi tentada. Escolha uma ação ou use o modo Auto.',
                       ar: 'لم تتم محاولة أي إجراء. اختر إجراءً أو استخدم الوضع التلقائي.',
                       wo: 'Amul jëf bu ñu jéem. Tànnal jëf walla jëfandikoo mode Auto.' } as TranslationMap,

  // Conclusion
  concl_try_roles:   { fr: 'Pour les étapes bloquées, essayez plutôt avec un de ces profils : {roles}.',
                       en: 'For the blocked steps, try instead with one of these profiles: {roles}.',
                       ln: 'Mpo na misala epekolami, meka na moko kati na baprofils oyo: {roles}.',
                       ktu: 'Mu bisalu ke kakama, meka ti profile mosi ya bisalu bisalu: {roles}.',
                       es: 'Para los pasos bloqueados, pruebe con uno de estos perfiles: {roles}.',
                       pt: 'Para as etapas bloqueadas, tente com um destes perfis: {roles}.',
                       ar: 'للخطوات المعطلة، جرّب بدلاً من ذلك مع أحد هذه الملفات: {roles}.',
                       wo: 'Ngir pas yi baña, jéemal ak kenn ci profil yi: {roles}.' } as TranslationMap,

  concl_no_owner:    { fr: 'Pour boucler le scénario, il faut attribuer les permissions suivantes à un rôle : {perms}.',
                       en: 'To complete the scenario, these permissions must be granted to a role: {perms}.',
                       ln: 'Mpo na kosilisa scenario, ndingisa oyo esengeli kopesama na moto moko: {perms}.',
                       ktu: 'Mu kumana scenario, bandingisa yai ke fwana kupesa muntu: {perms}.',
                       es: 'Para completar el escenario, estos permisos deben otorgarse a un rol: {perms}.',
                       pt: 'Para concluir o cenário, estas permissões devem ser atribuídas a um papel: {perms}.',
                       ar: 'لإكمال السيناريو، يجب منح هذه الأذونات لدور: {perms}.',
                       wo: 'Ngir jeex scenario bi, ñu wara jox ndigal yii ci roñ: {perms}.' } as TranslationMap,

  concl_unreachable: { fr: 'Certains états ne sont pas atteignables depuis ce point de départ : {states}.',
                       en: 'Some states are not reachable from this starting point: {states}.',
                       ln: 'Ndambo ya bisika ezali ya kokoma te uta na ebandeli oyo: {states}.',
                       ktu: 'Bandambu ya bisika kele ve ya kukuma tuka na ebandelu yai: {states}.',
                       es: 'Algunos estados no son alcanzables desde este punto de partida: {states}.',
                       pt: 'Alguns estados não são alcançáveis a partir deste ponto de partida: {states}.',
                       ar: 'بعض الحالات ليست قابلة للوصول من نقطة البداية هذه: {states}.',
                       wo: 'Ay estats du ñu man jot ci tambalikaay bii: {states}.' } as TranslationMap,

  concl_unreachable_hint:{ fr: 'Cela peut être normal (ex : un terminal accessible uniquement par certaines branches).',
                           en: 'This may be expected (e.g. a terminal only reachable through certain branches).',
                           ln: 'Ekoki kozala ndenge wana (ndakisa: terminal oyo ekoki kokoma se na banzela mosusu).',
                           ktu: 'Yo lenda vanda bonso yina (mbandu: terminal yina ke kukumaka kaka na banzila ya nkaka).',
                           es: 'Esto puede ser normal (p. ej. un terminal solo accesible por ciertas ramas).',
                           pt: 'Isto pode ser normal (ex: um terminal apenas acessível por certos ramos).',
                           ar: 'قد يكون هذا طبيعياً (مثلاً: نهائي لا يمكن الوصول إليه إلا عبر بعض الفروع).',
                           wo: 'Loolu man nanu sakk (ci misaal: terminal bu ñu manul jot ba ci yeneen branches).' } as TranslationMap,
} as const;

// ─── Helpers publics ──────────────────────────────────────────────────────────

/** Retourne le verbe traduit pour la langue demandée, sinon le nom brut. */
export function translateVerb(actionName: string, lang: Language): string {
  const map = WORKFLOW_VERBS[actionName];
  if (!map) return actionName; // fallback : verbe custom créé par le designer
  return translate(map, lang);
}

/** Interpolation simple `{key}` → valeur. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/** Retourne l'étiquette du sujet de la phrase (nom de rôle ou fallback générique). */
export function subject(roleName: string, ignoredPermissions: boolean, lang: Language): string {
  if (roleName) return roleName;
  return ignoredPermissions
    ? translate(WORKFLOW_I18N.anyRoleWithPerms, lang)
    : translate(WORKFLOW_I18N.simulationRole, lang);
}
