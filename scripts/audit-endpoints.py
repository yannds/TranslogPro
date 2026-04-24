#!/usr/bin/env python3
"""
Audit TransLog Pro endpoints — couverture backend ↔ frontend.

Extrait toutes les routes @Controller/@Get/@Post/@Patch/@Delete/@Put de src/
et les compare aux appels apiPost/apiPatch/apiDelete/useFetch/apiFetch/fetch()
du frontend, en tenant compte des URL construites par concaténation
(`const base = `/api/...` ; apiPost(`${base}/foo`, …)).

Classifie le résultat en 3 catégories :
  - **vraiment orphelin** : aucune trace textuelle du path dans le FE
  - **probablement monté** : match strict manqué mais path présent littéralement (window.open,
    href, ternary, service client…)
  - **monté** : match strict verb+segments

Limites : couche services client très abstraite, URL runtime pures, helpers inline.

Usage :  python3 scripts/audit-endpoints.py
Produit : docs/AUDIT_ENDPOINTS_<date>.md
"""
import re
import glob
import os
from collections import defaultdict
from datetime import date

VERB_FUNCS = {
    'apiPost': 'POST', 'apiPatch': 'PATCH', 'apiDelete': 'DELETE', 'apiPut': 'PUT',
    'useFetch': 'GET', 'apiGet': 'GET', 'apiFetch': 'ANY',
}

NO_UI_PREFIXES = [
    ('/webhooks', 'Webhooks externes'),
    ('/auth/impersonate/exchange', 'Redirect cross-subdomain'),
    ('/auth/callback', 'OAuth callback'),
    ('/verify/ticket', 'QR code public'),
    ('/verify/parcel', 'QR code public'),
    ('/admin/dlq', 'Admin DLQ'),
    ('/crm/claim', 'Magic link consommé via redirect'),
    ('/crm/retro-claim', 'Portail voyageur'),
    ('/platform/bootstrap', 'CLI init'),
    ('/health', 'Healthcheck infra'),
    ('/metrics', 'Prometheus scrape'),
]


