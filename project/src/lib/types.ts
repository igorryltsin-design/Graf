export interface User {
  id: string;
  username: string;
  clearance_level: 'UNCLASSIFIED' | 'CONFIDENTIAL' | 'SECRET';
  attributes: Record<string, any>;
  query_budget: number;
  budget_reset_at: string;
}

export interface GraphNode {
  id: string;
  logical_id: string;
  classification_level: string;
  entity_type: string;
  name: string;
  attributes: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface GraphEdge {
  id: string;
  logical_id: string;
  classification_level: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  attributes: Record<string, any>;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  query_text: string;
  query_type: string;
  result_count: number;
  access_granted: boolean;
  denial_reason: string | null;
  created_at: string;
}
