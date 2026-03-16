CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(32) NOT NULL,
  description VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  repo_url VARCHAR(500) NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_projects_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS services (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  adapter_type VARCHAR(64) NOT NULL DEFAULT 'kubernetes',
  service_config JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_services_project_name (project_id, name),
  KEY idx_services_project_id (project_id),
  CONSTRAINT fk_services_project_id
    FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS environments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(64) NOT NULL,
  deployment_target_type VARCHAR(64) NOT NULL DEFAULT 'kubernetes',
  deployment_target_config JSON NULL,
  telemetry_source_config JSON NULL,
  telemetry_label_map JSON NULL,
  secret_refs JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_environments_project_name (project_id, name),
  KEY idx_environments_project_id (project_id),
  CONSTRAINT fk_environments_project_id
    FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  service_id BIGINT UNSIGNED NOT NULL,
  environment_id BIGINT UNSIGNED NOT NULL,
  slo_config JSON NOT NULL,
  rollout_steps JSON NOT NULL,
  evaluation_window_sec INT UNSIGNED NOT NULL DEFAULT 60,
  poll_interval_sec INT UNSIGNED NOT NULL DEFAULT 5,
  warmup_sec INT UNSIGNED NOT NULL DEFAULT 30,
  required_passes INT UNSIGNED NOT NULL DEFAULT 3,
  failure_mode VARCHAR(32) NOT NULL DEFAULT 'rollback',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_policies_service_environment (service_id, environment_id),
  KEY idx_policies_environment_id (environment_id),
  CONSTRAINT fk_policies_service_id
    FOREIGN KEY (service_id) REFERENCES services(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_policies_environment_id
    FOREIGN KEY (environment_id) REFERENCES environments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deployments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  service_id BIGINT UNSIGNED NOT NULL,
  environment_id BIGINT UNSIGNED NOT NULL,
  policy_id BIGINT UNSIGNED NULL,
  image_ref VARCHAR(500) NULL,
  revision VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  initiated_by VARCHAR(255) NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'manual',
  deployment_metadata JSON NULL,
  current_weight TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_decision VARCHAR(32) NULL,
  last_decision_reason TEXT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_deployments_service_id (service_id),
  KEY idx_deployments_environment_id (environment_id),
  KEY idx_deployments_status (status),
  CONSTRAINT fk_deployments_service_id
    FOREIGN KEY (service_id) REFERENCES services(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_deployments_environment_id
    FOREIGN KEY (environment_id) REFERENCES environments(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_deployments_policy_id
    FOREIGN KEY (policy_id) REFERENCES policies(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rollout_steps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deployment_id BIGINT UNSIGNED NOT NULL,
  step_index INT UNSIGNED NOT NULL,
  target_weight TINYINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  decision VARCHAR(32) NULL,
  decision_reason TEXT NULL,
  metrics_snapshot JSON NULL,
  started_at TIMESTAMP NULL DEFAULT NULL,
  evaluated_at TIMESTAMP NULL DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rollout_steps_deployment_step (deployment_id, step_index),
  KEY idx_rollout_steps_status (status),
  CONSTRAINT fk_rollout_steps_deployment_id
    FOREIGN KEY (deployment_id) REFERENCES deployments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS incidents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deployment_id BIGINT UNSIGNED NOT NULL,
  rollout_step_id BIGINT UNSIGNED NULL,
  incident_type VARCHAR(64) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'warning',
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  summary VARCHAR(255) NOT NULL,
  details JSON NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_incidents_deployment_id (deployment_id),
  KEY idx_incidents_rollout_step_id (rollout_step_id),
  KEY idx_incidents_status (status),
  CONSTRAINT fk_incidents_deployment_id
    FOREIGN KEY (deployment_id) REFERENCES deployments(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_incidents_rollout_step_id
    FOREIGN KEY (rollout_step_id) REFERENCES rollout_steps(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deployment_id BIGINT UNSIGNED NULL,
  rollout_step_id BIGINT UNSIGNED NULL,
  actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_id VARCHAR(255) NULL,
  event_type VARCHAR(64) NOT NULL,
  summary VARCHAR(255) NOT NULL,
  details JSON NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_events_deployment_id (deployment_id),
  KEY idx_audit_events_rollout_step_id (rollout_step_id),
  KEY idx_audit_events_event_type (event_type),
  CONSTRAINT fk_audit_events_deployment_id
    FOREIGN KEY (deployment_id) REFERENCES deployments(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_audit_events_rollout_step_id
    FOREIGN KEY (rollout_step_id) REFERENCES rollout_steps(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('001', 'Initial control plane schema');

