import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DataSet,
  Network,
  type Edge as VisEdge,
  type Node as VisNode,
  type Options
} from 'vis-network/standalone/esm/vis-network.js';
import 'vis-network/styles/vis-network.css';
import {
  User,
  GraphNode,
  GraphEdge,
  createNode,
  deleteNode,
  createEdge,
  deleteEdge
} from '../lib/supabase';
import { getGraphData, type GraphDataOptions } from '../lib/queryEngine';

type ClearanceLevel = 'UNCLASSIFIED' | 'CONFIDENTIAL' | 'SECRET';

interface GraphViewProps {
  user: User;
  viewMode: 'virtual' | 'level' | 'overlay';
  selectedLevel: string;
  overlayLevels: string[];
  refreshToken: number;
  highlightNodeIds: string[];
}

interface ContextMenuItem {
  label: string;
  disabled?: boolean;
  action?: () => void;
}

interface EdgeSourceState {
  nodeId: string;
  label: string;
  level: ClearanceLevel;
}

const ENTITY_COLORS: Record<string, string> = {
  UAV: '#3b82f6',
  Target: '#ef4444',
  Sensor: '#10b981',
  Sector: '#8b5cf6',
  Event: '#f59e0b'
};

const ENTITY_LABELS: Record<string, string> = {
  UAV: 'БПЛА',
  Target: 'Цель',
  Sensor: 'Сенсор',
  Sector: 'Сектор',
  Event: 'Событие'
};

const LEVEL_COLORS: Record<ClearanceLevel, string> = {
  UNCLASSIFIED: '#22c55e',
  CONFIDENTIAL: '#f59e0b',
  SECRET: '#ef4444'
};

const LEVEL_SEQUENCE: ClearanceLevel[] = ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET'];

const LEVEL_LABELS: Record<string, string> = {
  SECRET: 'СЕКРЕТНО',
  CONFIDENTIAL: 'ДСП',
  UNCLASSIFIED: 'ОБЩЕДОСТУПНО'
};

const LEVEL_FROM_INPUT = (value: string | null, fallback: ClearanceLevel): ClearanceLevel => {
  if (!value) return fallback;
  const normalized = value.trim().toUpperCase();
  if (['H', 'SECRET', 'S'].includes(normalized)) return 'SECRET';
  if (['M', 'CONFIDENTIAL', 'C'].includes(normalized)) return 'CONFIDENTIAL';
  if (['L', 'UNCLASSIFIED', 'U'].includes(normalized)) return 'UNCLASSIFIED';
  return fallback;
};

const toLevel = (value: string | undefined, fallback: ClearanceLevel): ClearanceLevel => {
  if (!value) return fallback;
  return LEVEL_FROM_INPUT(value, fallback);
};

function getNodeTime(node: GraphNode): number | null {
  const candidates = [
    node.attributes?.last_seen,
    node.attributes?.timestamp,
    node.updated_at,
    node.created_at
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const time = Date.parse(candidate);
    if (!Number.isNaN(time)) {
      return time;
    }
  }

  return null;
}

function computeTimeBounds(nodes: GraphNode[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  nodes.forEach(node => {
    const time = getNodeTime(node);
    if (time == null) {
      return;
    }
    if (time < min) min = time;
    if (time > max) max = time;
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { min, max };
}

function formatTimeLabel(timestamp: number | null): string {
  if (!timestamp) {
    return '—';
  }
  const date = new Date(timestamp);
  return date.toLocaleString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderAttributeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => renderAttributeValue(item)).join(', ');
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '[объект]';
    }
  }
  if (typeof value === 'boolean') {
    return value ? 'Да' : 'Нет';
  }
  return String(value ?? '—');
}

