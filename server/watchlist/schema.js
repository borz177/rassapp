async function ensureTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_watchlist_settings (
      id int PRIMARY KEY CHECK(id=1), version int NOT NULL DEFAULT 1,
      mode text NOT NULL DEFAULT 'off' CHECK(mode IN ('off','pilot','on')),
      legal_ready boolean NOT NULL DEFAULT false, legal_reference jsonb,
      search_paused boolean NOT NULL DEFAULT false, submissions_paused boolean NOT NULL DEFAULT false,
      auto_publish boolean NOT NULL DEFAULT false,
      search_limit int NOT NULL DEFAULT 30 CHECK(search_limit BETWEEN 1 AND 100),
      publication_days int NOT NULL DEFAULT 90 CHECK(publication_days BETWEEN 7 AND 90),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE client_watchlist_settings ADD COLUMN IF NOT EXISTS auto_publish boolean NOT NULL DEFAULT false;
    ALTER TABLE client_watchlist_settings ADD COLUMN IF NOT EXISTS publication_until_removed boolean NOT NULL DEFAULT false;
    INSERT INTO client_watchlist_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS client_watchlist_access (
      user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      status text NOT NULL CHECK(status IN ('requested','granted','rejected','revoked')),
      can_search boolean NOT NULL DEFAULT true, can_submit boolean NOT NULL DEFAULT true,
      pilot boolean NOT NULL DEFAULT false, version int NOT NULL DEFAULT 1,
      decision jsonb, requested_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS client_watchlist_acceptances (
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, version text NOT NULL,
      accepted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,version)
    );
    CREATE TABLE IF NOT EXISTS client_watchlist_entries (
      id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id text NOT NULL, payload jsonb, name_index text, year_index text,
      source_fingerprint text, status text NOT NULL CHECK(status IN ('pending','needs_info','published','hidden','rejected','withdrawn','terminated','expired')),
      version int NOT NULL DEFAULT 1, policy_version text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz, expires_at timestamptz,
      deleted_at timestamptz, review_required boolean NOT NULL DEFAULT false
    );
    ALTER TABLE client_watchlist_entries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    ALTER TABLE client_watchlist_entries ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false;
    CREATE UNIQUE INDEX IF NOT EXISTS client_watchlist_entry_active ON client_watchlist_entries(owner_id,customer_id)
      WHERE status IN ('pending','needs_info','published','hidden');
    CREATE INDEX IF NOT EXISTS client_watchlist_name ON client_watchlist_entries(name_index) WHERE status='published';
    CREATE INDEX IF NOT EXISTS client_watchlist_year ON client_watchlist_entries(year_index) WHERE status='published';
    CREATE INDEX IF NOT EXISTS client_watchlist_owner ON client_watchlist_entries(owner_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS client_watchlist_appeals (
      id text PRIMARY KEY, entry_id text NOT NULL REFERENCES client_watchlist_entries(id) ON DELETE CASCADE,
      reporter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload jsonb, status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','resolved')),
      version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS client_watchlist_appeal_active ON client_watchlist_appeals(entry_id,reporter_id) WHERE status<>'resolved';
    CREATE TABLE IF NOT EXISTS client_watchlist_events (
      id bigserial PRIMARY KEY, actor_id text, action text NOT NULL, target_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS client_watchlist_events_time ON client_watchlist_events(created_at DESC);
    UPDATE client_watchlist_entries e SET review_required=true WHERE NOT review_required AND (
      status IN ('needs_info','hidden','rejected','terminated') OR EXISTS(
        SELECT 1 FROM client_watchlist_events v WHERE v.target_id=e.id AND
          v.action IN ('ENTRY_NEEDS_INFO','ENTRY_HIDE','ENTRY_REJECT','ENTRY_TERMINATE','ENTRY_DELETED')));
    CREATE TABLE IF NOT EXISTS client_watchlist_limits (
      user_id text NOT NULL, action text NOT NULL, bucket bigint NOT NULL, count int NOT NULL, expires_at timestamptz NOT NULL,
      PRIMARY KEY(user_id,action,bucket)
    );
    CREATE TABLE IF NOT EXISTS client_watchlist_admin_sessions (
      digest text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      auth_digest text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS client_watchlist_admin_factors (
      user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, last_counter bigint NOT NULL
    );
  `);
}
module.exports = { ensureTables };
