/**
 * BriefingSignatureInput — saisie signature pour briefing pré-voyage v2.
 *
 * Trois méthodes au choix du chauffeur (toutes compatibles avec le payload
 * v2 `{ method, blob, acknowledgedById }`) :
 *
 *   - DRAW      : réutilise <SignaturePad /> (canvas SVG existant).
 *                 blob = SVG string.
 *   - PIN       : code 4-8 chiffres hashé sha-256 côté client.
 *                 blob = hex sha-256 (64 chars).
 *   - BIOMETRIC : stub WebAuthn (navigator.credentials.get).
 *                 blob = credential id opaque.
 *
 * Le parent fournit `acknowledgedById` (user.id du chauffeur) et récupère
 * `{ method, blob, isReady }` via `onChange`.
 *
 * Test récursif signature dessin : un test Playwright (test/playwright/
 * briefing-driver-signature.*) trace, sauvegarde, recharge et vérifie
 * l'affichage du SVG — exigence produit (le dessin a historiquement cassé).
 */

import { useEffect, useRef, useState } from 'react';
import { PenTool, Hash, Fingerprint } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from './Button';
import { inputClass } from './inputClass';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

export type BriefingSignatureMethod = 'DRAW' | 'PIN' | 'BIOMETRIC';

export interface BriefingSignatureValue {
  method:  BriefingSignatureMethod;
  blob:    string; // SVG | sha-256 hex | credential id
  isReady: boolean;
}

export interface BriefingSignatureInputProps {
  value?:        BriefingSignatureValue | null;
  onChange:      (v: BriefingSignatureValue) => void;
  allowedMethods?: BriefingSignatureMethod[];
  /** Hook tenant pour WebAuthn custom (sinon stub navigator.credentials). */
  biometricFn?:  () => Promise<string>;
}

const DEFAULT_METHODS: BriefingSignatureMethod[] = ['DRAW', 'PIN', 'BIOMETRIC'];

export function BriefingSignatureInput(props: BriefingSignatureInputProps) {
  const { t } = useI18n();
  const allowed = props.allowedMethods ?? DEFAULT_METHODS;
  const [method, setMethod] = useState<BriefingSignatureMethod>(
    (props.value?.method && allowed.includes(props.value.method)) ? props.value.method : allowed[0],
  );

  return (
    <div className="space-y-3" data-testid="briefing-signature">
      {allowed.length > 1 && (
        <div className="flex gap-1 flex-wrap" role="tablist" aria-label={t('driverBriefing.signatureMethodLabel')}>
          {allowed.map(m => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-pressed={method === m}
              onClick={() => setMethod(m)}
              data-testid={`signature-method-${m.toLowerCase()}`}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm border transition ${
                method === m
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400'
              }`}
            >
              {m === 'DRAW'      && <><PenTool     className="w-4 h-4" aria-hidden="true" /> {t('driverBriefing.methodDraw')}</>}
              {m === 'PIN'       && <><Hash        className="w-4 h-4" aria-hidden="true" /> {t('driverBriefing.methodPin')}</>}
              {m === 'BIOMETRIC' && <><Fingerprint className="w-4 h-4" aria-hidden="true" /> {t('driverBriefing.methodBiometric')}</>}
            </button>
          ))}
        </div>
      )}

      {method === 'DRAW'      && <DrawSubField onChange={props.onChange} />}
      {method === 'PIN'       && <PinSubField onChange={props.onChange} />}
      {method === 'BIOMETRIC' && <BiometricSubField biometricFn={props.biometricFn} onChange={props.onChange} />}
    </div>
  );
}

// ─── Sous-champ DRAW ──────────────────────────────────────────────────────

function DrawSubField({ onChange }: { onChange: (v: BriefingSignatureValue) => void }) {
  const { t } = useI18n();
  const padRef = useRef<SignaturePadHandle>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  const capture = () => {
    const svg = padRef.current?.getSvg();
    if (svg) {
      setHasDrawn(true);
      onChange({ method: 'DRAW', blob: svg, isReady: true });
    } else {
      setHasDrawn(false);
      onChange({ method: 'DRAW', blob: '', isReady: false });
    }
  };

  return (
    <div className="space-y-2">
      <SignaturePad ref={padRef} />
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={capture}>
          {hasDrawn ? t('driverBriefing.reCaptureSignature') : t('driverBriefing.captureSignature')}
        </Button>
      </div>
      {hasDrawn && (
        <p className="text-xs text-green-700 dark:text-green-400" role="status" data-testid="signature-captured">
          ✓ {t('driverBriefing.signatureCaptured')}
        </p>
      )}
    </div>
  );
}

// ─── Sous-champ PIN ──────────────────────────────────────────────────────

function PinSubField({ onChange }: { onChange: (v: BriefingSignatureValue) => void }) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const clean = pin.replace(/\D/g, '');
      if (clean.length < 4) {
        onChange({ method: 'PIN', blob: '', isReady: false });
        return;
      }
      const blob = await sha256Hex(clean);
      if (!cancelled) onChange({ method: 'PIN', blob, isReady: true });
    })();
    return () => { cancelled = true; };
  }, [pin, onChange]);

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('driverBriefing.pinLabel')}
        </span>
        <input
          type={show ? 'text' : 'password'}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{4,8}"
          className={inputClass}
          data-testid="signature-pin-input"
          aria-label={t('driverBriefing.pinLabel')}
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />
        {t('driverBriefing.pinShow')}
      </label>
    </div>
  );
}

// ─── Sous-champ BIOMETRIC ────────────────────────────────────────────────

function BiometricSubField({
  biometricFn,
  onChange,
}: {
  biometricFn?: () => Promise<string>;
  onChange:     (v: BriefingSignatureValue) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'prompting' | 'ok' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const trigger = async () => {
    setState('prompting'); setErrMsg(null);
    try {
      const token = biometricFn ? await biometricFn() : await defaultWebAuthn();
      setState('ok');
      onChange({ method: 'BIOMETRIC', blob: token, isReady: true });
    } catch (e) {
      setState('err');
      setErrMsg(e instanceof Error ? e.message : String(e));
      onChange({ method: 'BIOMETRIC', blob: '', isReady: false });
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" onClick={trigger} disabled={state === 'prompting'}>
        <Fingerprint className="w-4 h-4 mr-1" aria-hidden="true" />
        {state === 'prompting'
          ? t('driverBriefing.biometricPrompting')
          : state === 'ok'
            ? t('driverBriefing.biometricOk')
            : t('driverBriefing.biometricTrigger')}
      </Button>
      {state === 'err' && errMsg && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">{errMsg}</p>
      )}
    </div>
  );
}

// ─── Helpers crypto ──────────────────────────────────────────────────────

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function defaultWebAuthn(): Promise<string> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn non supporté par ce navigateur');
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge,
      userVerification: 'preferred',
      timeout: 60_000,
    },
  });
  if (!cred) throw new Error('Authentification annulée');
  return (cred as PublicKeyCredential).id;
}