export default function GraphView({
  user,
  viewMode,
  selectedLevel,
  overlayLevels,
  refreshToken,
  highlightNodeIds
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesDatasetRef = useRef<DataSet<VisNode> | null>(null);
  const edgesDatasetRef = useRef<DataSet<VisEdge> | null>(null);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [networkReady, setNetworkReady] = useState(false);
  const [edgeSource, setEdgeSource] = useState<EdgeSourceState | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
  }>({ visible: false, x: 0, y: 0, items: [] });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeEntityTypes, setActiveEntityTypes] = useState<string[]>([]);
  const [activeLevels, setActiveLevels] = useState<ClearanceLevel[]>([]);
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [timelineCursorMs, setTimelineCursorMs] = useState<number | null>(null);
  const [timelineWindowMinutes, setTimelineWindowMinutes] = useState<number>(60);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const positionsCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [pinnedNodeIds, setPinnedNodeIds] = useState<string[]>([]);

  const effectiveOverlayLevels = useMemo<ClearanceLevel[]>(() => {
    const allowed: ClearanceLevel[] = ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET'];
    return overlayLevels
      .map(level => toLevel(level, user.clearance_level as ClearanceLevel))
      .filter(level => allowed.includes(level) && allowed.indexOf(level) <= allowed.indexOf(user.clearance_level as ClearanceLevel));
  }, [overlayLevels, user.clearance_level]);

  const timelineBounds = useMemo(() => computeTimeBounds(nodes), [nodes]);
  const selectedNode = useMemo(
    () => nodes.find(node => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    nodes.forEach(node => {
      map.set(node.id, node);
    });
    return map;
  }, [nodes]);
  const entityTypeOptions = useMemo(() => Array.from(new Set(nodes.map(node => node.entity_type))).sort(), [nodes]);
  const levelOptions = useMemo(
    () =>
      Array.from(new Set(nodes.map(node => node.classification_level as ClearanceLevel))).sort(
        (a, b) => LEVEL_SEQUENCE.indexOf(a as ClearanceLevel) - LEVEL_SEQUENCE.indexOf(b as ClearanceLevel)
      ),
    [nodes]
  );

  const highlightSet = useMemo(() => {
    const result = new Set(highlightNodeIds || []);
    if (selectedNodeId) {
      result.add(selectedNodeId);
    }
    pinnedNodeIds.forEach(id => result.add(id));
    return result;
  }, [highlightNodeIds, pinnedNodeIds, selectedNodeId]);

  useEffect(() => {
    if (!timelineBounds) {
      setTimelineCursorMs(null);
      setTimelinePlaying(false);
      return;
    }
    setTimelineCursorMs(prev => {
      if (prev == null) {
        return timelineBounds.max;
      }
      if (prev < timelineBounds.min) {
        return timelineBounds.min;
      }
      if (prev > timelineBounds.max) {
        return timelineBounds.max;
      }
      return prev;
    });
  }, [timelineBounds]);

  useEffect(() => {
    if (!timelineEnabled || !timelinePlaying || !timelineBounds) {
      return;
    }
    const stepMs = Math.max(60_000, Math.floor((timelineBounds.max - timelineBounds.min) / 24)) || 60_000;
    const timer = window.setInterval(() => {
      setTimelineCursorMs(prev => {
        const current = prev ?? timelineBounds.min;
        const next = current + stepMs;
        if (next >= timelineBounds.max) {
          return timelineBounds.max;
        }
        return next;
      });
    }, 800);

    return () => window.clearInterval(timer);
  }, [timelineBounds, timelineEnabled, timelinePlaying]);

  useEffect(() => {
    if (!timelineEnabled || !timelineBounds || !timelinePlaying) {
      return;
    }
    if (timelineCursorMs != null && timelineCursorMs >= timelineBounds.max) {
      setTimelinePlaying(false);
    }
  }, [timelineBounds, timelineCursorMs, timelineEnabled, timelinePlaying]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => (prev.visible ? { ...prev, visible: false, items: [] } : prev));
  }, []);

  const openContextMenu = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    if (!items.length) {
      closeContextMenu();
      return;
    }
    const menuWidth = 220;
    const menuHeight = items.length * 36 + 16;
    const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
    const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);
    setContextMenu({ visible: true, x: clampedX, y: clampedY, items });
  }, [closeContextMenu]);

  useEffect(() => {
    if (!contextMenu.visible) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
        setEdgeSource(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [contextMenu.visible, closeContextMenu]);

  useEffect(() => {
    if (!containerRef.current) return;

    const nodesDataset = new DataSet<VisNode>([]);
    const edgesDataset = new DataSet<VisEdge>([]);
    nodesDatasetRef.current = nodesDataset;
    edgesDatasetRef.current = edgesDataset;

    const options: Options = {
      physics: {
        enabled: false
      },
      layout: {
        improvedLayout: true
      },
      interaction: {
        hover: true,
        dragNodes: true,
        navigationButtons: false,
        keyboard: false
      },
      nodes: {
        shape: 'dot',
        size: 26,
        borderWidth: 2,
        font: {
          color: '#e2e8f0',
          face: 'Inter',
          size: 14,
          strokeWidth: 0
        }
      },
      edges: {
        arrows: {
          to: { enabled: true, scaleFactor: 0.6 }
        },
        color: {
          color: '#475569',
          highlight: '#93c5fd',
          hover: '#bfdbfe'
        },
        smooth: {
          enabled: true,
          type: 'continuous',
          roundness: 0.5
        }
      }
    };

    const network = new Network(containerRef.current, { nodes: nodesDataset, edges: edgesDataset }, options);
    networkRef.current = network;
    setNetworkReady(true);

    return () => {
      network.destroy();
      networkRef.current = null;
      nodesDatasetRef.current = null;
      edgesDatasetRef.current = null;
    };
  }, []);

  const timelineCursor = timelineEnabled
    ? timelineCursorMs ?? timelineBounds?.max ?? null
    : null;

  const filteredNodes = useMemo(() => {
    if (!nodes.length) {
      return [];
    }

    const entityTypeSet = new Set(activeEntityTypes);
    const levelSet = new Set(activeLevels);
    const windowMs = Math.max(1, timelineWindowMinutes) * 60 * 1000;

    return nodes.filter(node => {
      if (activeEntityTypes.length > 0 && !entityTypeSet.has(node.entity_type)) {
        return false;
      }

      const level = node.classification_level as ClearanceLevel;
      if (activeLevels.length > 0 && !levelSet.has(level)) {
        return false;
      }

      if (timelineEnabled && timelineCursor != null) {
        const time = getNodeTime(node);
        if (time == null) {
          return true;
        }
        if (timelineWindowMinutes > 0) {
          const lowerBound = timelineCursor - windowMs;
          return time >= lowerBound && time <= timelineCursor;
        }
        return time <= timelineCursor;
      }

      return true;
    });
  }, [
    nodes,
    activeEntityTypes,
    activeLevels,
    timelineEnabled,
    timelineCursor,
    timelineWindowMinutes
  ]);

  const filteredEdges = useMemo(() => {
    if (!edges.length) {
      return [];
    }
    const nodeSet = new Set(filteredNodes.map(node => node.id));
    return edges.filter(
      edge => nodeSet.has(edge.source_node_id) && nodeSet.has(edge.target_node_id)
    );
  }, [edges, filteredNodes]);

  useEffect(() => {
    if (selectedNodeId && !filteredNodes.some(node => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [filteredNodes, selectedNodeId]);

  useEffect(() => {
    setPinnedNodeIds(prev =>
      prev.filter(id => filteredNodes.some(node => node.id === id))
    );
  }, [filteredNodes]);

  const toggleEntityType = useCallback((type: string) => {
    setActiveEntityTypes(prev => {
      if (prev.length === 0) {
        return [type];
      }
      if (prev.includes(type)) {
        const next = prev.filter(item => item !== type);
        return next;
      }
      return [...prev, type];
    });
  }, []);

  const toggleLevel = useCallback((level: ClearanceLevel) => {
    setActiveLevels(prev => {
      if (prev.length === 0) {
        return [level];
      }
      if (prev.includes(level)) {
        const next = prev.filter(item => item !== level);
        return next;
      }
      return [...prev, level].sort(
        (a, b) => LEVEL_SEQUENCE.indexOf(a) - LEVEL_SEQUENCE.indexOf(b)
      );
    });
  }, []);

  const resetFilters = useCallback(() => {
    setActiveEntityTypes([]);
    setActiveLevels([]);
  }, []);

  const togglePinnedNode = useCallback((nodeId: string) => {
    setPinnedNodeIds(prev => {
      if (prev.includes(nodeId)) {
        return prev.filter(id => id !== nodeId);
      }
      if (prev.length >= 4) {
        const [, ...rest] = prev;
        return [...rest, nodeId];
      }
      return [...prev, nodeId];
    });
  }, []);

  const handleTimelineToggle = useCallback(() => {
    setTimelineEnabled(prev => {
      const next = !prev;
      if (!next) {
        setTimelinePlaying(false);
      } else if (timelineBounds) {
        setTimelineCursorMs(timelineBounds.max);
      }
      return next;
    });
  }, [timelineBounds]);

  const focusNode = useCallback((nodeId: string) => {
    const network = networkRef.current;
    if (!network) return;
    network.focus(nodeId, {
      animation: {
        duration: 500,
        easingFunction: 'easeInOutQuad'
      }
    });
    network.selectNodes([nodeId]);
  }, []);

  const handleTimelineCursorChange = useCallback(
    (minutesFromStart: number) => {
      if (!timelineBounds) {
        return;
      }
      const next = timelineBounds.min + minutesFromStart * 60 * 1000;
      setTimelineCursorMs(next);
    },
    [timelineBounds]
  );

  const handleTimelineWindowChange = useCallback((minutes: number) => {
    setTimelineWindowMinutes(minutes);
  }, []);

  const toggleTimelinePlayback = useCallback(() => {
    setTimelinePlaying(prev => !prev);
  }, []);

  const timelineRangeMinutes = useMemo(() => {
    if (!timelineBounds) {
      return 0;
    }
    const diff = Math.max(0, timelineBounds.max - timelineBounds.min);
    return Math.max(1, Math.round(diff / (60 * 1000)));
  }, [timelineBounds]);

  const timelineSliderMax = Math.max(1, timelineRangeMinutes);
  const timelineSliderValue = useMemo(() => {
    if (!timelineBounds || timelineCursor == null) {
      return timelineSliderMax;
    }
    const diff = Math.max(0, timelineCursor - timelineBounds.min);
    const minutes = Math.round(diff / (60 * 1000));
    return Math.min(timelineSliderMax, Math.max(0, minutes));
  }, [timelineBounds, timelineCursor, timelineSliderMax]);

  const selectedNodeTime = selectedNode ? getNodeTime(selectedNode) : null;

  const selectedNodeConnections = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    return edges
      .filter(
        edge =>
          edge.source_node_id === selectedNode.id || edge.target_node_id === selectedNode.id
      )
      .map(edge => {
        const outgoing = edge.source_node_id === selectedNode.id;
        const otherId = outgoing ? edge.target_node_id : edge.source_node_id;
        const other = nodeById.get(otherId) || null;
        const time = Date.parse(edge.attributes?.timestamp || edge.created_at);
        const visible = filteredEdges.some(filtered => filtered.id === edge.id);
        return {
          edge,
          otherNode: other,
          direction: outgoing ? 'outgoing' : 'incoming',
          time: Number.isNaN(time) ? null : time,
          visible
        };
      })
      .sort((a, b) => {
        const timeA = a.time ?? 0;
        const timeB = b.time ?? 0;
        return timeB - timeA;
      });
  }, [edges, filteredEdges, nodeById, selectedNode]);

  const suggestionTips = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    const tips: string[] = [];
    if (!timelineEnabled && selectedNodeTime) {
      tips.push(
        `Включите песочницу и установите время около ${formatTimeLabel(selectedNodeTime)}, чтобы увидеть предысторию появления вершины.`
      );
    }
    if (
      timelineEnabled &&
      selectedNodeTime &&
      timelineCursor != null &&
      timelineWindowMinutes > 0 &&
      selectedNodeTime < timelineCursor - timelineWindowMinutes * 60 * 1000
    ) {
      tips.push('Увеличьте окно времени, чтобы не потерять ранние события для этой вершины.');
    }
    if (activeEntityTypes.length === 0 && entityTypeOptions.length > 1) {
      tips.push('Отфильтруйте типы (например, оставьте только БПЛА), чтобы сфокусироваться на сценарии.');
    }
    if (activeLevels.length === 0 && levelOptions.length > 1) {
      tips.push('Включите сравнение уровней допуска L/M/H, чтобы отработать политику MLS.');
    }
    if (selectedNodeConnections.length === 0) {
      tips.push('Попробуйте построить новый запрос справа, чтобы найти связанные объекты.');
    }
    return Array.from(new Set(tips)).slice(0, 4);
  }, [
    activeEntityTypes,
    activeLevels,
    entityTypeOptions,
    levelOptions,
    selectedNode,
    selectedNodeConnections,
    selectedNodeTime,
    timelineCursor,
    timelineEnabled,
    timelineWindowMinutes
  ]);

  const neighborSuggestions = useMemo(
    () => selectedNodeConnections.filter(item => item.otherNode).slice(0, 3),
    [selectedNodeConnections]
  );

  const selectedNodeAttributes = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    return Object.entries(selectedNode.attributes || {}).sort(([a], [b]) =>
      a.localeCompare(b)
    );
  }, [selectedNode]);

  const selectedNodePinned = selectedNode ? pinnedNodeIds.includes(selectedNode.id) : false;

  const pinnedNodes = useMemo(
    () =>
      pinnedNodeIds
        .map(id => nodeById.get(id) || null)
        .filter((node): node is GraphNode => Boolean(node)),
    [nodeById, pinnedNodeIds]
  );

  const miniGraphData = useMemo(() => {
    if (!selectedNode) {
      return null;
    }
    const results = selectedNodeConnections.filter(item => item.otherNode);
    return results.slice(0, 8);
  }, [selectedNode, selectedNodeConnections]);

  const updateNetwork = useCallback(
    (sourceNodes: GraphNode[], sourceEdges: GraphEdge[]) => {
      if (!nodesDatasetRef.current || !edgesDatasetRef.current) {
        return;
      }

      const positionsCache = positionsCacheRef.current;
      const visibleIds = new Set(sourceNodes.map(node => node.id));
      positionsCache.forEach((_, id) => {
        if (!visibleIds.has(id)) {
          positionsCache.delete(id);
        }
      });

      const levelOrder: ClearanceLevel[] = ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET'];
      const grouped = levelOrder
        .map(level => ({ level, nodes: sourceNodes.filter(node => node.classification_level === level) }))
        .filter(group => group.nodes.length > 0);

      const positions = new Map<string, { x: number; y: number }>();
      const ringSpacing = 220;
      const baseRadius = Math.max(200, 50 * grouped.length + 40 * sourceNodes.length);

      grouped.forEach((group, ringIndex) => {
        const radius = baseRadius + ringSpacing * ringIndex;
        const count = group.nodes.length;
        if (count === 1) {
          const singleNode = group.nodes[0];
          const cached = positionsCache.get(singleNode.id);
          positions.set(
            singleNode.id,
            cached || { x: 0, y: -radius }
          );
          return;
        }
        group.nodes.forEach((node, idx) => {
          const cached = positionsCache.get(node.id);
          if (cached) {
            positions.set(node.id, cached);
            return;
          }
          const angle = (idx / count) * 2 * Math.PI;
          positions.set(node.id, {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius
          });
        });
      });

      const visNodes: VisNode[] = sourceNodes.map(node => {
        const entityColor = ENTITY_COLORS[node.entity_type] || '#64748b';
        const levelColor = LEVEL_COLORS[node.classification_level as ClearanceLevel] || '#475569';
        const label = viewMode === 'overlay' ? `${node.name}\n[${node.classification_level}]` : node.name;
        const isSource = edgeSource?.nodeId === node.id;
        const isHighlighted = highlightSet.has(node.id);
        const position = positions.get(node.id) || { x: 0, y: 0 };

        return {
          id: node.id,
          label,
          group: node.entity_type,
          title: `${node.name}\nТип: ${ENTITY_LABELS[node.entity_type] || node.entity_type}\nУровень допуска: ${LEVEL_LABELS[node.classification_level] || node.classification_level}\nСектор: ${node.attributes?.sector ?? '—'}`,
          color: {
            background: isHighlighted ? '#1e3a8a' : entityColor,
            border: isSource ? '#38bdf8' : isHighlighted ? '#facc15' : levelColor,
            highlight: {
              background: entityColor,
              border: '#ffffff'
            },
            hover: {
              background: entityColor,
              border: '#bae6fd'
            }
          },
          size: isHighlighted ? 32 : 24,
          shadow: isSource || isHighlighted,
          baseColor: entityColor,
          baseBorder: levelColor,
          physics: false,
          x: position.x,
          y: position.y,
          font: {
            color: '#e2e8f0',
            size: isHighlighted ? 16 : 14,
            face: 'Inter',
            strokeWidth: 0
          }
        } as VisNode;
      });

      const visEdges: VisEdge[] = sourceEdges.map(edge => ({
        id: edge.id,
        from: edge.source_node_id,
        to: edge.target_node_id,
        label: edge.relation_type,
        color: {
          color: highlightSet.has(edge.source_node_id) || highlightSet.has(edge.target_node_id) ? '#facc15' : '#64748b',
          hover: '#fbbf24',
          highlight: '#fde68a'
        },
        font: {
          color: '#cbd5f5',
          size: 11,
          background: 'rgba(30,41,59,0.9)'
        },
        smooth: {
          enabled: true,
          type: 'dynamic',
          roundness: 0.4
        }
      }));

      nodesDatasetRef.current.clear();
      nodesDatasetRef.current.add(visNodes);
      edgesDatasetRef.current.clear();
      edgesDatasetRef.current.add(visEdges);

      positions.forEach((value, key) => {
        positionsCache.set(key, value);
      });

      requestAnimationFrame(() => {
        networkRef.current?.fit({
          animation: {
            duration: 400,
            easingFunction: 'easeInOutQuad'
          }
        });
      });
    },
    [edgeSource, highlightSet, viewMode]
  );

  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const options: GraphDataOptions = {
        mode: viewMode,
        level: selectedLevel,
        overlayLevels: effectiveOverlayLevels
      };
      const data = await getGraphData(user, options);
      setNodes(data.nodes);
      setEdges(data.edges);
    } catch (error) {
      console.error('Failed to load graph:', error);
    } finally {
      setLoading(false);
    }
  }, [effectiveOverlayLevels, selectedLevel, user, viewMode]);

  useEffect(() => {
    if (!networkReady) return;
    loadGraph();
  }, [networkReady, loadGraph, refreshToken]);

