#!/usr/bin/env bash
# dev-phone.sh — lance Metro/Expo pour un téléphone physique sur le même WiFi.
#
# Détecte l'IP locale du Mac (via `ipconfig getifaddr en0` puis `en1`) et
# l'expose via EXPO_PUBLIC_API_BASE_URL, sinon l'app pointe sur localhost et
# le téléphone ne joint jamais le backend.
#
# Usage :
#   ./mobile/scripts/dev-phone.sh                 # WiFi LAN classique
#   ./mobile/scripts/dev-phone.sh --tunnel        # Expo Tunnel (NAT/4G OK)
#   API_HOST=192.168.1.42 ./mobile/scripts/dev-phone.sh   # IP forcée
#   API_BASE_URL=https://staging.translogpro.com  ./mobile/scripts/dev-phone.sh
#
# Prérequis :
#   - Backend NestJS lancé sur le Mac (ou backend distant cible).
#   - Téléphone et Mac sur le même réseau WiFi (sauf --tunnel).
#   - Dev build ou Expo Go déjà installé sur le téléphone.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
APP_DIR="$HERE/../translog-mobile"

# ── 1. Détermination de l'API base URL ──────────────────────────────────────
detect_lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    # macOS : Wi-Fi = en0 (MacBook), Thunderbolt Ethernet = en1
    for iface in en0 en1 en2 en3; do
      ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      if [ -n "$ip" ]; then
        echo "$ip"
        return 0
      fi
    done
  fi
  # Fallback Linux
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}'
  fi
}

if [ -n "${API_BASE_URL:-}" ]; then
  RESOLVED_BASE_URL="$API_BASE_URL"
elif [ -n "${API_HOST:-}" ]; then
  RESOLVED_BASE_URL="http://${API_HOST}:3000"
else
  IP="$(detect_lan_ip)"
  if [ -z "$IP" ]; then
    echo "[dev-phone] ⚠️  Impossible de détecter l'IP locale."
    echo "             Forcez avec API_HOST=192.168.x.x  ou utilisez --tunnel."
    exit 1
  fi
  RESOLVED_BASE_URL="http://${IP}:3000"
fi

# ── 2. Vérif que le backend est joignable ───────────────────────────────────
echo "[dev-phone] API base URL → $RESOLVED_BASE_URL"
if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 2 "${RESOLVED_BASE_URL}/api/health" >/dev/null 2>&1; then
    echo "[dev-phone] ✅  backend joignable depuis le Mac."
  else
    echo "[dev-phone] ⚠️  /api/health KO depuis le Mac — vérifie que le backend"
    echo "             tourne (npm run start:dev) et que le pare-feu autorise"
    echo "             le port 3000 sur le réseau local."
  fi
fi

# ── 3. Lancement Expo ───────────────────────────────────────────────────────
cd "$APP_DIR"

EXPO_ARGS=()
TUNNEL=0
for arg in "$@"; do
  case "$arg" in
    --tunnel) TUNNEL=1 ;;
    *)        EXPO_ARGS+=("$arg") ;;
  esac
done

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
echo "[dev-phone] Scanne le QR avec Expo Go ou ton dev build."

exec npx expo start "${EXPO_ARGS[@]}"
