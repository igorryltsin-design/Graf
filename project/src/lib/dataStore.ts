import { graphNodes, graphEdges } from '../data/graphData';
import { users as initialUsers } from '../data/usersData';
import { AuditLog, GraphEdge, GraphNode, User } from './types';

const usersStore: User[] = initialUsers.map(user => ({ ...user }));
const nodesStore: GraphNode[] = graphNodes.map(node => ({ ...node, attributes: { ...node.attributes } }));
const edgesStore: GraphEdge[] = graphEdges.map(edge => ({ ...edge, attributes: { ...edge.attributes } }));
const auditLogStore: AuditLog[] = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getMaxBudget(level: User['clearance_level']): number {
  switch (level) {
    case 'SECRET':
      return 20;
    case 'CONFIDENTIAL':
      return 8;
    default:
      return 5;
  }
}

function maybeResetBudget(user: User): void {
  const now = Date.now();
  const resetAt = new Date(user.budget_reset_at).getTime();
  if (Number.isFinite(resetAt) && now >= resetAt) {
    const maxBudget = getMaxBudget(user.clearance_level);
    user.query_budget = maxBudget;
    user.budget_reset_at = new Date(now + 60 * 60 * 1000).toISOString();
  }
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const user = usersStore.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
  if (!user) {
    return null;
  }
  maybeResetBudget(user);
  return clone(user);
}

export async function findUserById(id: string): Promise<User | null> {
  const user = usersStore.find((u) => u.id === id) || null;
  if (!user) {
    return null;
  }
  maybeResetBudget(user);
  return clone(user);
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  const user = usersStore.find((u) => u.id === id);
  if (!user) {
    return null;
  }

  Object.assign(user, updates);
  return clone(user);
}

export async function decrementBudget(id: string): Promise<void> {
  const user = usersStore.find((u) => u.id === id);
  if (!user) {
    return;
  }
  maybeResetBudget(user);
  if (user.query_budget > 0) {
    user.query_budget -= 1;
  }
}

