import { User, GraphNode, GraphEdge } from './types';
import {
  getAllNodes,
  getAllEdges,
  insertAuditLog,
  decrementBudget
} from './dataStore';
import { filterAccessibleNodes, filterAccessibleEdges, checkKAnonymity, checkQueryBudget } from './policy';

const DATA_REFERENCE_TIME = new Date('2024-05-12T10:00:00Z');
const CLEARANCE_ORDER: Record<string, number> = {
  UNCLASSIFIED: 0,
  CONFIDENTIAL: 1,
  SECRET: 2
};
const LEVEL_SEQUENCE: Array<keyof typeof CLEARANCE_ORDER> = ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET'];

export const AUDIT_DENIAL_CODES = {
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
  K_ANONYMITY: 'K_ANONYMITY'
} as const;

type ComparisonOperator = '>' | '>=' | '<' | '<=' | '=' | '!=';

interface ComparisonFilter {
  attribute: string;
  operator: ComparisonOperator;
  value: number | string;
  raw: string;
  display: string;
}

interface ParsedQuery {
  intent: 'count' | 'list' | 'timeline';
  entityType: string | null;
  entityLabel: string | null;
  sectorFilters: string[];
  timeWindowHours?: number;
  timeWindowRaw?: string;
  timeRange?: {
    start: number;
    end: number;
    raw: string;
  };
  statusFilters: string[];
  categoryFilters: string[];
  levelFilter?: string;
  logicOperator: 'AND' | 'OR';
  geoFilter?: {
    lat: number;
    lon: number;
    radiusKm: number;
    raw: string;
  };
  limit?: number;
  comparisons: ComparisonFilter[];
  tokens: string[];
  tips: string[];
  recognized: Array<{ text: string; type: string }>;
  warnings: string[];
}

export interface QueryExplanation {
  raw: string;
  entity?: string | null;
  filters: string[];
  comparisons: string[];
  timeWindow?: string;
  timeRange?: string;
  geo?: string;
  limit?: number;
  tips: string[];
  warnings: string[];
  intent: ParsedQuery['intent'];
  logic: ParsedQuery['logicOperator'];
  recognized: Array<{ text: string; type: string }>;
}

export interface GraphDataOptions {
  mode: 'virtual' | 'level' | 'overlay';
  level?: string | null;
  overlayLevels?: string[];
}

export interface QueryResult {
  success: boolean;
  data?: any;
  aggregated?: boolean;
  error?: string;
  denialReason?: string;
  explanation?: QueryExplanation;
}

