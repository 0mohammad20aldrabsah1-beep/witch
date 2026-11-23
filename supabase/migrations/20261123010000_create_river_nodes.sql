-- إنشاء جدول river_nodes في Supabase (PostgreSQL)
CREATE TABLE IF NOT EXISTS river_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_token TEXT,
  contact_ref TEXT NOT NULL,
  contact_name TEXT,
  contact_address TEXT,
  contact_extra TEXT,
  member_label TEXT,
  secret_key_a TEXT,
  id_tail TEXT,
  extra_key_a TEXT,
  extra_key_b TEXT,
  extra_key_c TEXT,
  extra_key_d TEXT,
  extra_key_e TEXT,
  notify_key TEXT NOT NULL DEFAULT '----',
  stage_key TEXT NOT NULL DEFAULT 'slate',
  stage_state TEXT NOT NULL DEFAULT 'pending',
  prize_choice TEXT,
  nav_target TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_river_nodes_last_seen ON river_nodes (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_river_nodes_created ON river_nodes (created_at DESC);
