/**
 * Templates email User — invitation utilisateur par admin tenant.
 *
 * 1 template : user.invited — envoyé au nouveau collaborateur ajouté via
 * /admin/users (différent du colleague invite onboarding wizard, lui réservé
 * à la phase d'inscription tenant).
 *
 * i18n fr+en, anti-XSS, bouton "Définir mon mot de passe" rendu uniquement
 * si resetUrl http(s) valide.
 */

export type UserTemplateId = 'user.invited';

type Lang = 'fr' | 'en';

interface RenderedTemplate {
  title: string;
  body:  string;
  html:  string;
}

interface TemplateVars {
  inviteeName:   string;
  tenantName:    string;
  roleName:      string;   // ex: "Caissier", "Gestionnaire d'agence" — vide si non assigné
  agencyName:    string;   // ex: "Agence Brazzaville" — vide si non assignée
  resetUrl:      string;
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<UserTemplateId, Record<Lang, RenderFn>> = {
  'user.invited': {
    fr: (v) => ({
      title: `Invitation : votre compte ${v.tenantName} sur TransLog Pro`,
      body:  `Bonjour ${v.inviteeName}, un compte vient d'être créé pour vous chez ${v.tenantName} sur TransLog Pro${v.roleName ? ` (rôle ${v.roleName})` : ''}. Cliquez sur le lien dans l'email pour définir votre mot de passe et vous connecter.`,
      html:  htmlWrap(
        `Bienvenue chez ${v.tenantName}`,
        `<p>Bonjour ${escape(v.inviteeName)},</p>
         <p>Un compte vient d'être créé pour vous chez <strong>${escape(v.tenantName)}</strong> sur TransLog Pro.</p>
         <ul style="list-style:none;padding:0;margin:0">
           ${v.roleName   ? `<li><strong>Rôle :</strong> ${escape(v.roleName)}</li>` : ''}
           ${v.agencyName ? `<li><strong>Agence :</strong> ${escape(v.agencyName)}</li>` : ''}
         </ul>
         <p style="margin-top:18px">Pour vous connecter, définissez d'abord votre mot de passe en cliquant sur le bouton ci-dessous.</p>
         ${safeButton(v.resetUrl, 'Définir mon mot de passe')}
         <p style="color:#64748b;font-size:13px;margin-top:18px">Si vous n'attendiez pas cette invitation, ignorez ce message — votre compte ne sera utilisable qu'après définition d'un mot de passe.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Invitation: your ${v.tenantName} account on TransLog Pro`,
      body:  `Hello ${v.inviteeName}, an account has just been created for you at ${v.tenantName} on TransLog Pro${v.roleName ? ` (role ${v.roleName})` : ''}. Click the link in the email to set your password and sign in.`,
      html:  htmlWrap(
        `Welcome to ${v.tenantName}`,
        `<p>Hello ${escape(v.inviteeName)},</p>
         <p>An account has just been created for you at <strong>${escape(v.tenantName)}</strong> on TransLog Pro.</p>
         <ul style="list-style:none;padding:0;margin:0">
           ${v.roleName   ? `<li><strong>Role:</strong> ${escape(v.roleName)}</li>` : ''}
           ${v.agencyName ? `<li><strong>Agency:</strong> ${escape(v.agencyName)}</li>` : ''}
         </ul>
         <p style="margin-top:18px">To sign in, first set your password by clicking the button below.</p>
         ${safeButton(v.resetUrl, 'Set my password')}
         <p style="color:#64748b;font-size:13px;margin-top:18px">If you weren't expecting this invitation, ignore this message — the account is unusable until a password is set.</p>`,
      ),
    }),
  },
};

export function renderUserTemplate(
  templateId: UserTemplateId,
  lang:       Lang,
  vars:       TemplateVars,
): RenderedTemplate {
  const localeMap = TEMPLATES[templateId];
  const renderer  = localeMap[lang] ?? localeMap.fr;
  return renderer(vars);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlWrap(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
<h2 style="color:#0f172a">${escape(title)}</h2>
${body}
<hr style="margin-top:24px;border:0;border-top:1px solid #e2e8f0">
<p style="color:#64748b;font-size:12px">TransLog Pro</p>
</body></html>`;
}

function safeButton(url: string, label: string): string {
  if (!url || !/^https?:\/\//.test(url)) return '';
  return `<p style="margin-top:20px"><a href="${escape(url)}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">${escape(label)}</a></p>`;
}
