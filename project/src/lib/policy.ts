import { User, GraphNode, GraphEdge } from './types';

const CLEARANCE_LEVELS = {
  UNCLASSIFIED: 0,
  CONFIDENTIAL: 1,
  SECRET: 2
};

export function checkClearance(userLevel: string, dataLevel: string): boolean {
  const userClearance = CLEARANCE_LEVELS[userLevel as keyof typeof CLEARANCE_LEVELS] || 0;
  const dataClearance = CLEARANCE_LEVELS[dataLevel as keyof typeof CLEARANCE_LEVELS] || 0;
  return userClearance >= dataClearance;
}

export function checkSectorAccess(user: User, data: GraphNode | GraphEdge): boolean {
  const userSector = user.attributes?.sector;
  const userRole = user.attributes?.role;

  if (userRole === 'commander') {
    return true;
  }

  if (!userSector) {
    return false;
  }

  const dataSector = data.attributes?.sector;
  if (!dataSector) {
    return true;
  }

  return userSector === dataSector;
}

export function filterAccessibleNodes(user: User, nodes: GraphNode[]): GraphNode[] {
  return nodes.filter(node => {
    if (!checkClearance(user.clearance_level, node.classification_level)) {
      return false;
    }

    return checkSectorAccess(user, node);
  });
}

export function filterAccessibleEdges(user: User, edges: GraphEdge[]): GraphEdge[] {
  return edges.filter(edge => {
    if (!checkClearance(user.clearance_level, edge.classification_level)) {
      return false;
    }

    return checkSectorAccess(user, edge);
  });
}

export function checkKAnonymity(resultCount: number, minK: number = 2): boolean {
  return resultCount >= minK;
}

export function checkQueryBudget(user: User): boolean {
  return user.query_budget > 0;
}
