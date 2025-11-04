/*
  # Multi-Level Security Access Control System Schema

  1. New Tables
    - `users`
      - `id` (uuid, primary key)
      - `username` (text, unique)
      - `clearance_level` (text) - SECRET, CONFIDENTIAL, UNCLASSIFIED
      - `attributes` (jsonb) - sector, role, etc.
      - `query_budget` (integer) - remaining queries
      - `budget_reset_at` (timestamptz) - when budget resets
      - `created_at` (timestamptz)
    
    - `ontology_types`
      - `id` (uuid, primary key)
      - `name` (text, unique)
      - `attributes` (jsonb) - array of attribute definitions
      - `relations` (jsonb) - array of allowed relations
      - `created_at` (timestamptz)
    
    - `graph_nodes`
      - `id` (uuid, primary key)
      - `logical_id` (text) - business identifier
      - `classification_level` (text) - SECRET, CONFIDENTIAL, UNCLASSIFIED
      - `entity_type` (text)
      - `name` (text)
      - `attributes` (jsonb)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `graph_edges`
      - `id` (uuid, primary key)
      - `logical_id` (text) - business identifier
      - `classification_level` (text)
      - `source_node_id` (uuid, references graph_nodes)
      - `target_node_id` (uuid, references graph_nodes)
      - `relation_type` (text)
      - `attributes` (jsonb)
      - `created_at` (timestamptz)
    
    - `audit_log`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references users)
      - `query_text` (text)
      - `query_type` (text)
      - `result_count` (integer)
      - `access_granted` (boolean)
      - `denial_reason` (text)
      - `created_at` (timestamptz)
    
    - `access_policies`
      - `id` (uuid, primary key)
      - `name` (text)
      - `rule_type` (text) - ABAC, MLS
      - `conditions` (jsonb)
      - `effect` (text) - ALLOW, DENY
      - `priority` (integer)
      - `active` (boolean)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated access
    
  3. Indexes
    - Add indexes for performance on frequently queried columns
*/

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  clearance_level text NOT NULL DEFAULT 'UNCLASSIFIED',
  attributes jsonb DEFAULT '{}'::jsonb,
  query_budget integer DEFAULT 8,
  budget_reset_at timestamptz DEFAULT now() + interval '1 hour',
  created_at timestamptz DEFAULT now()
);

-- Ontology types
CREATE TABLE IF NOT EXISTS ontology_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  attributes jsonb DEFAULT '[]'::jsonb,
  relations jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Graph nodes
CREATE TABLE IF NOT EXISTS graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id text NOT NULL,
  classification_level text NOT NULL,
  entity_type text NOT NULL,
  name text NOT NULL,
  attributes jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Graph edges
CREATE TABLE IF NOT EXISTS graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id text NOT NULL,
  classification_level text NOT NULL,
  source_node_id uuid REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_node_id uuid REFERENCES graph_nodes(id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  attributes jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  query_text text NOT NULL,
  query_type text NOT NULL,
  result_count integer DEFAULT 0,
  access_granted boolean DEFAULT true,
  denial_reason text,
  created_at timestamptz DEFAULT now()
);

-- Access policies
CREATE TABLE IF NOT EXISTS access_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  rule_type text NOT NULL,
  conditions jsonb DEFAULT '{}'::jsonb,
  effect text NOT NULL DEFAULT 'ALLOW',
  priority integer DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_graph_nodes_logical_id ON graph_nodes(logical_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_classification ON graph_nodes(classification_level);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(entity_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_logical_id ON graph_edges(logical_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_policies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for service role (backend will use service key)
CREATE POLICY "Service can manage users"
  ON users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service can manage ontology"
  ON ontology_types FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service can manage nodes"
  ON graph_nodes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service can manage edges"
  ON graph_edges FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service can manage audit"
  ON audit_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service can manage policies"
  ON access_policies FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);