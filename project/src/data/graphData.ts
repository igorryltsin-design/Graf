import { GraphNode, GraphEdge } from '../lib/types';

export const graphNodes: GraphNode[] = [
  {
    "id": "target_uav_1_CONFIDENTIAL",
    "logical_id": "target_uav_1",
    "classification_level": "CONFIDENTIAL",
    "entity_type": "Target",
    "name": "Беспилотник в секторе А",
    "attributes": {
      "sector": "A",
      "category": "UAV",
      "coordinates": "северная часть сектора А",
      "speed": 180,
      "heading": 270,
      "last_seen": "2024-05-12T09:55:00Z",
      "threat_level": "elevated"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "target_uav_2_CONFIDENTIAL",
    "logical_id": "target_uav_2",
    "classification_level": "CONFIDENTIAL",
    "entity_type": "Target",
    "name": "Беспилотник возле рубежа А",
    "attributes": {
      "sector": "A",
      "category": "UAV",
      "coordinates": "центральная часть сектора А",
      "speed": 160,
      "heading": 280,
      "last_seen": "2024-05-12T09:50:00Z",
      "threat_level": "medium"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "target_group_sector_b_CONFIDENTIAL",
    "logical_id": "target_group_sector_b",
    "classification_level": "CONFIDENTIAL",
    "entity_type": "Target",
    "name": "Воздушные цели сектор B",
    "attributes": {
      "sector": "B",
      "category": "AirGroup",
      "coordinates": "западные рубежи сектор B",
      "last_seen": "2024-05-12T09:42:00Z",
      "threat_level": "high",
      "composition": "минимум 1 высокоскоростная цель"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "target_activity_sector_c_CONFIDENTIAL",
    "logical_id": "target_activity_sector_c",
    "classification_level": "CONFIDENTIAL",
    "entity_type": "Target",
    "name": "Активность БПЛА сектор C",
    "attributes": {
      "sector": "C",
      "category": "UAV",
      "coordinates": "южный коридор сектор C",
      "last_seen": "2024-05-12T09:48:00Z",
      "threat_level": "medium"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "event_intercept_1_CONFIDENTIAL",
    "logical_id": "event_intercept_1",
    "classification_level": "CONFIDENTIAL",
    "entity_type": "Event",
    "name": "Действия по целям сектора А",
    "attributes": {
      "sector": "A",
      "timestamp": "2024-05-12T09:45:00Z",
      "description": "Проведено поражение воздушной цели",
      "severity": "medium"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "event_warning_b_CONFIDENTIAL",
    "logical_id": "event_warning_b",
    "classification_level": "CONFIDENTIAL",
    "entity_type": "Event",
    "name": "Предупреждение сектор B",
    "attributes": {
      "sector": "B",
      "timestamp": "2024-05-12T09:40:00Z",
      "description": "Повышенный уровень активности авиации",
      "severity": "high"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "target_uav_1_SECRET",
    "logical_id": "target_uav_1",
    "classification_level": "SECRET",
    "entity_type": "Target",
    "name": "БПЛА-1",
    "attributes": {
      "sector": "A",
      "category": "UAV",
      "coordinates": [
        54.2101,
        37.5203
      ],
      "speed": 180,
      "heading": 275,
      "last_seen": "2024-05-12T09:58:00Z",
      "threat_level": "HIGH"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "target_uav_2_SECRET",
    "logical_id": "target_uav_2",
    "classification_level": "SECRET",
    "entity_type": "Target",
    "name": "БПЛА-2",
    "attributes": {
      "sector": "A",
      "category": "UAV",
      "coordinates": [
        54.1985,
        37.4801
      ],
      "speed": 165,
      "heading": 280,
      "last_seen": "2024-05-12T09:52:00Z",
      "threat_level": "MEDIUM"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "target_unknown_3_SECRET",
    "logical_id": "target_unknown_3",
    "classification_level": "SECRET",
    "entity_type": "Target",
    "name": "Неидентифицированная цель",
    "attributes": {
      "sector": "B",
      "category": "Unknown",
      "coordinates": [
        54.315,
        37.595
      ],
      "speed": 210,
      "heading": 260,
      "last_seen": "2024-05-12T09:40:00Z",
      "threat_level": "HIGH"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "target_uav_4_SECRET",
    "logical_id": "target_uav_4",
    "classification_level": "SECRET",
    "entity_type": "Target",
    "name": "БПЛА-4",
    "attributes": {
      "sector": "C",
      "category": "UAV",
      "coordinates": [
        54.2561,
        37.6104
      ],
      "speed": 190,
      "heading": 240,
      "last_seen": "2024-05-12T09:49:00Z",
      "threat_level": "MEDIUM"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "target_helicopter_5_SECRET",
    "logical_id": "target_helicopter_5",
    "classification_level": "SECRET",
    "entity_type": "Target",
    "name": "Вертолет разведки",
    "attributes": {
      "sector": "B",
      "category": "Helicopter",
      "coordinates": [
        54.3322,
        37.5804
      ],
      "speed": 210,
      "heading": 195,
      "last_seen": "2024-05-12T09:43:00Z",
      "threat_level": "HIGH"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "sensor_radar_a_CONFIDENTIAL",
    "logical_id": "sensor_radar_a",
    "classification_level": "CONFIDENTIAL",
    "entity_type": "Sensor",
    "name": "РЛС 64Н6 сектор А",
    "attributes": {
      "sector": "A",
      "location": "опорный пункт А1",
      "platform": "radar",
      "status": "online"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "sensor_optic_a_CONFIDENTIAL",
    "logical_id": "sensor_optic_a",
    "classification_level": "CONFIDENTIAL",
    "entity_type": "Sensor",
    "name": "ОЭК сектор А",
    "attributes": {
      "sector": "A",
      "location": "опорный пункт А2",
      "platform": "optical",
      "status": "offline"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "sensor_radar_b_SECRET",
    "logical_id": "sensor_radar_b",
    "classification_level": "SECRET",
    "entity_type": "Sensor",
    "name": "РЛС ПРО сектор B",
    "attributes": {
      "sector": "B",
      "location": "опорный пункт B1",
      "platform": "radar_long_range",
      "status": "online"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "sensor_sigint_c_SECRET",
    "logical_id": "sensor_sigint_c",
    "classification_level": "SECRET",
    "entity_type": "Sensor",
    "name": "РЭР пост сектор C",
    "attributes": {
      "sector": "C",
      "location": "высота С3",
      "platform": "sigint",
      "status": "online"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "command_center_alpha_SECRET",
    "logical_id": "command_center_alpha",
    "classification_level": "SECRET",
    "entity_type": "CommandPost",
    "name": "КП Альфа",
    "attributes": {
      "sector": "A",
      "status": "operational",
      "commander": "Подполковник Орлов",
      "frequency": "121.6"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "event_intercept_1_SECRET",
    "logical_id": "event_intercept_1",
    "classification_level": "SECRET",
    "entity_type": "Event",
    "name": "Попытка перехвата БПЛА",
    "attributes": {
      "sector": "A",
      "timestamp": "2024-05-12T09:45:00Z",
      "description": "Запуск ЗУР по цели БПЛА-1",
      "severity": "high"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "event_alert_sector_b_SECRET",
    "logical_id": "event_alert_sector_b",
    "classification_level": "SECRET",
    "entity_type": "Event",
    "name": "Повышенный уровень угрозы сектор B",
    "attributes": {
      "sector": "B",
      "timestamp": "2024-05-12T09:38:00Z",
      "description": "Выявлены сигнатуры вертолёта разведки и РЭР",
      "severity": "critical"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "event_sigint_ping_SECRET",
    "logical_id": "event_sigint_ping",
    "classification_level": "SECRET",
    "entity_type": "Event",
    "name": "РЭР засек сигнал управления",
    "attributes": {
      "sector": "C",
      "timestamp": "2024-05-12T09:47:00Z",
      "description": "Зафиксирован канал управления БПЛА-4",
      "severity": "medium"
    },
    "created_at": "2024-05-12T10:00:00Z",
    "updated_at": "2024-05-12T10:00:00Z"
  }
];

export const graphEdges: GraphEdge[] = [
  {
    "id": "rel_event_group_b_CONFIDENTIAL",
    "logical_id": "rel_event_group_b",
    "classification_level": "CONFIDENTIAL",
    "source_node_id": "event_warning_b_CONFIDENTIAL",
    "target_node_id": "target_group_sector_b_CONFIDENTIAL",
    "relation_type": "ASSOCIATED_WITH",
    "attributes": {},
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_detect_1_SECRET",
    "logical_id": "rel_detect_1",
    "classification_level": "SECRET",
    "source_node_id": "sensor_radar_a_CONFIDENTIAL",
    "target_node_id": "target_uav_1_SECRET",
    "relation_type": "DETECTED_BY",
    "attributes": {
      "confidence": 0.92
    },
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_detect_2_SECRET",
    "logical_id": "rel_detect_2",
    "classification_level": "SECRET",
    "source_node_id": "sensor_radar_a_CONFIDENTIAL",
    "target_node_id": "target_uav_2_SECRET",
    "relation_type": "DETECTED_BY",
    "attributes": {
      "confidence": 0.88
    },
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_event_target_SECRET",
    "logical_id": "rel_event_target",
    "classification_level": "SECRET",
    "source_node_id": "event_intercept_1_SECRET",
    "target_node_id": "target_uav_1_SECRET",
    "relation_type": "ASSOCIATED_WITH",
    "attributes": {},
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_detect_3_SECRET",
    "logical_id": "rel_detect_3",
    "classification_level": "SECRET",
    "source_node_id": "sensor_radar_b_SECRET",
    "target_node_id": "target_helicopter_5_SECRET",
    "relation_type": "DETECTED_BY",
    "attributes": {
      "confidence": 0.86
    },
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_detect_4_SECRET",
    "logical_id": "rel_detect_4",
    "classification_level": "SECRET",
    "source_node_id": "sensor_sigint_c_SECRET",
    "target_node_id": "target_uav_4_SECRET",
    "relation_type": "TRACKED_BY",
    "attributes": {
      "confidence": 0.81
    },
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_command_1_SECRET",
    "logical_id": "rel_command_1",
    "classification_level": "SECRET",
    "source_node_id": "command_center_alpha_SECRET",
    "target_node_id": "sensor_radar_a_CONFIDENTIAL",
    "relation_type": "COMMANDS",
    "attributes": {},
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_command_2_SECRET",
    "logical_id": "rel_command_2",
    "classification_level": "SECRET",
    "source_node_id": "command_center_alpha_SECRET",
    "target_node_id": "sensor_optic_a_CONFIDENTIAL",
    "relation_type": "COMMANDS",
    "attributes": {},
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_event_b1_SECRET",
    "logical_id": "rel_event_b1",
    "classification_level": "SECRET",
    "source_node_id": "event_alert_sector_b_SECRET",
    "target_node_id": "target_helicopter_5_SECRET",
    "relation_type": "ASSOCIATED_WITH",
    "attributes": {},
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_event_b2_SECRET",
    "logical_id": "rel_event_b2",
    "classification_level": "SECRET",
    "source_node_id": "event_alert_sector_b_SECRET",
    "target_node_id": "sensor_radar_b_SECRET",
    "relation_type": "TRIGGERED_BY",
    "attributes": {},
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_event_c1_SECRET",
    "logical_id": "rel_event_c1",
    "classification_level": "SECRET",
    "source_node_id": "event_sigint_ping_SECRET",
    "target_node_id": "sensor_sigint_c_SECRET",
    "relation_type": "REPORTED_BY",
    "attributes": {},
    "created_at": "2024-05-12T10:00:00Z"
  },
  {
    "id": "rel_event_c2_SECRET",
    "logical_id": "rel_event_c2",
    "classification_level": "SECRET",
    "source_node_id": "event_sigint_ping_SECRET",
    "target_node_id": "target_uav_4_SECRET",
    "relation_type": "ASSOCIATED_WITH",
    "attributes": {},
    "created_at": "2024-05-12T10:00:00Z"
  }
];
