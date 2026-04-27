/**
 * Templates email Auth — sécurité (Tier 3 chantier email 2026-04-26).
 *
 * 5 templates :
 *   1. auth.password_reset.link        — lien reset (TTL 30 min)
 *   2. auth.password_reset.completed   — confirmation post-reset (alerte sécu)
 *   3. auth.email_verification         — confirmer son email
 *   4. auth.mfa.enabled                — MFA activé (alerte sécu)
 *   5. auth.mfa.disabled               — MFA désactivé (alerte sécu — important)
 *
 * Tous : i18n fr+en, anti-XSS. Les templates "completed" / "mfa.*" sont des
 * alertes sécurité — l'utilisateur doit savoir SI le changement est légitime
 * ou non, et savoir comment réagir si non.
 */

export type AuthTemplateId =
  | 'auth.password_reset.link'
  | 'auth.password_reset.completed'
  | 'auth.email_verification'
  | 'auth.mfa.enabled'
  | 'auth.mfa.disabled'
  | 'auth.mfa.suggested';

type Lang = 'fr' | 'en';

interface RenderedTemplate { title: string; body: string; html: string; }

interface TemplateVars {
  userName:    string;
  tenantName:  string;
  resetUrl:    string;
  verifyUrl:   string;
  expiresAt:   string;   // localisé
  completedAt: string;
  ipAddress:   string;
  factor:      string;   // ex: "TOTP", "SMS"
  setupUrl:    string;   // URL setup MFA (template suggested)
}

type RenderFn = (v: TemplateVars) => RenderedTemplate;