export async function executeNaturalLanguageQuery(
  user: User,
  queryText: string
): Promise<QueryResult> {
  if (!checkQueryBudget(user)) {
    await logAuditEntry(user, queryText, 'NL_QUERY', 0, false, AUDIT_DENIAL_CODES.BUDGET_EXHAUSTED);
    return {
      success: false,
      error: 'Исчерпан бюджет запросов. Подождите восстановления.',
      denialReason: 'Бюджет исчерпан'
    };
  }

  const parsedQuery = parseNaturalLanguage(queryText);

  if (!parsedQuery) {
    return {
      success: false,
      error: 'Не удалось распознать запрос',
      explanation: {
        raw: queryText,
        entity: null,
        filters: [],
        comparisons: [],
        tips: [
          'Укажите объект интереса (например, «беспилотники», «сенсоры», «события»).',
          'Добавьте контекст: сектор, статус, временной интервал.'
        ],
        warnings: [],
        timeWindow: undefined,
        timeRange: undefined,
        geo: undefined,
        limit: undefined,
        intent: 'list',
        logic: 'AND',
        recognized: []
      }
    };
  }

  const allNodes = await getAllNodes();
  const nodes = parsedQuery.entityType
    ? allNodes.filter(node => node.entity_type === parsedQuery.entityType)
    : allNodes;

  const accessibleNodes = filterAccessibleNodes(user, nodes);

  let filteredNodes = accessibleNodes;
  if (parsedQuery.sectorFilters.length) {
    const sectorSet = new Set(parsedQuery.sectorFilters.map(value => value.toUpperCase()));
    filteredNodes = filteredNodes.filter(node => {
      const candidate = (node.attributes?.sector || node.attributes?.sectors?.[0] || '').toString().toUpperCase();
      return candidate && sectorSet.has(candidate);
    });
  }

  if (parsedQuery.levelFilter) {
    filteredNodes = filteredNodes.filter(node => node.classification_level === parsedQuery.levelFilter);
  }

  if (parsedQuery.timeWindowHours && parsedQuery.timeWindowHours > 0) {
    const cutoffTime = new Date(DATA_REFERENCE_TIME);
    cutoffTime.setHours(cutoffTime.getHours() - parsedQuery.timeWindowHours);
    filteredNodes = filteredNodes.filter(node => {
      const lastSeen = node.attributes?.last_seen || node.attributes?.timestamp || node.updated_at;
      return lastSeen && new Date(lastSeen) >= cutoffTime;
    });
  }

  if (parsedQuery.timeRange) {
    filteredNodes = filteredNodes.filter(node => {
      const timestamp = getNodeTimestamp(node);
      if (timestamp == null) {
        return false;
      }
      return timestamp >= parsedQuery.timeRange!.start && timestamp <= parsedQuery.timeRange!.end;
    });
  }

  if (parsedQuery.statusFilters.length) {
    const statusSet = new Set(parsedQuery.statusFilters);
    filteredNodes = filteredNodes.filter(node => {
      const status = (node.attributes?.status || node.attributes?.operational || '').toString().toLowerCase();
      if (!status) {
        return false;
      }
      return Array.from(statusSet).some(value => status === value);
    });
  }

  if (parsedQuery.categoryFilters.length) {
    const categorySet = new Set(parsedQuery.categoryFilters);
    filteredNodes = filteredNodes.filter(node => {
      const category = normalizeCategory(
        (node.attributes?.category || node.attributes?.type || '').toString()
      );
      if (!category) {
        return false;
      }
      return Array.from(categorySet).some(value => category === value);
    });
  }

  if (parsedQuery.geoFilter) {
    filteredNodes = filteredNodes.filter(node => {
      const coordinates = extractNodeCoordinates(node);
      if (!coordinates) {
        return false;
      }
      const distance = calculateDistanceKm(
        parsedQuery.geoFilter!.lat,
        parsedQuery.geoFilter!.lon,
        coordinates.lat,
        coordinates.lon
      );
      return distance <= parsedQuery.geoFilter!.radiusKm;
    });
  }

  if (parsedQuery.comparisons.length) {
    filteredNodes = filteredNodes.filter(node => checkComparisons(node, parsedQuery.comparisons));
  }

  if (parsedQuery.limit && parsedQuery.limit > 0) {
    filteredNodes = takeWithPreferredOrder(filteredNodes, parsedQuery.limit);
  }

  await decrementBudget(user.id);
  if (user.query_budget > 0) {
    user.query_budget -= 1;
  }

  if (filteredNodes.length === 0) {
    await logAuditEntry(user, queryText, 'NL_QUERY', 0, true, null);
    return {
      success: true,
      data: [],
      aggregated: false,
      explanation: buildExplanation(parsedQuery, queryText)
    };
  }

  if (!checkKAnonymity(filteredNodes.length)) {
    await logAuditEntry(
      user,
      queryText,
      'NL_QUERY',
      filteredNodes.length,
      true,
      AUDIT_DENIAL_CODES.K_ANONYMITY
    );
    return {
      success: true,
      data: {
        count: filteredNodes.length,
        message: 'Выборка слишком мала для раскрытия деталей (защита k-анонимностью)'
      },
      aggregated: true,
      denialReason: AUDIT_DENIAL_CODES.K_ANONYMITY,
      explanation: buildExplanation(parsedQuery, queryText)
    };
  }

  await logAuditEntry(user, queryText, 'NL_QUERY', filteredNodes.length, true, null);

  return {
    success: true,
    data: filteredNodes,
    explanation: buildExplanation(parsedQuery, queryText)
  };
}

