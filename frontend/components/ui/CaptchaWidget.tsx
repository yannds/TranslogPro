/**
 * CaptchaWidget — Conteneur React pour le widget Turnstile.
 *
 * Usage :
 *   const [token, setToken] = useState<string | null>(null);
 *   <CaptchaWidget onToken={setToken} />
 *
 * Si la site-key Cloudflare n'est pas configurée (env absente), le widget
 * ne rend rien — le caller peut continuer à soumettre le formulaire ; le
 * backend applique alors un fail-open si `tenantBusinessConfig.captchaEnabled=false`.
 */
import { useEffect, useRef } from 'react';
import { useTurnstile } from '../../lib/captcha/useTurnstile';

export interface CaptchaWidgetProps {
  /** Callback quand le token est émis/revalidé. Null = expiré ou erreur. */
  onToken:   (token: string | null) => void;
  /** Site key Turnstile (défaut: VITE_TURNSTILE_SITE_KEY). */
  siteKey?:  string;
  theme?:    'light' | 'dark' | 'auto';
  size?:     'normal' | 'compact' | 'invisible';
  className?: string;
}

export function CaptchaWidget({ onToken, siteKey, theme = 'auto', size = 'normal', className }: CaptchaWidgetProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { ready, token, render } = useTurnstile({ siteKey, theme, size });

  useEffect(() => { render(containerRef.current); }, [render, ready]);
  useEffect(() => { onToken(token); }, [token, onToken]);

  // Pas de site key → pas de widget (silencieux). Le backend doit fail-open.
  const effectiveKey = siteKey ?? (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY : undefined);
  if (!effectiveKey) return null;

  return <div ref={containerRef} className={className} data-testid="captcha-widget" />;
}
