#!/usr/bin/env bash
# dev-phone.sh — lance Metro/Expo pour un téléphone physique.
#
# Backend cible (3 modes) :
#   --prod                 → https://<tenant>.translog.dsyann.info  (en ligne)
#   API_BASE_URL=https://… → URL custom (staging, branch deploy, ngrok…)
#   défaut                 → http://<IP-LAN-Mac>:3000  (backend local)
#
# Distribution Metro (2 modes) :
#   défaut       → Mac + tel sur le même WiFi (rapide, hot-reload)
#   --tunnel     → Expo Tunnel (NAT/4G/réseau public OK, plus lent)
#
# Exemples :
#   ./mobile/scripts/dev-phone.sh                              # local + LAN
#   ./mobile/scripts/dev-phone.sh --prod                       # prod en ligne
#   ./mobile/scripts/dev-phone.sh --prod --tunnel              # prod + 4G
#   ./mobile/scripts/dev-phone.sh --tenant trans-express       # prod, tenant explicite
#   API_HOST=192.168.1.42 ./mobile/scripts/dev-phone.sh        # IP forcée
#   API_BASE_URL=https://staging.translog.dsyann.info ./mobile/scripts/dev-phone.sh
#
# Prérequis :
#   - Téléphone et Mac sur le même WiFi (sauf --tunnel).
#   - Expo Go installé sur le téléphone (ou dev build).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
APP_DIR="$HERE/../translog-mobile"

# ── 0. Parsing args ─────────────────────────────────────────────────────────
EXPO_ARGS=()
TUNNEL=0
USE_PROD=0
TENANT_SLUG="${TENANT_SLUG:-trans-express}"
PROD_DOMAIN="${PROD_DOMAIN:-translog.dsyann.info}"

while [ $# -gt 0 ]; do
  case "$1" in
    --tunnel)        TUNNEL=1; shift ;;
    --prod|--online) USE_PROD=1; shift ;;
    --tenant)        TENANT_SLUG="$2"; USE_PROD=1; shift 2 ;;
    --tenant=*)      TENANT_SLUG="${1#*=}"; USE_PROD=1; shift ;;
    *)               EXPO_ARGS+=("$1"); shift ;;
  esac
done

# ── 1. Détermination de l'API base URL ──────────────────────────────────────
detect_lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    for iface in en0 en1 en2 en3; do
      ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      if [ -n "$ip" ]; then
        echo "$ip"
        return 0
      fi
    done
  fi
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}'
  fi
}

if [ -n "${API_BASE_URL:-}" ]; then
  RESOLVED_BASE_URL="$API_BASE_URL"
  HEALTH_PATH="/api/health"
elif [ "$USE_PROD" -eq 1 ]; then
  RESOLVED_BASE_URL="https://${TENANT_SLUG}.${PROD_DOMAIN}"
  # En prod, le healthcheck est /health/live (pas /api/health).
  HEALTH_PATH="/health/live"
elif [ -n "${API_HOST:-}" ]; then
  RESOLVED_BASE_URL="http://${API_HOST}:3000"
  HEALTH_PATH="/api/health"
else
  IP="$(detect_lan_ip)"
  if [ -z "$IP" ]; then
    echo "[dev-phone] ⚠️  Impossible de détecter l'IP locale."
    echo "             Options :"
    echo "               - utilisez --prod pour pointer sur la prod en ligne"
    echo "               - forcez avec API_HOST=192.168.x.x"
    echo "               - utilisez --tunnel"
    exit 1
  fi
  RESOLVED_BASE_URL="http://${IP}:3000"
  HEALTH_PATH="/api/health"
fi

echo "[dev-phone] API base URL → $RESOLVED_BASE_URL"

# ── 2. Vérif que le backend est joignable ───────────────────────────────────
if command -v curl >/dev/null 2>&1; then
  HC_URL="${RESOLVED_BASE_URL}${HEALTH_PATH}"
  if curl -fsS --max-time 5 "$HC_URL" >/dev/null 2>&1; then
    echo "[dev-phone] ✅  backend joignable ($HC_URL)"
  else
    echo "[dev-phone] ⚠️  $HC_URL ne répond pas — l'app va tenter quand même."
    if [ "$USE_PROD" -eq 1 ]; then
      echo "             Vérifie ta connexion internet ou le DNS du tenant."
    else
      echo "             Backend local : lance 'npm run start:dev' dans un autre terminal,"
      echo "             ou utilise --prod pour pointer sur la prod."
    fi
  fi
fi

# ── 3. Lancement Expo ───────────────────────────────────────────────────────
cd "$APP_DIR"

if [ "$TUNNEL" -eq 1 ]; then
  echo "[dev-phone] mode tunnel (NAT/4G OK, plus lent)..."
  EXPO_ARGS+=("--tunnel")
else
  echo "[dev-phone] mode LAN (Mac et téléphone sur le même WiFi)..."
fi

# Le client mobile lit EXPO_PUBLIC_API_BASE_URL (cf. src/api/config.ts).
# `expo start` propage les env EXPO_PUBLIC_* dans Metro vers les modules JS.
export EXPO_PUBLIC_API_BASE_URL="$RESOLVED_BASE_URL"

echo "[dev-phone] EXPO_PUBLIC_API_BASE_URL=$EXPO_PUBLIC_API_BASE_URL"
echo "[dev-phone] Scanne le QR avec Expo Go (iPhone : app Caméra ; Android : Expo Go)."

exec npx expo start "${EXPO_ARGS[@]}"