useEffect(() => {
  if (!networkReady) return;
  updateNetwork(filteredNodes, filteredEdges);
}, [filteredEdges, filteredNodes, networkReady, updateNetwork]);

  const clearEdgeSelection = useCallback(() => {
    setEdgeSource(null);
  }, []);

  const startEdgeSelection = useCallback((node: GraphNode) => {
    setEdgeSource({ nodeId: node.id, label: node.name, level: node.classification_level as ClearanceLevel });
  }, []);

  const handleAddNode = useCallback(
    async (pointer?: { x: number; y: number }) => {
      closeContextMenu();

      const name = window.prompt('Название новой вершины:');
      if (!name) return;

      const defaultType = 'Target';
      const entityType = window.prompt('Тип сущности (Target/Sensor/Event/...)', defaultType) || defaultType;

      const fallbackLevel: ClearanceLevel = ((): ClearanceLevel => {
        if (viewMode === 'level' && selectedLevel) {
          return toLevel(selectedLevel, user.clearance_level as ClearanceLevel);
        }
        if (viewMode === 'overlay' && effectiveOverlayLevels.length) {
          return effectiveOverlayLevels[0];
        }
        return user.clearance_level as ClearanceLevel;
      })();

      const levelInput = window.prompt('Уровень (L/M/H):', fallbackLevel[0]);
      const classification = LEVEL_FROM_INPUT(levelInput, fallbackLevel);

      const sector = window.prompt('Сектор или расположение:', 'A') || 'N/A';
      const nowIso = new Date().toISOString();
      const attributes = {
        sector,
        created_at: nowIso,
        note: 'Добавлено вручную',
        ...(pointer ? { position_hint: `${Math.round(pointer.x)},${Math.round(pointer.y)}` } : {})
      } as Record<string, any>;

      try {
        await createNode({
          name,
          entity_type: entityType,
          classification_level: classification,
          attributes
        });
        setEdgeSource(null);
        await loadGraph();
      } catch (error: any) {
        window.alert(error?.message || 'Не удалось создать вершину.');
      }
    },
    [closeContextMenu, effectiveOverlayLevels, loadGraph, selectedLevel, user.clearance_level, viewMode]
  );

  const handleRemoveNode = useCallback(
    async (node: GraphNode) => {
      closeContextMenu();
      const confirmed = window.confirm(`Удалить вершину «${node.name}» (уровень ${node.classification_level})?`);
      if (!confirmed) return;
      try {
        await deleteNode(node.logical_id, node.classification_level);
        if (edgeSource?.nodeId === node.id) {
          setEdgeSource(null);
        }
        if (selectedNodeId === node.id) {
          setSelectedNodeId(null);
        }
        await loadGraph();
      } catch (error: any) {
        window.alert(error?.message || 'Не удалось удалить вершину.');
      }
    },
    [closeContextMenu, edgeSource, loadGraph, selectedNodeId]
  );

  const findNodeById = useCallback(
    (nodeId: string): GraphNode | null => {
      return nodes.find(node => node.id === nodeId) || null;
    },
    [nodes]
  );

  const handleCompleteEdge = useCallback(
    async (targetNode: GraphNode) => {
      closeContextMenu();
      if (!edgeSource) return;

      if (targetNode.id === edgeSource.nodeId) {
        setEdgeSource(null);
        return;
      }

      if (targetNode.classification_level !== edgeSource.level) {
        window.alert('Связи можно создавать только между вершинами одного уровня.');
        setEdgeSource(null);
        return;
      }

      const relationTypeInput = window.prompt('Тип связи:', 'ASSOCIATED_WITH');
      if (!relationTypeInput) {
        setEdgeSource(null);
        return;
      }
      const relationType = relationTypeInput.trim() || 'ASSOCIATED_WITH';

      const attributesInput = window.prompt('Дополнительные атрибуты (ключ=значение через запятую)', '');
      const attributes: Record<string, any> = {};
      if (attributesInput) {
        attributesInput.split(',').forEach(pair => {
          const [key, value] = pair.split('=');
          if (key && value) {
            attributes[key.trim()] = value.trim();
          }
        });
      }

      try {
        await createEdge({
          source_node_id: edgeSource.nodeId,
          target_node_id: targetNode.id,
          relation_type: relationType,
          classification_level: edgeSource.level,
          attributes
        });
        setEdgeSource(null);
        await loadGraph();
      } catch (error: any) {
        window.alert(error?.message || 'Не удалось создать связь.');
        setEdgeSource(null);
      }
    },
    [closeContextMenu, edgeSource, loadGraph]
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      const targetNode = findNodeById(nodeId);
      if (!targetNode) {
        setSelectedNodeId(null);
        return;
      }

      if (edgeSource) {
        if (targetNode.classification_level !== edgeSource.level) {
          window.alert('Связи можно создавать только между вершинами одного уровня.');
          setEdgeSource(null);
          return;
        }
        void handleCompleteEdge(targetNode);
        return;
      }

      setSelectedNodeId(nodeId);
    },
    [edgeSource, findNodeById, handleCompleteEdge]
  );

  const handleRemoveEdge = useCallback(
    async (edge: GraphEdge) => {
      closeContextMenu();
      const confirmed = window.confirm(`Удалить связь «${edge.relation_type}»?`);
      if (!confirmed) return;
      try {
        await deleteEdge(edge.id);
        await loadGraph();
      } catch (error: any) {
        window.alert(error?.message || 'Не удалось удалить связь.');
      }
    },
    [closeContextMenu, loadGraph]
  );

  const findEdgeById = useCallback((edgeId: string): GraphEdge | null => {
    return edges.find(edge => edge.id === edgeId) || null;
  }, [edges]);

  const buildNodeMenu = useCallback(
    (nodeId: string): ContextMenuItem[] => {
      const node = findNodeById(nodeId);
      if (!node) return [];

      const items: ContextMenuItem[] = [];

      if (edgeSource) {
        if (edgeSource.nodeId === node.id) {
          items.push({ label: 'Отменить выбор связи', action: clearEdgeSelection });
        } else if (edgeSource.level === node.classification_level) {
          items.push({
            label: `Завершить связь с «${node.name}»`,
            action: () => handleCompleteEdge(node)
          });
          items.push({ label: 'Отменить выбор связи', action: clearEdgeSelection });
        } else {
          items.push({ label: `Завершить связь (уровень ${edgeSource.level})`, disabled: true });
          items.push({ label: 'Отменить выбор связи', action: clearEdgeSelection });
        }
      } else {
        items.push({ label: 'Начать связь', action: () => startEdgeSelection(node) });
      }

      items.push({ label: 'Удалить вершину', action: () => handleRemoveNode(node) });
      return items;
    },
    [clearEdgeSelection, edgeSource, findNodeById, handleCompleteEdge, handleRemoveNode, startEdgeSelection]
  );

  const buildEdgeMenu = useCallback(
    (edgeId: string): ContextMenuItem[] => {
      const edge = findEdgeById(edgeId);
      if (!edge) return [];
      return [{ label: 'Удалить связь', action: () => handleRemoveEdge(edge) }];
    },
    [findEdgeById, handleRemoveEdge]
  );

  const handleNetworkContext = useCallback(
    (params: any) => {
      params.event.preventDefault();
      const network = networkRef.current;
      if (!network || !containerRef.current) return;

      const pointerDOM = params.pointer?.DOM || { x: params.event.offsetX, y: params.event.offsetY };
      const clientX = params.event.clientX;
      const clientY = params.event.clientY;

      const nodeId = params.nodes && params.nodes[0] ? params.nodes[0] : network.getNodeAt(pointerDOM);
      if (nodeId) {
        const items = buildNodeMenu(nodeId);
        openContextMenu(clientX, clientY, items);
        return;
      }

      const edgeId = params.edges && params.edges[0] ? params.edges[0] : network.getEdgeAt(pointerDOM);
      if (edgeId) {
        openContextMenu(clientX, clientY, buildEdgeMenu(edgeId));
        return;
      }

      const items: ContextMenuItem[] = [
        { label: 'Добавить вершину', action: () => handleAddNode(params.pointer?.canvas) }
      ];
      if (edgeSource) {
        items.push({ label: `Отменить выбор связи (${edgeSource.label})`, action: clearEdgeSelection });
      }
      openContextMenu(clientX, clientY, items);
    },
    [buildEdgeMenu, buildNodeMenu, clearEdgeSelection, edgeSource, handleAddNode, openContextMenu]
  );

  useEffect(() => {
    const network = networkRef.current;
    if (!network) return;
    network.on('oncontext', handleNetworkContext);
    const handleClick = (params: any) => {
      if (params.nodes && params.nodes.length === 1) {
        handleNodeClick(params.nodes[0]);
        return;
      }
      if (!edgeSource) {
        setSelectedNodeId(null);
      }
    };
    network.on('click', handleClick);
    return () => {
      network.off('oncontext', handleNetworkContext);
      network.off('click', handleClick);
    };
  }, [edgeSource, handleNetworkContext, handleNodeClick]);

  return (
    <div
      className="relative w-full h-full bg-slate-900 select-none flex"
      role="region"
      aria-label="Просмотр графа связей"
    >
      <div className="relative flex-1">
        <div ref={containerRef} className="w-full h-full" />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
            <div className="text-slate-400">Загрузка графа...</div>
          </div>
        )}

        <div className="absolute top-4 left-4 bg-slate-800/90 border border-slate-700 rounded-lg p-4 text-xs shadow-lg max-w-md">
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-200 font-semibold text-sm">Быстрые фильтры</span>
            <button
              type="button"
              onClick={resetFilters}
              className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors duration-150"
              aria-label="Сбросить фильтры графа"
            >
              Сброс
            </button>
          </div>
          <div className="mb-3">
            <div className="text-slate-400 uppercase text-[10px] mb-1 tracking-wide">Типы</div>
            <div className="flex flex-wrap gap-1">
              {entityTypeOptions.map(type => {
                const explicit = activeEntityTypes.length > 0;
                const active = explicit ? activeEntityTypes.includes(type) : true;
                const baseClasses = 'px-2 py-1 rounded-full text-[11px] transition-colors duration-150';
                const className = explicit
                  ? active
                    ? `${baseClasses} bg-blue-600 text-white`
                    : `${baseClasses} bg-slate-700 text-slate-400 hover:bg-slate-600`
                  : `${baseClasses} bg-slate-700/80 text-slate-200 hover:bg-slate-600`;
                const label = ENTITY_LABELS[type] || type;
                return (
                  <button
                    key={type}
                    type="button"
                    className={className}
                    onClick={() => toggleEntityType(type)}
                    aria-pressed={active}
                    aria-label={`Фильтр по типу: ${label}`}
                    title={`Фильтр по типу: ${label}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mb-3">
            <div className="text-slate-400 uppercase text-[10px] mb-1 tracking-wide">Уровни</div>
            <div className="flex flex-wrap gap-1">
              {levelOptions.map(level => {
                const explicit = activeLevels.length > 0;
                const active = explicit ? activeLevels.includes(level) : true;
                const baseClasses = 'px-2 py-1 rounded-full text-[11px] transition-colors duration-150';
                const className = explicit
                  ? active
                    ? `${baseClasses} bg-purple-600 text-white`
                    : `${baseClasses} bg-slate-700 text-slate-400 hover:bg-slate-600`
                  : `${baseClasses} bg-slate-700/80 text-slate-200 hover:bg-slate-600`;
                const label = LEVEL_LABELS[level] || level;
                return (
                  <button
                    key={level}
                    type="button"
                    className={className}
                    onClick={() => toggleLevel(level)}
                    aria-pressed={active}
                    aria-label={`Фильтр по уровню: ${label}`}
                    title={`Фильтр по уровню: ${label}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="text-[11px] text-slate-400">
            Видимо: {filteredNodes.length}/{nodes.length} · Связи: {filteredEdges.length}/{edges.length}
          </div>
        </div>

        <div className="absolute top-4 right-4 bg-slate-800/90 border border-slate-700 rounded-lg p-4 text-sm shadow-lg">
          <div className="text-slate-300 font-medium mb-2">Легенда</div>
          <div className="space-y-1">
            {Object.entries(ENTITY_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-slate-400 text-xs">{ENTITY_LABELS[type] || type}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700 text-slate-400 text-xs space-y-1">
            <div>Вершины: {filteredNodes.length}/{nodes.length}</div>
            <div>Связи: {filteredEdges.length}/{edges.length}</div>
          </div>
          {edgeSource ? (
            <div className="mt-3 text-xs text-blue-300">
              Выбор связи: {edgeSource.label} ({edgeSource.level})
            </div>
          ) : null}
        </div>

        <div className="absolute bottom-4 left-4 bg-slate-800/90 border border-slate-700 rounded-lg p-4 text-xs shadow-lg w-80">
          <div className="flex items-center justify-between mb-3">
            <div className="text-slate-200 font-semibold text-sm">Песочница</div>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={timelineEnabled}
                onChange={handleTimelineToggle}
                className="h-3 w-3 accent-blue-500"
              />
              <span className="text-slate-300 text-xs">Вкл.</span>
            </label>
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>Момент времени</span>
              <span className="text-slate-200">{formatTimeLabel(timelineEnabled ? timelineCursor : null)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={timelineSliderMax}
              step={1}
              value={timelineEnabled ? timelineSliderValue : timelineSliderMax}
              disabled={!timelineEnabled || !timelineBounds}
              onChange={event => handleTimelineCursorChange(Number(event.target.value))}
              className="w-full accent-blue-500"
              aria-label="Позиция на временной шкале"
            />
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>Окно (мин)</span>
              <span className="text-slate-200">{timelineWindowMinutes}</span>
            </div>
            <input
              type="range"
              min={5}
              max={240}
              step={5}
              value={timelineWindowMinutes}
              disabled={!timelineEnabled}
              onChange={event => handleTimelineWindowChange(Number(event.target.value))}
              className="w-full accent-blue-500"
              aria-label="Размер временного окна в минутах"
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleTimelinePlayback}
              disabled={!timelineEnabled || !timelineBounds}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white text-xs transition-colors duration-150"
              aria-label={timelinePlaying ? 'Остановить воспроизведение временной шкалы' : 'Запустить воспроизведение временной шкалы'}
            >
              {timelinePlaying ? 'Пауза' : 'Пуск'}
            </button>
            {timelineBounds ? (
              <div className="text-[11px] text-slate-400">
                Длина трека: {Math.max(1, Math.round((timelineBounds.max - timelineBounds.min) / (60 * 1000)))} мин
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">В данных нет временных отметок</div>
            )}
          </div>
        </div>

        {contextMenu.visible && (
          <>
            <button
              type="button"
              className="absolute inset-0 bg-transparent cursor-default"
              onClick={() => {
                closeContextMenu();
              }}
            />
            <div
              className="absolute z-30 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1"
              style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 200 }}
            >
              {contextMenu.items.map((item, index) => (
                <button
                  key={`${item.label}-${index}`}
                  type="button"
                  disabled={item.disabled}
                  className={`block w-full text-left px-3 py-2 text-sm transition-colors duration-150 ${
                    item.disabled
                      ? 'text-slate-500 cursor-not-allowed'
                      : 'text-slate-200 hover:bg-slate-700'
                  }`}
                  onClick={() => {
                    if (item.disabled) return;
                    closeContextMenu();
                    item.action?.();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}

        {edgeSource ? (
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-blue-600/90 text-white text-sm px-4 py-2 rounded-full shadow-lg"
            role="status"
            aria-live="polite"
          >
            Выберите вторую вершину этого же уровня левой кнопкой мыши или правой кнопкой отмените выбор
          </div>
        ) : null}
      </div>

      <aside className="w-80 border-l border-slate-800 bg-slate-900/90 backdrop-blur-sm flex flex-col">
        {selectedNode ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-slate-100 font-semibold text-base leading-tight">{selectedNode.name}</div>
                <div className="text-xs text-slate-400 mt-1">
                  Тип: {ENTITY_LABELS[selectedNode.entity_type] || selectedNode.entity_type}
                </div>
                {selectedNodeTime ? (
                  <div className="text-[11px] text-slate-500 mt-1">
                    Последнее наблюдение: {formatTimeLabel(selectedNodeTime)}
                  </div>
                ) : null}
              </div>
              <div
                className={`text-[10px] font-semibold px-2 py-1 rounded uppercase tracking-wide ${(() => {
                  switch (selectedNode.classification_level) {
                    case 'SECRET':
                      return 'bg-red-600 text-white';
                    case 'CONFIDENTIAL':
                      return 'bg-amber-600 text-white';
                    default:
                      return 'bg-slate-600 text-white';
                  }
                })()}`}
              >
                {selectedNode.classification_level}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => focusNode(selectedNode.id)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors duration-150"
                aria-label="Сфокусировать граф на выбранной вершине"
              >
                Фокус
              </button>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded transition-colors duration-150"
                aria-label="Скрыть карточку выбранной вершины"
              >
                Скрыть
              </button>
              <button
                type="button"
                onClick={() => togglePinnedNode(selectedNode.id)}
                className={`px-3 py-1.5 text-xs rounded transition-colors duration-150 ${
                  selectedNodePinned
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                }`}
                aria-pressed={selectedNodePinned}
                aria-label={selectedNodePinned ? 'Удалить вершину из списка сравнения' : 'Добавить вершину к сравнению'}
              >
                {selectedNodePinned ? 'В сравнении' : 'К сравнению'}
              </button>
            </div>

            <div>
              <h3 className="text-sm text-slate-300 font-semibold mb-2">Основные атрибуты</h3>
              <div className="space-y-1 text-xs text-slate-300">
                <div className="flex gap-1">
                  <span className="text-slate-400">ID:</span>
                  <span className="text-slate-200">{selectedNode.logical_id}</span>
                </div>
                <div className="flex gap-1">
                  <span className="text-slate-400">Создано:</span>
                  <span className="text-slate-200">
                    {new Date(selectedNode.created_at).toLocaleString('ru-RU')}
                  </span>
                </div>
                <div className="flex gap-1">
                  <span className="text-slate-400">Обновлено:</span>
                  <span className="text-slate-200">
                    {new Date(selectedNode.updated_at).toLocaleString('ru-RU')}
                  </span>
                </div>
                {selectedNodeAttributes.length ? (
                  <div className="pt-2 space-y-1">
                    {selectedNodeAttributes.map(([key, value]) => (
                      <div key={key} className="text-xs">
                        <span className="text-slate-400">{key}:</span>{' '}
                        {value && typeof value === 'object' ? (
                          <pre className="bg-slate-800/80 border border-slate-700 rounded mt-1 px-2 py-1 text-[11px] text-slate-200 whitespace-pre-wrap">
                            {renderAttributeValue(value)}
                          </pre>
                        ) : (
                          <span className="text-slate-200">{renderAttributeValue(value)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-500 text-xs">Дополнительных атрибутов нет</div>
                )}
              </div>
            </div>

            {miniGraphData && miniGraphData.length ? (
              <div>
                <h3 className="text-sm text-slate-300 font-semibold mb-2">Мини-граф связей</h3>
                <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-3">
                  <svg
                    width={160}
                    height={160}
                    viewBox="0 0 160 160"
                    role="img"
                    aria-label="Мини-граф связей выбранной вершины"
                  >
                    <circle cx={80} cy={80} r={18} fill="#2563eb" opacity={0.9} />
                    <text
                      x={80}
                      y={83}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#f8fafc"
                    >
                      {selectedNode.name.slice(0, 8)}
                    </text>
                    {miniGraphData.map((item, index) => {
                      if (!item.otherNode) {
                        return null;
                      }
                      const total = miniGraphData.length;
                      const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
                      const radius = 55;
                      const x = 80 + Math.cos(angle) * radius;
                      const y = 80 + Math.sin(angle) * radius;
                      const color = ENTITY_COLORS[item.otherNode.entity_type] || '#94a3b8';
                      const isPinnedNeighbor = pinnedNodeIds.includes(item.otherNode.id);
                      return (
                        <g key={item.edge.id}>
                          <line
                            x1={80}
                            y1={80}
                            x2={x}
                            y2={y}
                            stroke={isPinnedNeighbor ? '#facc15' : '#64748b'}
                            strokeWidth={isPinnedNeighbor ? 2 : 1}
                            strokeDasharray={item.direction === 'outgoing' ? '4 2' : '0'}
                            opacity={0.8}
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r={12}
                            fill={color}
                            opacity={0.9}
                          />
                          <text
                            x={x}
                            y={y + 3}
                            textAnchor="middle"
                            fontSize={8}
                            fill="#0f172a"
                          >
                            {item.otherNode.name.slice(0, 6)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  <div className="mt-2 text-[11px] text-slate-400">
                    Показаны ближайшие {miniGraphData.length} связи. Пунктир обозначает исходящие от узла.
                  </div>
                </div>
              </div>
            ) : null}

            <div>
              <h3 className="text-sm text-slate-300 font-semibold mb-2">История связей</h3>
              {selectedNodeConnections.length ? (
                <div className="space-y-2">
                  {selectedNodeConnections.map(item => (
                    <div key={item.edge.id} className="bg-slate-800/80 border border-slate-700 rounded p-3 text-xs text-slate-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-slate-100">
                          {item.direction === 'outgoing' ? '→' : '←'} {item.edge.relation_type}
                        </span>
                        <span className="text-slate-500 text-[10px]">
                          {item.time ? formatTimeLabel(item.time) : 'без времени'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-slate-300 text-[11px]">
                          {item.otherNode ? item.otherNode.name : 'неизвестная вершина'}
                        </div>
                        {item.otherNode ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedNodeId(item.otherNode!.id);
                              focusNode(item.otherNode!.id);
                            }}
                            className="px-2 py-1 text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors duration-150"
                          >
                            Открыть
                          </button>
                        ) : null}
                      </div>
                      {!item.visible ? (
                        <div className="mt-2 text-[10px] text-amber-300">
                          Связь скрыта текущими фильтрами/временем
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 text-xs">Связей пока нет</div>
              )}
            </div>

            {pinnedNodes.length ? (
              <div>
                <h3 className="text-sm text-slate-300 font-semibold mb-2">Сравнение</h3>
                <div className="space-y-2">
                  {pinnedNodes.map(node => (
                    <div
                      key={node.id}
                      className={`border rounded-lg px-3 py-2 text-xs ${
                        node.id === selectedNode?.id
                          ? 'border-blue-500/60 bg-blue-900/30 text-blue-100'
                          : 'border-slate-700 bg-slate-800/70 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[12px] truncate" title={node.name}>
                          {node.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => togglePinnedNode(node.id)}
                          className="text-[10px] text-slate-400 hover:text-slate-200"
                          aria-label={`Удалить ${node.name} из сравнения`}
                        >
                          Удалить
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {ENTITY_LABELS[node.entity_type] || node.entity_type} · {node.classification_level}
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] text-slate-300">
                        <span>
                          <span className="text-slate-500">Сектор:</span>{' '}
                          {node.attributes?.sector || '—'}
                        </span>
                        <span>
                          <span className="text-slate-500">Статус:</span>{' '}
                          {node.attributes?.status || node.attributes?.operational || '—'}
                        </span>
                        <span className="col-span-2">
                          <span className="text-slate-500">Последнее обновление:</span>{' '}
                          {new Date(node.updated_at).toLocaleTimeString('ru-RU')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <h3 className="text-sm text-slate-300 font-semibold mb-2">Что посмотреть дальше</h3>
              {neighborSuggestions.length ? (
                <div className="flex flex-wrap gap-2 mb-2">
                  {neighborSuggestions.map(item => (
                    <button
                      key={item.edge.id}
                      type="button"
                      className="px-2 py-1 text-[11px] bg-blue-600/80 hover:bg-blue-700 text-white rounded transition-colors duration-150"
                      onClick={() => {
                        if (item.otherNode) {
                          setSelectedNodeId(item.otherNode.id);
                          focusNode(item.otherNode.id);
                        }
                      }}
                    >
                      {item.otherNode ? item.otherNode.name : 'Связанный узел'}
                    </button>
                  ))}
                </div>
              ) : null}
              {suggestionTips.length ? (
                <ul className="list-disc list-inside space-y-1 text-xs text-slate-400">
                  {suggestionTips.map(tip => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-slate-500 text-xs">Выберите соседние вершины или настройте фильтры.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 p-4 text-xs text-slate-400 space-y-3">
            <div className="text-slate-200 font-medium text-sm">Карточка объекта</div>
            <p>Щёлкните по вершине, чтобы открыть подробности: атрибуты, связи и подсказки для сценариев обучения.</p>
            <p>Используйте фильтры слева, чтобы ограничить граф по типу сущности и уровню секретности, а песочницу — для отработки ситуаций во времени.</p>
            <p>Подсветка из правой панели запросов автоматически отображается здесь; используйте это для разборов отказов и политик доступа.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