const ENTITY_KEYWORDS: Array<{
  keywords: string[];
  entityType: string;
  label: string;
  category?: string;
  intent?: ParsedQuery['intent'];
  tips?: string[];
}> = [
  {
    keywords: ['беспилотн', 'дрон', 'uav', 'бпла'],
    entityType: 'Target',
    label: 'Беспилотники',
    category: 'uav'
  },
  {
    keywords: ['цель', 'target', 'object'],
    entityType: 'Target',
    label: 'Воздушные цели'
  },
  {
    keywords: ['сенсор', 'sensor', 'радар', 'радиолок'],
    entityType: 'Sensor',
    label: 'Сенсоры',
    tips: ['Можно добавить фильтр статуса: «сенсоры offline».']
  },
  {
    keywords: ['событи', 'event', 'инцидент', 'операция'],
    entityType: 'Event',
    label: 'События',
    intent: 'timeline',
    tips: ['Используйте временной диапазон: «последние 30 минут».']
  },
  {
    keywords: ['сектор', 'sector'],
    entityType: 'Sector',
    label: 'Сектора',
    tips: ['Уточните, что нужно: цели, сенсоры или события внутри сектора.']
  }
];

const STATUS_KEYWORDS: Record<string, string> = {
  offline: 'offline',
  недоступн: 'offline',
  неработающ: 'offline',
  обесточен: 'offline',
  online: 'online',
  работоспособн: 'online',
  вкл: 'online',
  активн: 'online'
};

const CATEGORY_KEYWORDS: Record<string, string> = {
  uav: 'uav',
  'бпла': 'uav',
  helikopter: 'helicopter',
  вертолет: 'helicopter',
  helicopter: 'helicopter',
  unknown: 'unknown',
  group: 'airgroup'
};

const LEVEL_KEYWORDS: Record<string, string> = {
  секрет: 'SECRET',
  secret: 'SECRET',
  'уровень h': 'SECRET',
  'уровень m': 'CONFIDENTIAL',
  confid: 'CONFIDENTIAL',
  секретн: 'SECRET',
  dsp: 'CONFIDENTIAL',
  confidential: 'CONFIDENTIAL',
  unclassified: 'UNCLASSIFIED',
  'уровень l': 'UNCLASSIFIED',
  общедоступн: 'UNCLASSIFIED'
};

const ATTRIBUTE_ALIASES: Array<{ match: string; attribute: string }> = [
  { match: 'скорост', attribute: 'speed' },
  { match: 'speed', attribute: 'speed' },
  { match: 'heading', attribute: 'heading' },
  { match: 'курс', attribute: 'heading' },
  { match: 'высот', attribute: 'altitude' },
  { match: 'altitude', attribute: 'altitude' },
  { match: 'угроз', attribute: 'threat_level' },
  { match: 'threat', attribute: 'threat_level' },
  { match: 'status', attribute: 'status' },
  { match: 'статус', attribute: 'status' },
  { match: 'операцион', attribute: 'operational' },
  { match: 'distance', attribute: 'distance' }
];

const THREAT_ORDER: Record<string, number> = {
  low: 1,
  medium: 2,
  elevated: 3,
  high: 4,
  critical: 5
};

function normalizeCategory(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  for (const [key, normalized] of Object.entries(CATEGORY_KEYWORDS)) {
    if (lower.includes(key)) {
      return normalized;
    }
  }
  return lower;
}

function detectEntity(lowerQuery: string): {
  entityType: string | null;
  entityLabel: string | null;
  category?: string;
  intent: ParsedQuery['intent'];
  tips: string[];
} {
  for (const entry of ENTITY_KEYWORDS) {
    if (entry.keywords.some(keyword => lowerQuery.includes(keyword))) {
      return {
        entityType: entry.entityType,
        entityLabel: entry.label,
        category: entry.category,
        intent: entry.intent || 'list',
        tips: entry.tips || []
      };
    }
  }
  return {
    entityType: null,
    entityLabel: null,
    intent: 'list',
    tips: []
  };
}