function buildNodeId(logicalId: string, level: string): string {
  return `${logicalId}_${level}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    || 'node';
}

function normalizeLevel(level: string): 'UNCLASSIFIED' | 'CONFIDENTIAL' | 'SECRET' {
  const upper = level.toUpperCase();
  if (upper === 'SECRET' || upper === 'S' || upper === 'H') return 'SECRET';
  if (upper === 'CONFIDENTIAL' || upper === 'C' || upper === 'M') return 'CONFIDENTIAL';
  return 'UNCLASSIFIED';
}

export async function getAllNodes(): Promise<GraphNode[]> {
  return clone(nodesStore);
}

export async function getAllEdges(): Promise<GraphEdge[]> {
  return clone(edgesStore);
}

export async function insertAuditLog(entry: Omit<AuditLog, 'id' | 'created_at'>): Promise<void> {
  const log: AuditLog = {
    ...entry,
    id: generateId('audit'),
    created_at: new Date().toISOString()
  };
  auditLogStore.unshift(log);
}

export async function getAuditLogsForUser(userId: string, limit = 20): Promise<AuditLog[]> {
  return clone(auditLogStore.filter((log) => log.user_id === userId).slice(0, limit));
}

export async function createNode(input: {
  name: string;
  entity_type: string;
  classification_level: string;
  attributes?: Record<string, any>;
  logical_id?: string;
}): Promise<GraphNode> {
  const classification = normalizeLevel(input.classification_level);
  const logicalId = input.logical_id?.trim() || `${slugify(input.name)}_${Math.random().toString(36).slice(2, 8)}`;
  const nodeId = buildNodeId(logicalId, classification);

  if (nodesStore.some(node => node.id === nodeId)) {
    throw new Error('Вершина с таким идентификатором уже существует');
  }

  const timestamp = new Date().toISOString();
  const node: GraphNode = {
    id: nodeId,
    logical_id: logicalId,
    classification_level: classification,
    entity_type: input.entity_type,
    name: input.name,
    attributes: { ...(input.attributes || {}) },
    created_at: timestamp,
    updated_at: timestamp
  };

  nodesStore.push(node);
  return clone(node);
}

export async function deleteNode(logicalId: string, level: string): Promise<void> {
  const classification = normalizeLevel(level);
  const nodeId = buildNodeId(logicalId, classification);
  const nodeIndex = nodesStore.findIndex(node => node.id === nodeId);
  if (nodeIndex === -1) {
    throw new Error('Вершина не найдена');
  }
  nodesStore.splice(nodeIndex, 1);

  for (let i = edgesStore.length - 1; i >= 0; i -= 1) {
    const edge = edgesStore[i];
    if (edge.source_node_id === nodeId || edge.target_node_id === nodeId) {
      edgesStore.splice(i, 1);
    }
  }
}

export async function createEdge(input: {
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  classification_level: string;
  attributes?: Record<string, any>;
  logical_id?: string;
}): Promise<GraphEdge> {
  const classification = normalizeLevel(input.classification_level);
  const sourceNode = nodesStore.find(node => node.id === input.source_node_id);
  const targetNode = nodesStore.find(node => node.id === input.target_node_id);

  if (!sourceNode || !targetNode) {
    throw new Error('Указанные вершины не найдены');
  }
  if (sourceNode.classification_level !== classification || targetNode.classification_level !== classification) {
    throw new Error('Связи можно создавать только между вершинами одного уровня');
  }

  const logicalId = input.logical_id?.trim() || `${slugify(input.relation_type)}_${Math.random().toString(36).slice(2, 8)}`;
  const edgeId = buildNodeId(logicalId, classification);

  if (edgesStore.some(edge => edge.id === edgeId)) {
    throw new Error('Связь с таким идентификатором уже существует');
  }

  const edge: GraphEdge = {
    id: edgeId,
    logical_id: logicalId,
    classification_level: classification,
    source_node_id: input.source_node_id,
    target_node_id: input.target_node_id,
    relation_type: input.relation_type,
    attributes: { ...(input.attributes || {}) },
    created_at: new Date().toISOString()
  };

  edgesStore.push(edge);
  return clone(edge);
}

export async function deleteEdge(edgeId: string): Promise<void> {
  const index = edgesStore.findIndex(edge => edge.id === edgeId);
  if (index === -1) {
    throw new Error('Связь не найдена');
  }
  edgesStore.splice(index, 1);
}

export async function exportLevelData(level: string): Promise<{ entities: any[]; relationships: any[] }> {
  const classification = normalizeLevel(level);
  const levelNodes = nodesStore.filter(node => node.classification_level === classification);
  const nodeIdMap = new Map(levelNodes.map(node => [node.id, node.logical_id]));

  const entities = levelNodes.map(node => ({
    logical_id: node.logical_id,
    entity_type: node.entity_type,
    name: node.name,
    classification: node.classification_level,
    attributes: clone(node.attributes)
  }));

  const relationships = edgesStore
    .filter(edge => edge.classification_level === classification)
    .map(edge => ({
      logical_id: edge.logical_id,
      source_id: nodeIdMap.get(edge.source_node_id) || edge.source_node_id,
      target_id: nodeIdMap.get(edge.target_node_id) || edge.target_node_id,
      relation_type: edge.relation_type,
      classification: edge.classification_level,
      attributes: clone(edge.attributes)
    }));

  return { entities, relationships };
}

export async function importLevelData(level: string, payload: { entities?: any[]; relationships?: any[] }): Promise<void> {
  const classification = normalizeLevel(level);

  for (let i = nodesStore.length - 1; i >= 0; i -= 1) {
    if (nodesStore[i].classification_level === classification) {
      nodesStore.splice(i, 1);
    }
  }

  for (let i = edgesStore.length - 1; i >= 0; i -= 1) {
    if (edgesStore[i].classification_level === classification) {
      edgesStore.splice(i, 1);
    }
  }

  const now = new Date().toISOString();
  const entityItems = Array.isArray(payload.entities) ? payload.entities : [];
  const relationshipItems = Array.isArray(payload.relationships) ? payload.relationships : [];

  const logicalToId = new Map<string, string>();

  entityItems.forEach(entity => {
    const logicalId = entity.logical_id || `${slugify(entity.name || 'entity')}_${Math.random().toString(36).slice(2, 8)}`;
    const nodeId = buildNodeId(logicalId, classification);
    const node: GraphNode = {
      id: nodeId,
      logical_id: logicalId,
      classification_level: classification,
      entity_type: entity.entity_type || 'Unknown',
      name: entity.name || logicalId,
      attributes: clone(entity.attributes || {}),
      created_at: entity.created_at || now,
      updated_at: entity.updated_at || now
    };
    logicalToId.set(logicalId, nodeId);
    nodesStore.push(node);
  });

  relationshipItems.forEach(relationship => {
    const logicalId = relationship.logical_id || `${slugify(relationship.relation_type || 'relation')}_${Math.random().toString(36).slice(2, 8)}`;
    const sourceLogical = relationship.source_id;
    const targetLogical = relationship.target_id;
    const sourceId = logicalToId.get(sourceLogical);
    const targetId = logicalToId.get(targetLogical);
    if (!sourceId || !targetId) {
      return;
    }
    const edgeId = buildNodeId(logicalId, classification);
    const edge: GraphEdge = {
      id: edgeId,
      logical_id: logicalId,
      classification_level: classification,
      source_node_id: sourceId,
      target_node_id: targetId,
      relation_type: relationship.relation_type || 'RELATED_TO',
      attributes: clone(relationship.attributes || {}),
      created_at: relationship.created_at || now
    };
    edgesStore.push(edge);
  });
}
