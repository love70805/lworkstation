-- Workspace-level configuration for the configurable sales-status flow.
-- The JSON value mirrors the local workspace setting so existing product rows
-- can keep their stable salesStatus IDs without a destructive migration.

alter table public.workspaces
  add column if not exists selection_status_definitions jsonb not null default '[]'::jsonb;

alter table public.workspaces
  add constraint workspaces_selection_status_definitions_array
  check (jsonb_typeof(selection_status_definitions) = 'array');
