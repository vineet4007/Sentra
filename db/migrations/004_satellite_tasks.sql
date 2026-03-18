CREATE TABLE IF NOT EXISTS satellite_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_key VARCHAR(128) NOT NULL DEFAULT 'default',
  satellite_id BIGINT UNSIGNED NOT NULL,
  deployment_id BIGINT UNSIGNED NULL,
  task_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  payload JSON NOT NULL,
  result JSON NULL,
  error_message TEXT NULL,
  created_by VARCHAR(255) NULL,
  lease_owner VARCHAR(255) NULL,
  lease_expires_at TIMESTAMP NULL DEFAULT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  claimed_at TIMESTAMP NULL DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_satellite_tasks_satellite_status (satellite_id, status, created_at),
  KEY idx_satellite_tasks_tenant_status (tenant_key, status, created_at),
  KEY idx_satellite_tasks_deployment_id (deployment_id),
  KEY idx_satellite_tasks_lease_expires_at (lease_expires_at),
  CONSTRAINT fk_satellite_tasks_satellite_id
    FOREIGN KEY (satellite_id) REFERENCES satellites(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_satellite_tasks_deployment_id
    FOREIGN KEY (deployment_id) REFERENCES deployments(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('004', 'Federated satellite task queue');
