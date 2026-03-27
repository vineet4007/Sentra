CREATE TABLE IF NOT EXISTS ai_advisories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deployment_id BIGINT UNSIGNED NOT NULL,
  engine VARCHAR(64) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  recommendation VARCHAR(32) NOT NULL,
  severity VARCHAR(32) NOT NULL,
  predicted_outcome VARCHAR(32) NOT NULL,
  rollback_probability_pct INT NOT NULL,
  next_step_risk_pct INT NOT NULL,
  risk_score INT NOT NULL,
  confidence_pct INT NOT NULL,
  summary TEXT NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_ai_advisory_fingerprint (deployment_id, fingerprint),
  KEY idx_ai_advisories_deployment_created (deployment_id, created_at),
  CONSTRAINT fk_ai_advisories_deployment
    FOREIGN KEY (deployment_id) REFERENCES deployments(id)
    ON DELETE CASCADE
);

INSERT IGNORE INTO schema_migrations (version) VALUES ('005');
