ALTER TABLE projects
  ADD COLUMN tenant_key VARCHAR(128) NOT NULL DEFAULT 'default' AFTER id,
  ADD KEY idx_projects_tenant_key (tenant_key);

ALTER TABLE projects
  DROP INDEX uq_projects_name,
  ADD UNIQUE KEY uq_projects_tenant_name (tenant_key, name);

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('002', 'Add tenant scoping to projects');
