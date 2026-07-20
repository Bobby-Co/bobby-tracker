-- Per-project icon: a canonical Iconly slug (e.g. 'rocket', 'add-user'), the
-- same value space as tracker.project_label_icons.icon_name. Chosen by the user
-- from the settings page's icon picker and rendered on the projects grid tile
-- and the project header.
--
-- Nullable, no default: a project with no icon set (every existing row, and any
-- created before the user picks one) renders a stable hash-derived glyph in the
-- app instead. Validated app-side against the canonical Iconly set on write
-- (same as label icons), so no DB check constraint is needed here. Existing
-- owner RLS on tracker.projects already covers the new column.

alter table tracker.projects
    add column if not exists icon_name text;
