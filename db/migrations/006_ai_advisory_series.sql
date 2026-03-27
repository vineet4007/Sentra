ALTER TABLE ai_advisories
  ADD COLUMN series VARCHAR(32) NOT NULL DEFAULT 'primary' AFTER mode;

ALTER TABLE ai_advisories
  DROP INDEX uniq_ai_advisory_fingerprint,
  ADD UNIQUE KEY uniq_ai_advisory_fingerprint (deployment_id, engine, series, fingerprint),
  ADD KEY idx_ai_advisories_series_created (series, created_at),
  ADD KEY idx_ai_advisories_deployment_series_created (deployment_id, series, created_at);

INSERT IGNORE INTO schema_migrations (version) VALUES ('006');