function extractSectorFilters(lowerQuery: string): { values: Set<string>; recognized: string[] } {
  const values = new Set<string>();
  const recognized: string[] = [];
  const regex = /сектор[е]?\s+([a-zа-я])/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lowerQuery)) !== null) {
    const sector = match[1].toUpperCase();
    values.add(sector);
    recognized.push(match[0]);
  }

  const english = /sector\s+([a-z])/gi;
  while ((match = english.exec(lowerQuery)) !== null) {
    const sector = match[1].toUpperCase();
    values.add(sector);
    recognized.push(match[0]);
  }

  return { values, recognized };
}

function extractLevel(lowerQuery: string): string | undefined {
  for (const [key, value] of Object.entries(LEVEL_KEYWORDS)) {
    if (lowerQuery.includes(key)) {
      return value;
    }
  }
  return undefined;
}

function extractStatusFilters(lowerQuery: string): { values: Set<string>; recognized: string[] } {
  const values = new Set<string>();
  const recognized: string[] = [];
  Object.entries(STATUS_KEYWORDS).forEach(([keyword, normalized]) => {
    if (lowerQuery.includes(keyword)) {
      values.add(normalized);
      recognized.push(keyword);
    }
  });
  return { values, recognized };
}

function extractCategoryFilters(lowerQuery: string): { values: Set<string>; recognized: string[] } {
  const values = new Set<string>();
  const recognized: string[] = [];

  Object.entries(CATEGORY_KEYWORDS).forEach(([keyword, normalized]) => {
    if (lowerQuery.includes(keyword)) {
      values.add(normalized);
      recognized.push(keyword);
    }
  });

  const regex = /категор(?:ия|ии)?\s+([a-zа-я0-9]+)/iu;
  const match = lowerQuery.match(regex);
  if (match) {
    const normalized = normalizeCategory(match[1]);
    if (normalized) {
      values.add(normalized);
      recognized.push(match[1]);
    }
  }

  return { values, recognized };
}

function extractTimeWindow(lowerQuery: string): { hours?: number; raw?: string } {
  const patterns = [
    /последн(?:ие|их)?\s+(\d+)\s+(минут|мин|minutes?|час(?:а|ов)?|hours?|дн(?:я|ей)?|days?)/u,
    /за\s+(\d+)\s+(минут|мин|minutes?|час(?:а|ов)?|hours?|дн(?:я|ей)?|days?)/u,
    /within\s+(\d+)\s+(minutes?|hours?|days?)/iu
  ];

  for (const pattern of patterns) {
    const match = lowerQuery.match(pattern);
    if (match) {
      const value = Number(match[1]);
      const unit = match[2].toLowerCase();
      let hours = value;
      if (['минут', 'мин', 'minute', 'minutes'].some(token => unit.includes(token))) {
        hours = value / 60;
      } else if (['дн', 'day', 'days'].some(token => unit.includes(token))) {
        hours = value * 24;
      }
      return { hours, raw: match[0] };
    }
  }

  if (lowerQuery.includes('прямо сейчас') || lowerQuery.includes('real-time')) {
    return { hours: 0.25, raw: 'прямо сейчас' };
  }

  return {};
}

function extractTimeRange(lowerQuery: string): { start: number; end: number; raw: string } | null {
  const match =
    lowerQuery.match(/(?:с|from)\s+(\d{1,2}:\d{2})\s+(?:до|по|to)\s+(\d{1,2}:\d{2})/u) ||
    lowerQuery.match(/между\s+(\d{1,2}:\d{2})\s+(?:и|and)\s+(\d{1,2}:\d{2})/u);

  if (!match) {
    return null;
  }

  const start = parseTimeToReference(match[1]);
  const end = parseTimeToReference(match[2]);
  if (start == null || end == null) {
    return null;
  }

  const adjustedEnd = end < start ? end + 24 * 60 * 60 * 1000 : end;

  return {
    start,
    end: adjustedEnd,
    raw: match[0]
  };
}

function extractLimit(lowerQuery: string): number | undefined {
  const limitMatch = lowerQuery.match(/(первые|показать|top|последние)\s+(\d+)/i);
  if (limitMatch) {
    return Number(limitMatch[2]);
  }
  return undefined;
}

