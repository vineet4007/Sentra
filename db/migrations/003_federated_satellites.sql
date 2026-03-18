CREATE TABLE IF NOT EXISTS satellites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_key VARCHAR(128) NOT NULL DEFAULT 'default',
  name VARCHAR(255) NOT NULL,
  mode VARCHAR(32) NOT NULL DEFAULT 'satellite',
  cloud VARCHAR(64) NULL,
  region VARCHAR(128) NULL,
  cluster_name VARCHAR(255) NULL,
  endpoint_url VARCHAR(500) NULL,
  version VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'online',
  heartbeat_interval_sec INT UNSIGNED NOT NULL DEFAULT 30,
  capabilities JSON NULL,
  labels JSON NULL,
  summary JSON NULL,
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_satellites_tenant_name (tenant_key, name),
  KEY idx_satellites_tenant_key (tenant_key),
  KEY idx_satellites_status (status),
  KEY idx_satellites_last_seen_at (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('003', 'Federated satellites registry');