const TEMPLATES: Record<AuthTemplateId, Record<Lang, RenderFn>> = {
  // ─── 1. Reset password — lien ─────────────────────────────────────────────
  'auth.password_reset.link': {
    fr: (v) => ({
      title: `Réinitialisation de votre mot de passe`,
      body:  `Bonjour ${v.userName}, vous avez demandé à réinitialiser votre mot de passe sur ${v.tenantName}. Cliquez sur le lien dans le mail pour le faire (lien valable 30 min).`,
      html:  htmlWrap(
        `Réinitialisation de votre mot de passe`,
        `<p>Bonjour ${escape(v.userName)},</p>
         <p>Vous avez demandé à réinitialiser votre mot de passe sur <strong>${escape(v.tenantName)}</strong>.</p>
         <p>Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe :</p>
         ${safeButton(v.resetUrl, 'Réinitialiser mon mot de passe')}
         <p style="color:#64748b;font-size:13px;margin-top:18px">Ce lien est valable <strong>30 minutes</strong>${v.expiresAt ? ` (jusqu'au ${escape(v.expiresAt)})` : ''}.</p>
         <p style="color:#64748b;font-size:13px">Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message — votre mot de passe actuel reste valide.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Reset your password`,
      body:  `Hello ${v.userName}, you requested a password reset on ${v.tenantName}. Click the link in the email to do so (valid for 30 minutes).`,
      html:  htmlWrap(
        `Reset your password`,
        `<p>Hello ${escape(v.userName)},</p>
         <p>You requested a password reset on <strong>${escape(v.tenantName)}</strong>.</p>
         <p>Click the button below to set a new password:</p>
         ${safeButton(v.resetUrl, 'Reset my password')}
         <p style="color:#64748b;font-size:13px;margin-top:18px">This link is valid for <strong>30 minutes</strong>${v.expiresAt ? ` (until ${escape(v.expiresAt)})` : ''}.</p>
         <p style="color:#64748b;font-size:13px">If you didn't request this, you can ignore this message — your current password remains valid.</p>`,
      ),
    }),
  },

  // ─── 2. Reset password — confirmation post-reset (alerte sécu) ────────────
  'auth.password_reset.completed': {
    fr: (v) => ({
      title: `Votre mot de passe a été modifié`,
      body:  `Bonjour ${v.userName}, votre mot de passe sur ${v.tenantName} vient d'être modifié${v.completedAt ? ` (${v.completedAt})` : ''}. Si ce n'est pas vous, contactez immédiatement votre administrateur.`,
      html:  htmlWrap(
        `Mot de passe modifié`,
        `<p>Bonjour ${escape(v.userName)},</p>
         <p>Votre mot de passe sur <strong>${escape(v.tenantName)}</strong> vient d'être modifié.</p>
         ${v.completedAt ? `<p><strong>Date :</strong> ${escape(v.completedAt)}</p>` : ''}
         ${v.ipAddress ? `<p><strong>Adresse IP :</strong> <code>${escape(v.ipAddress)}</code></p>` : ''}
         <p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:10px;margin-top:14px">
           <strong>Si ce n'est pas vous</strong> qui avez effectué ce changement, contactez immédiatement votre administrateur tenant — votre compte a peut-être été compromis.
         </p>
         <p style="color:#64748b;font-size:13px">Toutes vos sessions actives ont été déconnectées par sécurité.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Your password was changed`,
      body:  `Hello ${v.userName}, your password on ${v.tenantName} has just been changed${v.completedAt ? ` (${v.completedAt})` : ''}. If this wasn't you, contact your administrator immediately.`,
      html:  htmlWrap(
        `Password changed`,
        `<p>Hello ${escape(v.userName)},</p>
         <p>Your password on <strong>${escape(v.tenantName)}</strong> has just been changed.</p>
         ${v.completedAt ? `<p><strong>Date:</strong> ${escape(v.completedAt)}</p>` : ''}
         ${v.ipAddress ? `<p><strong>IP address:</strong> <code>${escape(v.ipAddress)}</code></p>` : ''}
         <p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:10px;margin-top:14px">
           <strong>If this wasn't you</strong>, contact your tenant administrator immediately — your account may have been compromised.
         </p>
         <p style="color:#64748b;font-size:13px">All your active sessions have been signed out for security.</p>`,
      ),
    }),
  },

  // ─── 3. Email verification ─────────────────────────────────────────────────
  'auth.email_verification': {
    fr: (v) => ({
      title: `Vérifiez votre adresse email`,
      body:  `Bonjour ${v.userName}, confirmez votre adresse email sur ${v.tenantName} en cliquant sur le lien dans le mail.`,
      html:  htmlWrap(
        `Confirmez votre email`,
        `<p>Bonjour ${escape(v.userName)},</p>
         <p>Pour finaliser la mise à jour de votre adresse email sur <strong>${escape(v.tenantName)}</strong>, cliquez sur le bouton ci-dessous :</p>
         ${safeButton(v.verifyUrl, 'Confirmer mon email')}
         <p style="color:#64748b;font-size:13px;margin-top:18px">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Verify your email address`,
      body:  `Hello ${v.userName}, confirm your email on ${v.tenantName} by clicking the link in the email.`,
      html:  htmlWrap(
        `Verify your email`,
        `<p>Hello ${escape(v.userName)},</p>
         <p>To finalise your email update on <strong>${escape(v.tenantName)}</strong>, click the button below:</p>
         ${safeButton(v.verifyUrl, 'Verify my email')}
         <p style="color:#64748b;font-size:13px;margin-top:18px">If you didn't request this, ignore this message.</p>`,
      ),
    }),
  },

  // ─── 4. MFA enabled (alerte sécu) ─────────────────────────────────────────
  'auth.mfa.enabled': {
    fr: (v) => ({
      title: `Authentification à deux facteurs activée`,
      body:  `Bonjour ${v.userName}, l'authentification à deux facteurs (${v.factor}) vient d'être activée sur votre compte ${v.tenantName}. Si ce n'est pas vous, contactez immédiatement votre administrateur.`,
      html:  htmlWrap(
        `2FA activée`,
        `<p>Bonjour ${escape(v.userName)},</p>
         <p>L'authentification à deux facteurs <strong>(${escape(v.factor)})</strong> vient d'être activée sur votre compte <strong>${escape(v.tenantName)}</strong>.</p>
         <p style="background:#ecfdf5;border-left:3px solid #10b981;padding:10px">
           Excellente initiative — votre compte est mieux protégé contre les accès non autorisés.
         </p>
         <p style="color:#64748b;font-size:13px;margin-top:14px">Si ce n'est pas vous qui avez effectué cette action, contactez immédiatement votre administrateur tenant.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Two-factor authentication enabled`,
      body:  `Hello ${v.userName}, two-factor authentication (${v.factor}) has just been enabled on your ${v.tenantName} account. If this wasn't you, contact your administrator immediately.`,
      html:  htmlWrap(
        `2FA enabled`,
        `<p>Hello ${escape(v.userName)},</p>
         <p>Two-factor authentication <strong>(${escape(v.factor)})</strong> has just been enabled on your <strong>${escape(v.tenantName)}</strong> account.</p>
         <p style="background:#ecfdf5;border-left:3px solid #10b981;padding:10px">
           Excellent move — your account is better protected against unauthorised access.
         </p>
         <p style="color:#64748b;font-size:13px;margin-top:14px">If this wasn't you, contact your tenant administrator immediately.</p>`,
      ),
    }),
  },

  // ─── 4b. MFA suggérée (incitation douce, non bloquant) ───────────────────
  // Politique 2026-04-27 : envoyée 1× par staff tenant non-MFA à sa 1re
  // connexion. Ton positif, pas alarmiste. Bouton vers /account?tab=security.
  'auth.mfa.suggested': {
    fr: (v) => ({
      title: `Sécurisez votre compte avec l'authentification à deux facteurs`,
      body:  `Bonjour ${v.userName}, ajoutez un second facteur (code à 6 chiffres via une appli comme Google Authenticator) pour mieux protéger votre compte ${v.tenantName}. C'est rapide (2 minutes) et fortement recommandé. C'est optionnel — vous pouvez l'activer plus tard.`,
      html:  htmlWrap(
        `Sécurisez votre compte`,
        `<p>Bonjour ${escape(v.userName)},</p>
         <p>Bienvenue sur <strong>${escape(v.tenantName)}</strong>. Pour mieux protéger votre compte, nous vous recommandons d'activer l'<strong>authentification à deux facteurs</strong> (2FA).</p>
         <p style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px">
           <strong>Pourquoi ?</strong> Même si quelqu'un découvre votre mot de passe, il lui faudra aussi le code à 6 chiffres généré par votre téléphone pour se connecter.
         </p>
         <p>L'activation prend 2 minutes : scannez un QR code avec une appli (Google Authenticator, 1Password, Authy…) puis entrez le code à 6 chiffres.</p>
         ${safeButton(v.setupUrl, 'Activer la 2FA')}
         <p style="color:#64748b;font-size:13px;margin-top:18px">C'est optionnel et vous pouvez l'activer plus tard depuis Paramètres → Sécurité. Cet email ne vous sera envoyé qu'une seule fois.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Secure your account with two-factor authentication`,
      body:  `Hello ${v.userName}, add a second factor (6-digit code via an app like Google Authenticator) to better protect your ${v.tenantName} account. It's quick (2 minutes) and strongly recommended. Optional — you can enable it later.`,
      html:  htmlWrap(
        `Secure your account`,
        `<p>Hello ${escape(v.userName)},</p>
         <p>Welcome to <strong>${escape(v.tenantName)}</strong>. To better protect your account, we recommend enabling <strong>two-factor authentication</strong> (2FA).</p>
         <p style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px">
           <strong>Why?</strong> Even if someone discovers your password, they will also need the 6-digit code generated by your phone to sign in.
         </p>
         <p>It only takes 2 minutes: scan a QR code with an app (Google Authenticator, 1Password, Authy…) then enter the 6-digit code.</p>
         ${safeButton(v.setupUrl, 'Enable 2FA')}
         <p style="color:#64748b;font-size:13px;margin-top:18px">It's optional and you can enable it later from Settings → Security. This email is only sent once.</p>`,
      ),
    }),
  },

  // ─── 5. MFA disabled (alerte sécu IMPORTANTE) ─────────────────────────────
  'auth.mfa.disabled': {
    fr: (v) => ({
      title: `Authentification à deux facteurs désactivée — vérifiez`,
      body:  `Bonjour ${v.userName}, l'authentification à deux facteurs vient d'être désactivée sur votre compte ${v.tenantName}. Si ce n'est pas vous, contactez immédiatement votre administrateur.`,
      html:  htmlWrap(
        `2FA désactivée — alerte sécurité`,
        `<p>Bonjour ${escape(v.userName)},</p>
         <p>L'authentification à deux facteurs vient d'être <strong>désactivée</strong> sur votre compte <strong>${escape(v.tenantName)}</strong>.</p>
         <p style="background:#fee2e2;border-left:3px solid #ef4444;padding:10px">
           <strong>Action sensible :</strong> votre compte est désormais protégé uniquement par votre mot de passe. Si ce n'est pas vous qui avez fait cette modification, votre compte est peut-être compromis — contactez immédiatement votre administrateur.
         </p>
         <p style="color:#64748b;font-size:13px;margin-top:14px">Pour réactiver le 2FA, allez dans Paramètres → Sécurité.</p>`,
      ),
    }),
    en: (v) => ({
      title: `Two-factor authentication disabled — please verify`,
      body:  `Hello ${v.userName}, two-factor authentication has just been disabled on your ${v.tenantName} account. If this wasn't you, contact your administrator immediately.`,
      html:  htmlWrap(
        `2FA disabled — security alert`,
        `<p>Hello ${escape(v.userName)},</p>
         <p>Two-factor authentication has just been <strong>disabled</strong> on your <strong>${escape(v.tenantName)}</strong> account.</p>
         <p style="background:#fee2e2;border-left:3px solid #ef4444;padding:10px">
           <strong>Sensitive action:</strong> your account is now protected only by your password. If you did not make this change, your account may be compromised — contact your administrator immediately.
         </p>
         <p style="color:#64748b;font-size:13px;margin-top:14px">To re-enable 2FA, go to Settings → Security.</p>`,
      ),
    }),
  },
};

export function renderAuthTemplate(
  templateId: AuthTemplateId,
  lang:       Lang,
  vars:       TemplateVars,
): RenderedTemplate {
  const localeMap = TEMPLATES[templateId];
  return (localeMap[lang] ?? localeMap.fr)(vars);
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
