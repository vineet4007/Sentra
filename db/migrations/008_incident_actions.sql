CREATE TABLE IF NOT EXISTS incident_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  incident_id BIGINT UNSIGNED NOT NULL,
  deployment_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(64) NOT NULL,
  actor_id VARCHAR(255) NULL,
  note TEXT NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_incident_actions_incident_id (incident_id),
  KEY idx_incident_actions_deployment_id (deployment_id),
  KEY idx_incident_actions_action_type_created (action_type, created_at),
  CONSTRAINT fk_incident_actions_incident_id
    FOREIGN KEY (incident_id) REFERENCES incidents(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_incident_actions_deployment_id
    FOREIGN KEY (deployment_id) REFERENCES deployments(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('008', 'Persist incident operator actions');
