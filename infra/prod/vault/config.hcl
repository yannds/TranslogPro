# ═════════════════════════════════════════════════════════════════════════════
# Vault — Configuration PRODUCTION (raft backend, pas dev-mode)
# ═════════════════════════════════════════════════════════════════════════════
# Après premier démarrage :
#   1. vault operator init      (génère 5 unseal keys + root token — à SAUVEGARDER)
#   2. vault operator unseal    (3 fois avec 3 des 5 keys)
#   3. vault login <root-token>
#   4. Créer les secrets engines + policies (voir runbooks/DAY2_OPS.md)
#
# Les unseal keys et root token sont HORS de ce fichier — stockés off-vault
# (coffre-fort physique, password manager, ou split via Shamir's Secret Sharing).
# ═════════════════════════════════════════════════════════════════════════════

ui = false   # UI désactivée en prod — admin via CLI/API

# ─── Storage raft (autonome, pas de Consul) ──────────────────────────────────
storage "raft" {
    path    = "/vault/data"
    node_id = "translog-vault-1"

    # Retry join si restart (pour quand on passera en cluster HA)
    # retry_join {
    #     leader_api_addr = "http://translog_vault_2:8200"
    # }
}

# ─── Listener HTTP interne (docker network translog_net, pas public) ─────────
listener "tcp" {
    address     = "0.0.0.0:8200"
    tls_disable = true                # TLS géré par Caddy au bord si besoin
    telemetry {
        unauthenticated_metrics_access = false
    }
}

# ─── API addr (utilisé pour Consul/raft cluster announce) ────────────────────
api_addr     = "http://translog_vault:8200"
cluster_addr = "http://translog_vault:8201"

# ─── Audit logs — append-only, ISO 27001 compliance ─────────────────────────
# Activé par `vault audit enable file file_path=/vault/logs/audit.log`
# à la configuration initiale.

# ─── Telemetry (optionnel, pour Prometheus futur) ────────────────────────────
telemetry {
    disable_hostname          = true
    prometheus_retention_time = "30s"
}

# ─── Durcissement ────────────────────────────────────────────────────────────
disable_mlock      = false        # mlock activé (prévient swap des secrets)
default_lease_ttl  = "768h"        # 32 jours max
max_lease_ttl      = "8760h"       # 365 jours absolu

# ─── Plugin directory (pour plugins custom si besoin — optionnel) ─────────────
# plugin_directory = "/vault/plugins"