function normalizeAttributeAlias(alias: string): string | null {
  const lower = alias.toLowerCase();
  for (const { match, attribute } of ATTRIBUTE_ALIASES) {
    if (lower.includes(match)) {
      return attribute;
    }
  }
  return null;
}

function extractComparisons(lowerQuery: string): ComparisonFilter[] {
  const comparisons: ComparisonFilter[] = [];
  const regex = /([a-zа-яё_]+)\s*(>=|<=|>|<|=|!=)\s*([0-9]+(?:[.,][0-9]+)?|[a-zа-яё]+)/giu;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(lowerQuery)) !== null) {
    const attribute = normalizeAttributeAlias(match[1]);
    if (!attribute) {
      continue;
    }
    const operator = match[2] as ComparisonOperator;
    const rawValue = match[3].replace(',', '.');
    const value = Number.isNaN(Number(rawValue)) ? rawValue.toLowerCase() : Number(rawValue);
    comparisons.push({
      attribute,
      operator,
      value,
      raw: match[0],
      display: `${match[1]} ${operator} ${match[3]}`
    });
  }

  return comparisons;
}

function extractGeoFilter(query: string): ParsedQuery['geoFilter'] | undefined {
  const normalized = query.toLowerCase();
  if (!normalized.includes('координат') && !normalized.includes('lat') && !normalized.includes('широт')) {
    return undefined;
  }

  const coordMatch =
    query.match(/([-+]?\d+(?:[.,]\d+)?)\s*[;,]\s*([-+]?\d+(?:[.,]\d+)?)/) ||
    query.match(/lat(?:itude)?\s*[:=]?\s*([-+]?\d+(?:[.,]\d+)?).*(?:lon|long|longitude)\s*[:=]?\s*([-+]?\d+(?:[.,]\d+)?)/i);

  if (!coordMatch) {
    return undefined;
  }

  const lat = Number(coordMatch[1].replace(',', '.'));
  const lon = Number(coordMatch[2].replace(',', '.'));
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return undefined;
  }

  const radiusMatch = normalized.match(/радиус(?:е|а)?\s+(\d+(?:[.,]\d+)?)\s*(км|km)/);
  const radiusKm = radiusMatch ? Number(radiusMatch[1].replace(',', '.')) : 10;

  return {
    lat,
    lon,
    radiusKm: Number.isNaN(radiusKm) ? 10 : radiusKm,
    raw: coordMatch[0]
  };
}

