CREATE INDEX idx_projects_tenant_created
  ON projects (tenant_key, created_at);

CREATE INDEX idx_services_project_created
  ON services (project_id, created_at);

CREATE INDEX idx_environments_project_created
  ON environments (project_id, created_at);

CREATE INDEX idx_deployments_service_environment_created
  ON deployments (service_id, environment_id, created_at);

CREATE INDEX idx_deployments_status_created
  ON deployments (status, created_at);

CREATE INDEX idx_rollout_steps_deployment_status_step
  ON rollout_steps (deployment_id, status, step_index);

CREATE INDEX idx_incidents_deployment_status_detected
  ON incidents (deployment_id, status, detected_at);

CREATE INDEX idx_audit_events_deployment_occurred
  ON audit_events (deployment_id, occurred_at);

CREATE INDEX idx_audit_events_event_occurred
  ON audit_events (event_type, occurred_at);

CREATE INDEX idx_satellite_tasks_deployment_created
  ON satellite_tasks (deployment_id, created_at);

CREATE INDEX idx_ai_advisories_created
  ON ai_advisories (created_at);

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('007', 'Add read model query indexes');
