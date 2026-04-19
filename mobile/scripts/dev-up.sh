#!/usr/bin/env bash
# dev-up.sh — lance backend + émulateur Android + Metro bundler.
# Usage :  ./mobile/scripts/dev-up.sh

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
AVD_NAME="${AVD_NAME:-translog-pixel6}"

echo "[dev-up] repo root = $ROOT"

# 1. Backend — démarre en background si un port 3000 n'est pas déjà occupé.
if ! lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[dev-up] starting backend on :3000..."
  (cd "$ROOT" && npm run start:dev) &
  BACK_PID=$!
  trap 'kill ${BACK_PID:-0} 2>/dev/null || true' EXIT
else
  echo "[dev-up] backend :3000 already running — skipping"
fi

# 2. Android emulator — uniquement si ADB ne voit aucun device.
if command -v adb >/dev/null 2>&1; then
  if ! adb devices | grep -qE "^(emulator-|[0-9a-f]{8,})"; then
    if command -v emulator >/dev/null 2>&1; then
      echo "[dev-up] starting emulator $AVD_NAME..."
      emulator -avd "$AVD_NAME" -no-audio -gpu swiftshader_indirect >/dev/null 2>&1 &
      EMU_PID=$!
      trap 'kill ${EMU_PID:-0} 2>/dev/null || true; kill ${BACK_PID:-0} 2>/dev/null || true' EXIT
      echo "[dev-up] waiting for emulator..."
      adb wait-for-device
    else
      echo "[dev-up] emulator CLI not in PATH — skipping. iOS Simulator will be used via 'i' shortcut."
    fi
  else
    echo "[dev-up] adb device already connected — skipping emulator"
  fi
else
  echo "[dev-up] adb not installed — Android dev skipped. See mobile/DEVICE_SETUP.md"
fi

# 3. Expo (foreground).
echo "[dev-up] starting Metro / Expo..."
cd "$HERE/../translog-mobile"
npx expo start