function parseTimeToReference(timeHHMM: string): number | null {
  const parts = timeHHMM.split(':');
  if (parts.length !== 2) {
    return null;
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  const base = new Date(DATA_REFERENCE_TIME);
  base.setHours(hours, minutes, 0, 0);
  return base.getTime();
}

function parseNaturalLanguage(query: string): ParsedQuery | null {
  const lowerQuery = query.toLowerCase();
  const tokens = lowerQuery.split(/[\s,]+/u).filter(Boolean);

  const recognized: Array<{ text: string; type: string }> = [];
  const tips: string[] = [];
  const warnings: string[] = [];

  const {
    entityType,
    entityLabel,
    category: entityCategory,
    intent,
    tips: entityTips
  } = detectEntity(lowerQuery);

  if (entityLabel) {
    recognized.push({ text: entityLabel, type: 'entity' });
  }
  if (entityTips) {
    tips.push(...entityTips);
  }

  const logicOperator: 'AND' | 'OR' =
    lowerQuery.includes(' или ') || lowerQuery.includes(' or ') ? 'OR' : 'AND';

  const sectorInfo = extractSectorFilters(lowerQuery);
  sectorInfo.recognized.forEach(text => {
    recognized.push({ text, type: 'sector' });
  });

  const statusInfo = extractStatusFilters(lowerQuery);
  statusInfo.recognized.forEach(text => {
    recognized.push({ text, type: 'status' });
  });

  const categoryInfo = extractCategoryFilters(lowerQuery);
  if (entityCategory) {
    categoryInfo.values.add(entityCategory);
    recognized.push({ text: entityCategory, type: 'category' });
  }
  categoryInfo.recognized.forEach(text => {
    recognized.push({ text, type: 'category' });
  });

  const levelFilter = extractLevel(lowerQuery);
  if (levelFilter) {
    recognized.push({ text: levelFilter, type: 'level' });
  }

  const { hours: timeWindowHours, raw: timeWindowRaw } = extractTimeWindow(lowerQuery);
  if (timeWindowRaw) {
    recognized.push({ text: timeWindowRaw, type: 'time_window' });
  }

  const timeRange = extractTimeRange(lowerQuery);
  if (timeRange) {
    recognized.push({ text: timeRange.raw, type: 'time_range' });
  }

  const geoFilter = extractGeoFilter(query);
  if (geoFilter) {
    recognized.push({ text: geoFilter.raw, type: 'geo' });
  }

  const limit = extractLimit(lowerQuery);
  if (typeof limit === 'number') {
    recognized.push({ text: `limit:${limit}`, type: 'limit' });
  }

  const comparisons = extractComparisons(lowerQuery);
  comparisons.forEach(comparison => {
    recognized.push({ text: comparison.raw, type: 'comparison' });
  });

  const parsed: ParsedQuery = {
    intent,
    entityType,
    entityLabel,
    sectorFilters: [...sectorInfo.values],
    timeWindowHours,
    timeWindowRaw,
    timeRange: timeRange || undefined,
    statusFilters: [...statusInfo.values],
    categoryFilters: Array.from(categoryInfo.values),
    levelFilter,
    logicOperator,
    geoFilter,
    limit,
    comparisons,
    tokens,
    tips,
    recognized,
    warnings
  };

  if (!parsed.entityType && !parsed.categoryFilters.length && !parsed.statusFilters.length && !comparisons.length) {
    return null;
  }

  if (!parsed.entityType) {
    parsed.warnings.push('Тип сущности не указан — будут возвращены все объекты, доступные по политике.');
  }

  if (parsed.logicOperator === 'OR' && parsed.statusFilters.length + parsed.categoryFilters.length <= 1) {
    parsed.warnings.push('Оператор «или» обнаружен, но условие одно — результат совпадает с обычным фильтром.');
  }

  if (parsed.timeRange && parsed.timeWindowHours) {
    parsed.warnings.push('Указаны и фиксированный диапазон времени, и скользящее окно. Применяется пересечение условий.');
  }

  if (!parsed.sectorFilters.length) {
    parsed.tips.push('Добавьте сектор для точности: «в секторе A».');
  }

  if (parsed.statusFilters.length) {
    parsed.tips.push('Можно уточнить несколько статусов: offline, online, degraded.');
  }

  if (comparisons.length) {
    parsed.tips.push('Сравнения поддерживаются для числовых полей: скорость, курс.');
  }

  return parsed;
}

function takeWithPreferredOrder(nodes: GraphNode[], limit: number): GraphNode[] {
  if (nodes.length <= limit) {
    return nodes;
  }

  const sortable = [...nodes];
  sortable.sort((a, b) => {
    const timeA = Date.parse(a.attributes?.last_seen || a.attributes?.timestamp || a.updated_at || a.created_at);
    const timeB = Date.parse(b.attributes?.last_seen || b.attributes?.timestamp || b.updated_at || b.created_at);
    return timeB - timeA;
  });

  return sortable.slice(0, limit);
}

function compareValues(lhs: unknown, rhs: number | string, operator: ComparisonOperator): boolean {
  if (lhs == null) {
    return false;
  }

  if (typeof rhs === 'number') {
    const lhsNumber = typeof lhs === 'number' ? lhs : Number(lhs);
    if (Number.isNaN(lhsNumber)) {
      return false;
    }
    switch (operator) {
      case '>':
        return lhsNumber > rhs;
      case '>=':
        return lhsNumber >= rhs;
      case '<':
        return lhsNumber < rhs;
      case '<=':
        return lhsNumber <= rhs;
      case '=':
        return lhsNumber === rhs;
      case '!=':
        return lhsNumber !== rhs;
      default:
        return false;
    }
  }

  const lhsString = lhs.toString().toLowerCase();
  const rhsString = rhs.toString().toLowerCase();

  if (lhsString === rhsString && operator === '=') {
    return true;
  }
  if (operator === '!=') {
    return lhsString !== rhsString;
  }

  const lhsThreat = THREAT_ORDER[lhsString];
  const rhsThreat = THREAT_ORDER[rhsString];

  if (lhsThreat && rhsThreat) {
    switch (operator) {
      case '>':
        return lhsThreat > rhsThreat;
      case '>=':
        return lhsThreat >= rhsThreat;
      case '<':
        return lhsThreat < rhsThreat;
      case '<=':
        return lhsThreat <= rhsThreat;
      default:
        return false;
    }
  }

  switch (operator) {
    case '>':
      return lhsString > rhsString;
    case '>=':
      return lhsString >= rhsString;
    case '<':
      return lhsString < rhsString;
    case '<=':
      return lhsString <= rhsString;
    case '=':
      return lhsString === rhsString;
    default:
      return false;
  }
}

function checkComparisons(node: GraphNode, comparisons: ComparisonFilter[]): boolean {
  return comparisons.every(comparison => {
    const value =
      node.attributes?.[comparison.attribute] ??
      node.attributes?.[comparison.attribute.toUpperCase()] ??
      node.attributes?.[comparison.attribute.toLowerCase()];
    return compareValues(value, comparison.value, comparison.operator);
  });
}

function getNodeTimestamp(node: GraphNode): number | null {
  const candidates = [
    node.attributes?.last_seen,
    node.attributes?.timestamp,
    node.updated_at,
    node.created_at
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return null;
}

function extractNodeCoordinates(node: GraphNode): { lat: number; lon: number } | null {
  const coordinates = node.attributes?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const lat = Number(coordinates[0]);
    const lon = Number(coordinates[1]);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      return { lat, lon };
    }
  }

  if (typeof coordinates === 'string') {
    const match = coordinates.match(/([-+]?\d+(?:[.,]\d+)?)\s*,\s*([-+]?\d+(?:[.,]\d+)?)/);
    if (match) {
      const lat = Number(match[1].replace(',', '.'));
      const lon = Number(match[2].replace(',', '.'));
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        return { lat, lon };
      }
    }
  }

  return null;
}

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function buildExplanation(parsed: ParsedQuery, rawQuery: string): QueryExplanation {
  const filters: string[] = [];
  if (parsed.sectorFilters.length) {
    filters.push(`Секторы: ${parsed.sectorFilters.join(', ')}`);
  }
  if (parsed.levelFilter) {
    filters.push(`Уровень допуска: ${parsed.levelFilter}`);
  }
  if (parsed.categoryFilters.length) {
    filters.push(`Категории: ${parsed.categoryFilters.map(value => value.toUpperCase()).join(', ')}`);
  }
  if (parsed.statusFilters.length) {
    filters.push(`Статусы: ${parsed.statusFilters.join(', ')}`);
  }

  const comparisons = parsed.comparisons.map(c => c.display);

  return {
    raw: rawQuery,
    entity: parsed.entityLabel,
    filters,
    comparisons,
    timeWindow: parsed.timeWindowRaw,
    timeRange: parsed.timeRange
      ? `${new Date(parsed.timeRange.start).toLocaleTimeString()} — ${new Date(parsed.timeRange.end).toLocaleTimeString()}`
      : undefined,
    geo: parsed.geoFilter
      ? `Координаты ${parsed.geoFilter.lat.toFixed(3)}, ${parsed.geoFilter.lon.toFixed(3)} ± ${parsed.geoFilter.radiusKm} км`
      : undefined,
    limit: parsed.limit,
    tips: Array.from(new Set(parsed.tips)),
    warnings: parsed.warnings,
    intent: parsed.intent,
    logic: parsed.logicOperator,
    recognized: parsed.recognized
  };
}

