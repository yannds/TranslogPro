#!/usr/bin/env bash
# ============================================================
# TransLog Pro — Script d'arrêt propre
#
# Usage :
#   ./scripts/stop.sh           → arrête tout (API + Frontend + Docker)
#   ./scripts/stop.sh --app     → arrête seulement l'API et le Frontend
#   ./scripts/stop.sh --docker  → arrête seulement les containers Docker
# ============================================================

set -e
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${CYAN}ℹ  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }

MODE="${1:-}"

stop_app() {
  info "Arrêt de l'API NestJS..."
  if [ -f /tmp/translog-api.pid ]; then
    API_PID=$(cat /tmp/translog-api.pid)
    if kill -0 "$API_PID" 2>/dev/null; then
      kill "$API_PID" 2>/dev/null && ok "API NestJS arrêtée (PID $API_PID)"
    else
      warn "API NestJS déjà arrêtée (PID $API_PID introuvable)"
    fi
    rm -f /tmp/translog-api.pid
  else
    # Fallback : chercher le process sur le port 3000
    PIDS=$(lsof -ti :3000 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      echo "$PIDS" | xargs kill 2>/dev/null && ok "API NestJS arrêtée (port 3000)"
    else
      warn "Aucun process trouvé sur le port 3000"
    fi
  fi

  info "Arrêt du Frontend Vite..."
  if [ -f /tmp/translog-frontend.pid ]; then
    FRONTEND_PID=$(cat /tmp/translog-frontend.pid)
    if kill -0 "$FRONTEND_PID" 2>/dev/null; then
      kill "$FRONTEND_PID" 2>/dev/null && ok "Frontend Vite arrêté (PID $FRONTEND_PID)"
    else
      warn "Frontend Vite déjà arrêté (PID $FRONTEND_PID introuvable)"
    fi
    rm -f /tmp/translog-frontend.pid
  else
    PIDS=$(lsof -ti :5173 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      echo "$PIDS" | xargs kill 2>/dev/null && ok "Frontend Vite arrêté (port 5173)"
    else
      warn "Aucun process trouvé sur le port 5173"
    fi
  fi
}

stop_docker() {
  info "Arrêt des containers Docker..."
  COMPOSE="docker compose"
  docker compose version >/dev/null 2>&1 || COMPOSE="docker-compose"
  $COMPOSE down --remove-orphans
  ok "Containers Docker arrêtés"
}

echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}   TransLog Pro — Arrêt                   ${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""

case "$MODE" in
  --app)
    stop_app
    ;;
  --docker)
    stop_docker
    ;;
  *)
    stop_app
    stop_docker
    ;;
esac

echo ""
ok "TranslogPro arrêté proprement."
echo ""
echo -e "  Relancer : ${CYAN}./scripts/dev.sh${NC}"
echo ""
