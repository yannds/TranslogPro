/**
 * useTurnstile — Hook pour intégrer Cloudflare Turnstile (CAPTCHA) dans un formulaire.
 *
 * Usage :
 *   const { ready, token, render, reset } = useTurnstile({
 *     siteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
 *   });
 *   useEffect(() => { render(ref.current); }, [render]);
 *   // onSubmit : attacher `x-captcha-token: token` aux fetch()
 *
 * Le script Turnstile est chargé une fois (singleton). Si la site-key n'est
 * pas configurée (env absente), le hook renvoie `ready=false` — l'appelant
 * doit gérer un fallback "pas de captcha rendu" (backend doit alors tolérer
 * — en dev/local où captchaEnabled=false côté tenant).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: {
        sitekey: string;
        callback:  (token: string) => void;
        'expired-callback'?: () => void;
        'error-callback'?:   () => void;
        theme?: 'light' | 'dark' | 'auto';
        size?:  'normal' | 'compact' | 'invisible';
      }) => string;
      reset:  (id: string) => void;
      remove: (id: string) => void;
    };
    __turnstileLoading?: Promise<void>;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface UseTurnstileOptions {
  /** Site key publique Turnstile (env `VITE_TURNSTILE_SITE_KEY`). */
  siteKey?:  string;
  /** Thème widget. Default 'auto' — suit le thème système. */
  theme?:    'light' | 'dark' | 'auto';
  /** 'invisible' = défi automatique, sans widget visible. */
  size?:     'normal' | 'compact' | 'invisible';
}

export function useTurnstile(opts: UseTurnstileOptions = {}): {
  ready:   boolean;       // true si siteKey + script chargé
  token:   string | null;
  render:  (container: HTMLElement | null) => void;
  reset:   () => void;
} {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const widgetIdRef = useRef<string | null>(null);

  const siteKey = opts.siteKey ?? (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY : undefined);

  // Lazy-load du script Turnstile (singleton global)
  useEffect(() => {
    if (!siteKey) { setReady(false); return; }
    if (typeof window === 'undefined') return;

    if (window.turnstile) { setReady(true); return; }

    if (!window.__turnstileLoading) {
      window.__turnstileLoading = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
        if (existing) { resolve(); return; }
        const script = document.createElement('script');
        script.src   = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload  = () => resolve();
        script.onerror = () => reject(new Error('turnstile_script_load_failed'));
        document.head.appendChild(script);
      });
    }

    void window.__turnstileLoading
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, [siteKey]);

  const render = useCallback((container: HTMLElement | null) => {
    if (!ready || !siteKey || !container || !window.turnstile) return;
    if (widgetIdRef.current) {
      try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
    }
    try {
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: siteKey,
        theme:   opts.theme ?? 'auto',
        size:    opts.size  ?? 'normal',
        callback:           (t) => setToken(t),
        'expired-callback': () => setToken(null),
        'error-callback':   () => setToken(null),
      });
    } catch {
      // noop — on laisse le caller soumettre sans token (backend fail-open si config OFF)
    }
  }, [ready, siteKey, opts.theme, opts.size]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetIdRef.current && window.turnstile) {
      try { window.turnstile.reset(widgetIdRef.current); } catch { /* noop */ }
    }
  }, []);

  // Cleanup à unmount
  useEffect(() => () => {
    if (widgetIdRef.current && window.turnstile) {
      try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
    }
  }, []);

  return { ready, token, render, reset };
}

// ── Helpers pour les fetch sécurisés ────────────────────────────────────────

/** Génère un Idempotency-Key UUID v4 (pour POST publics). */
export function newIdempotencyKey(): string {
  // crypto.randomUUID si dispo, sinon fallback Math.random (suffisant en dev)
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'idk-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Headers standards pour un POST public sécurisé. */
export function securedHeaders(captchaToken: string | null, idempotencyKey?: string): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (captchaToken) h['x-captcha-token'] = captchaToken;
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  return h;
}