async function logAuditEntry(
  user: User,
  queryText: string,
  queryType: string,
  resultCount: number,
  granted: boolean,
  denialReason: string | null
): Promise<void> {
  await insertAuditLog({
    user_id: user.id,
    query_text: queryText,
    query_type: queryType,
    result_count: resultCount,
    access_granted: granted,
    denial_reason: denialReason
  });
}

export async function getGraphData(user: User, options: GraphDataOptions): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  const allNodes = await getAllNodes();
  const allEdges = await getAllEdges();
  const accessibleNodes = filterAccessibleNodes(user, allNodes);
  const nodeById = new Map(allNodes.map(node => [node.id, node]));
  const accessibleEdges = filterAccessibleEdges(user, allEdges);

  const userMaxRank = CLEARANCE_ORDER[user.clearance_level] ?? CLEARANCE_ORDER.UNCLASSIFIED;
  const accessibleLevels = LEVEL_SEQUENCE.filter(level => CLEARANCE_ORDER[level] <= userMaxRank);

  if (options.mode === 'level') {
    const targetLevel = options.level && accessibleLevels.includes(options.level as any)
      ? options.level
      : accessibleLevels[accessibleLevels.length - 1] || accessibleLevels[0] || 'UNCLASSIFIED';

    const nodes = accessibleNodes.filter(node => node.classification_level === targetLevel);
    const nodeIds = new Set(nodes.map(node => node.id));

    const edges = accessibleEdges.filter(edge =>
      edge.classification_level === targetLevel &&
      nodeIds.has(edge.source_node_id) &&
      nodeIds.has(edge.target_node_id)
    );

    return { nodes, edges };
  }

  if (options.mode === 'overlay') {
    const requestedLevels = options.overlayLevels && options.overlayLevels.length > 0
      ? options.overlayLevels.filter(level => accessibleLevels.includes(level as any))
      : [];
    const effectiveLevels = requestedLevels.length > 0 ? requestedLevels : accessibleLevels;
    const levelSet = new Set(effectiveLevels);

    const nodes = accessibleNodes.filter(node => levelSet.has(node.classification_level));
    const nodeIds = new Set(nodes.map(node => node.id));

    const edges = accessibleEdges.filter(edge =>
      levelSet.has(edge.classification_level) &&
      nodeIds.has(edge.source_node_id) &&
      nodeIds.has(edge.target_node_id)
    );

    return { nodes, edges };
  }

  const nodeChoice = new Map<string, GraphNode>();
  accessibleNodes.forEach(node => {
    const current = nodeChoice.get(node.logical_id);
    const rank = CLEARANCE_ORDER[node.classification_level] ?? 0;
    if (!current || rank > (CLEARANCE_ORDER[current.classification_level] ?? 0)) {
      nodeChoice.set(node.logical_id, node);
    }
  });

  const nodes = Array.from(nodeChoice.values());
  const logicalToNode = new Map<string, GraphNode>();
  nodes.forEach(node => logicalToNode.set(node.logical_id, node));

  const edgesMap = new Map<string, GraphEdge>();
  accessibleEdges.forEach(edge => {
    const sourceOriginal = nodeById.get(edge.source_node_id);
    const targetOriginal = nodeById.get(edge.target_node_id);
    if (!sourceOriginal || !targetOriginal) {
      return;
    }

    const bestSource = logicalToNode.get(sourceOriginal.logical_id);
    const bestTarget = logicalToNode.get(targetOriginal.logical_id);
    if (!bestSource || !bestTarget) {
      return;
    }

    const key = edge.logical_id || `${bestSource.logical_id}::${bestTarget.logical_id}::${edge.relation_type}`;
    const candidate: GraphEdge = {
      ...edge,
      source_node_id: bestSource.id,
      target_node_id: bestTarget.id
    };

    const existing = edgesMap.get(key);
    if (!existing || (CLEARANCE_ORDER[candidate.classification_level] ?? 0) > (CLEARANCE_ORDER[existing.classification_level] ?? 0)) {
      edgesMap.set(key, candidate);
    }
  });

  return { nodes, edges: Array.from(edgesMap.values()) };
}
