-- Issue planning timeline. Adds per-issue scheduling fields, a
-- per-project status colour palette, and a per-project label→icon
-- map. The icon map is required before a label can render on the
-- timeline; the UI gates timeline access on the icon map being
-- complete for all in-use labels (similar to the analyser-required
-- banner pattern from migration 0001).

-- ─── per-issue scheduling fields ───────────────────────────────────────────
-- starts_at / ends_at are nullable so existing issues stay
-- "unscheduled" and live in the tray below the timeline. lane_y is a
-- 0..1 fractional position so vertical placement survives across
-- screen sizes — the renderer multiplies by canvas height. color is
-- an optional hex override; null falls back to the project's status
-- palette.
alter table tracker.issues
    add column if not exists starts_at timestamptz,
    add column if not exists ends_at   timestamptz,
    add column if not exists lane_y    real,
    add column if not exists color     text;

alter table tracker.issues
    drop constraint if exists issues_lane_y_fraction;
alter table tracker.issues
    add constraint issues_lane_y_fraction
    check (lane_y is null or (lane_y >= 0 and lane_y <= 1));

alter table tracker.issues
    drop constraint if exists issues_schedule_ordering;
alter table tracker.issues
    add constraint issues_schedule_ordering
    check (
        starts_at is null
        or ends_at is null
        or ends_at >= starts_at
    );

alter table tracker.issues
    drop constraint if exists issues_color_hex;
alter table tracker.issues
    add constraint issues_color_hex
    check (color is null or color ~ '^#[0-9a-fA-F]{6}$');

create index if not exists issues_project_starts_idx
    on tracker.issues(project_id, starts_at);

-- ─── per-project status colour palette ────────────────────────────────────
-- Lets the user override the default status→colour map. Falls back
-- to the UI's hardcoded defaults (purple = open, amber = waiting,
-- red = blocked, etc) when no row is present.
create table if not exists tracker.project_status_colors (
    project_id  uuid        not null references tracker.projects(id) on delete cascade,
    status      tracker.issue_status not null,
    color       text        not null,
    updated_at  timestamptz not null default now(),
    primary key (project_id, status),
    constraint psc_color_hex check (color ~ '^#[0-9a-fA-F]{6}$')
);

drop trigger if exists touch_project_status_colors on tracker.project_status_colors;
create trigger touch_project_status_colors
    before update on tracker.project_status_colors
    for each row execute function tracker.touch_updated_at();

-- ─── per-project label→icon map ───────────────────────────────────────────
-- icon_name is an Iconly Bold icon identifier (see lib/iconly.ts in
-- the app). Required before a label can render on the timeline.
create table if not exists tracker.project_label_icons (
    project_id  uuid        not null references tracker.projects(id) on delete cascade,
    label       text        not null,
    icon_name   text        not null,
    color       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    primary key (project_id, label),
    constraint pli_label_not_empty check (length(trim(label)) > 0),
    constraint pli_color_hex       check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);

drop trigger if exists touch_project_label_icons on tracker.project_label_icons;
create trigger touch_project_label_icons
    before update on tracker.project_label_icons
    for each row execute function tracker.touch_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
alter table tracker.project_status_colors enable row level security;
alter table tracker.project_label_icons   enable row level security;

drop policy if exists project_status_colors_owner_all on tracker.project_status_colors;
create policy project_status_colors_owner_all on tracker.project_status_colors
    for all
    using      (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()))
    with check (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists project_label_icons_owner_all on tracker.project_label_icons;
create policy project_label_icons_owner_all on tracker.project_label_icons
    for all
    using      (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()))
    with check (exists (select 1 from tracker.projects p where p.id = project_id and p.user_id = auth.uid()));

grant all on tracker.project_status_colors to authenticated, service_role;
grant all on tracker.project_label_icons   to authenticated, service_role;