def extract_backend():
    routes = []
    for ts in glob.glob('src/**/*.ts', recursive=True):
        if '/test/' in ts or '.spec.' in ts or '.d.ts' in ts:
            continue
        try:
            with open(ts, encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
        except Exception:
            continue
        prefix = None
        for i, line in enumerate(lines):
            mc = re.search(r"@Controller\(\s*['\"]([^'\"]*)['\"]", line)
            if mc:
                prefix = mc.group(1)
            mh = re.search(r"@(Get|Post|Patch|Delete|Put)\(\s*(?:['\"]([^'\"]*)['\"])?\s*\)", line)
            if mh and prefix is not None:
                verb = mh.group(1).upper()
                path = mh.group(2) or ''
                full = ('/' + prefix + ('/' + path if path else '')).replace('//', '/').rstrip('/')
                norm = re.sub(r':[^/]+', ':X', full)
                routes.append((verb, norm, full, ts, i + 1))
    return routes


def extract_frontend():
    claims = set()
    full_fe_chunks = []
    for fpath in (glob.glob('frontend/**/*.ts', recursive=True)
                  + glob.glob('frontend/**/*.tsx', recursive=True)):
        if 'node_modules' in fpath:
            continue
        try:
            with open(fpath, encoding='utf-8', errors='ignore') as f:
                txt = f.read()
        except Exception:
            continue
        full_fe_chunks.append(txt)

        base_vars = {}
        for m in re.finditer(r"(?:const|let|var)\s+(\w+)\s*=[^;]*?`(/api/[^`]+)`", txt):
            norm = re.sub(r"\$\{[^}]+\}", ":X", m.group(2)).rstrip('/')
            base_vars[m.group(1)] = norm
        changed = True
        while changed:
            changed = False
            for m in re.finditer(r"(?:const|let|var)\s+(\w+)\s*=[^;]*?`\$\{(\w+)\}([^`]*)`", txt):
                name, ref, tail = m.group(1), m.group(2), m.group(3)
                if ref in base_vars and name not in base_vars:
                    norm = re.sub(r"\$\{[^}]+\}", ":X", tail).rstrip('/')
                    base_vars[name] = base_vars[ref] + norm
                    changed = True

        for m in re.finditer(r"[`'\"](/api/[^`'\"]+)", txt):
            norm = re.sub(r"\$\{[^}]+\}", ":X", m.group(1)).split('?')[0].rstrip('/')
            claims.add(('ANY', norm))

        for m in re.finditer(r"`\$\{(\w+)\}([^`]*)`", txt):
            ref, suffix = m.group(1), m.group(2)
            if ref in base_vars:
                norm = base_vars[ref] + re.sub(r"\$\{[^}]+\}", ":X", suffix).split('?')[0].rstrip('/')
                claims.add(('ANY', norm))

        for fname, verb in VERB_FUNCS.items():
            for m in re.finditer(rf"\b{fname}\s*\(\s*[`'\"]([^`'\"]*?)[`'\"]", txt):
                raw = m.group(1)
                if raw.startswith('/api/'):
                    norm = re.sub(r"\$\{[^}]+\}", ":X", raw).split('?')[0].rstrip('/')
                    claims.add((verb, norm))
            for m in re.finditer(rf"\b{fname}\s*\(\s*`\$\{{(\w+)\}}([^`]*)`", txt):
                ref, suffix = m.group(1), m.group(2)
                if ref in base_vars:
                    norm = base_vars[ref] + re.sub(r"\$\{[^}]+\}", ":X", suffix).split('?')[0].rstrip('/')
                    claims.add((verb, norm))

        for m in re.finditer(r"fetch\(\s*[`'\"]([^`'\"]+)[`'\"]([^)]*)\)", txt):
            url, rest = m.group(1), m.group(2)
            if '/api/' not in url and not url.startswith('/'):
                continue
            vm = re.search(r"method\s*:\s*['\"](\w+)['\"]", rest)
            verb = vm.group(1).upper() if vm else 'ANY'
            norm = re.sub(r"\$\{[^}]+\}", ":X", url).split('?')[0].rstrip('/')
            claims.add((verb, norm))

        for m in re.finditer(r"(?:window\.open|window\.location(?:\.href)?\s*=|\.href\s*=|href\s*=\s*\{?)\s*[`'\"]([^`'\"]+)", txt):
            url = m.group(1)
            if '/api/' not in url:
                continue
            norm = re.sub(r"\$\{[^}]+\}", ":X", url).split('?')[0].rstrip('/')
            claims.add(('GET', norm))
        for m in re.finditer(r"(?:window\.open|\.href\s*=|href\s*=\s*\{?)\s*`\$\{(\w+)\}([^`]*)`", txt):
            ref, suffix = m.group(1), m.group(2)
            if ref in base_vars:
                norm = base_vars[ref] + re.sub(r"\$\{[^}]+\}", ":X", suffix).split('?')[0].rstrip('/')
                claims.add(('GET', norm))

    return claims, '\n'.join(full_fe_chunks)


def segments(p):
    if p.startswith('/api'):
        p = p[4:]
    return p.strip('/').split('/') if p else []


def match(verb_b, norm_b, claims):
    sb = segments(norm_b)
    for vc, pc in claims:
        sc = segments(pc)
        if len(sc) != len(sb):
            continue
        if not (vc == verb_b or vc == 'ANY'):
            continue
        ok = True
        for a, c in zip(sb, sc):
            if a == c or a == ':X' or c == ':X':
                continue
            ok = False
            break
        if ok:
            return True
    return False


def literal_in_source(route_norm, full_fe_text):
    parts = route_norm.strip('/').split('/')
    tokens = [p for p in parts if p != ':X']
    if len(tokens) < 2:
        return False
    tail = '/'.join(tokens[-3:]) if len(tokens) >= 3 else '/'.join(tokens[-2:])
    return tail in full_fe_text


def classify(path):
    for pre, reason in NO_UI_PREFIXES:
        if path.startswith(pre):
            return reason
    return None


def main():
    routes = extract_backend()
    claims, full_fe = extract_frontend()
    unmounted_strict = [r for r in routes if not match(r[0], r[1], claims)]
    unmounted = []
    likely = []
    for r in unmounted_strict:
        if literal_in_source(r[1], full_fe):
            likely.append(r)
        else:
            unmounted.append(r)
    mounted = len(routes) - len(unmounted_strict)

    missing_be = []
    for v, p in claims:
        if v == 'ANY':
            continue
        sp = segments(p)
        found = False
        for bv, bn, *_ in routes:
            if bv != v:
                continue
            sb = segments(bn)
            if len(sb) != len(sp):
                continue
            ok = True
            for a, c in zip(sb, sp):
                if a == c or a == ':X' or c == ':X':
                    continue
                ok = False
                break
            if ok:
                found = True
                break
        if not found:
            missing_be.append((v, p))

    doubt = defaultdict(list)
    legit = defaultdict(list)
    likely_by_mod = defaultdict(list)

    def modkey(ts):
        if ts.startswith('src/modules/'):
            return ts.split('/')[2]
        if ts.startswith('src/core/'):
            return 'core/' + ts.split('/')[2]
        if ts.startswith('src/infrastructure/'):
            return 'infra/' + ts.split('/')[2]
        return ts.split('/')[1]

    for v, n, full, ts, ln in likely:
        likely_by_mod[modkey(ts)].append({'verb': v, 'path': full, 'file': ts, 'line': ln})
    for v, n, full, ts, ln in unmounted:
        reason = classify(full)
        entry = {'verb': v, 'path': full, 'file': ts, 'line': ln, 'reason': reason}
        (legit if reason else doubt)[modkey(ts)].append(entry)

    today = date.today().isoformat()
    out = []
    out.append(f"# Audit endpoints — TransLog Pro")
    out.append(f"")
    out.append(f"_Généré le {today} par `scripts/audit-endpoints.py`. Reproduire : `python3 scripts/audit-endpoints.py`._")
    out.append(f"")
    out.append(f"## Résumé")
    out.append(f"")
    out.append(f"| Métrique | Valeur |")
    out.append(f"|---|---|")
    out.append(f"| Routes backend total | **{len(routes)}** |")
    out.append(f"| Routes **montées** (match strict verb+path) | **{mounted}** |")
    out.append(f"| Routes **probablement montées** (trace littérale trouvée dans FE) | **{len(likely)}** |")
    out.append(f"| Routes **vraiment orphelines** (zéro trace FE) | **{len(unmounted)}** |")
    out.append(f"| Appels FE **sans route BE** correspondante | **{len(missing_be)}** |")
    out.append(f"")
    out.append(f"> **Lecture** : seuls les items de la §1 sont à traiter (vraiment orphelins, zéro référence FE). Les items §2 sont probablement consommés par `window.open`, `<a href>`, ternary, ou un service client abstrait — vérifier si un doute subsiste.")
    out.append(f"")
    out.append(f"## 1 · Routes backend vraiment orphelines (zéro trace FE)")
    out.append(f"")
    out.append(f"- Avec motif légitime no-UI : **{sum(len(v) for v in legit.values())}**")
    out.append(f"- **À vérifier manuellement** : **{sum(len(v) for v in doubt.values())}**")
    out.append(f"")
    for i, (mod, items) in enumerate(sorted(doubt.items(), key=lambda kv: -len(kv[1])), 1):
        out.append(f"### 1.{i} · `{mod}` ({len(items)} routes)")
        out.append(f"")
        out.append(f"| Verb | Route | Source |")
        out.append(f"|---|---|---|")
        for it in sorted(items, key=lambda x: x['path']):
            out.append(f"| `{it['verb']}` | `{it['path']}` | [{os.path.basename(it['file'])}:{it['line']}]({it['file']}#L{it['line']}) |")
        out.append(f"")
    if any(legit.values()):
        out.append(f"### 1.∞ · Routes légitimes sans UI ({sum(len(v) for v in legit.values())})")
        out.append(f"")
        out.append(f"| Verb | Route | Motif | Source |")
        out.append(f"|---|---|---|---|")
        for mod, items in sorted(legit.items()):
            for it in sorted(items, key=lambda x: x['path']):
                out.append(f"| `{it['verb']}` | `{it['path']}` | {it['reason']} | [{os.path.basename(it['file'])}:{it['line']}]({it['file']}#L{it['line']}) |")
        out.append(f"")

    out.append(f"## 2 · Routes probablement montées via pattern non standard")
    out.append(f"")
    out.append(f"Path trouvé littéralement dans le FE mais non associé à un `apiPost/apiPatch/...`. Causes habituelles : `window.open` (PDFs), `<a href>`, ternary sur `base`, service client abstrait. **En général OK, pas d'action.**")
    out.append(f"")
    if likely_by_mod:
        out.append(f"| Module | Routes | Détail (3 premiers) |")
        out.append(f"|---|---|---|")
        for mod, items in sorted(likely_by_mod.items(), key=lambda kv: -len(kv[1])):
            sample = ', '.join(f"`{it['verb']} {it['path'].split('/')[-1]}`" for it in items[:3])
            out.append(f"| `{mod}` | {len(items)} | {sample}{'…' if len(items) > 3 else ''} |")
        out.append(f"")
    else:
        out.append(f"_Aucune._")
        out.append(f"")

    out.append(f"## 3 · Appels frontend sans route backend (= 404 en runtime)")
    out.append(f"")
    out.append(f"Si réels (pas du code mort / préfixe erroné), ces appels échouent en production. À trancher : supprimer l'appel FE, ou ajouter la route BE.")
    out.append(f"")
    if missing_be:
        out.append(f"| Verb | URL réclamée |")
        out.append(f"|---|---|")
        for v, p in sorted(missing_be, key=lambda x: x[1]):
            out.append(f"| `{v}` | `{p}` |")
        out.append(f"")
    else:
        out.append(f"_Aucun._")
        out.append(f"")

    out.append(f"## 4 · Méthode")
    out.append(f"")
    out.append(f"Script Python, extraction statique AST-light via regex. Trois passes FE :")
    out.append(f"")
    out.append(f"1. URLs littérales `/api/...` et variables de base `const base = \\`/api/...\\``")
    out.append(f"2. Appels typés `apiPost / apiPatch / apiDelete / apiPut / apiGet / useFetch / apiFetch` + expansion de `${{base}}/suffix`")
    out.append(f"3. Ouvertures directes `window.open`, `<a href>`, `.href = `, `window.location.href`")
    out.append(f"")
    out.append(f"Fallback littéral : si le script rate le match strict mais que le suffixe significatif (2-3 segments) apparaît quelque part dans le source FE, la route est classée §2 et non §1.")
    out.append(f"")

    outfile = f'docs/AUDIT_ENDPOINTS_{today}.md'
    os.makedirs('docs', exist_ok=True)
    with open(outfile, 'w') as f:
        f.write('\n'.join(out))
    print(f"✓ {outfile} ({len(out)} lignes)")
    print(f"  routes={len(routes)}  mounted={mounted}  likely={len(likely)}  orphan={len(unmounted)}  missing_be={len(missing_be)}")


if __name__ == '__main__':
    main()
