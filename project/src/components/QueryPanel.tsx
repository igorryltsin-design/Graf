import { useRef, useState } from 'react';
import { Send, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { User, GraphNode, findUserById } from '../lib/supabase';
import { executeNaturalLanguageQuery, type QueryExplanation } from '../lib/queryEngine';

interface QueryPanelProps {
  user: User;
  onUserUpdate: (user: User) => void;
  onHighlight: (nodeIds: string[]) => void;
}

interface QueryHistory {
  query: string;
  result: any;
  timestamp: Date;
  success: boolean;
  explanation?: QueryExplanation;
}

export default function QueryPanel({ user, onUserUpdate, onHighlight }: QueryPanelProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<QueryHistory[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);

    try {
      const result = await executeNaturalLanguageQuery(user, query);

      setHistory(prev => [
        {
          query,
          result,
          timestamp: new Date(),
          success: result.success,
          explanation: result.explanation
        },
        ...prev
      ]);

      if (result.success && !result.aggregated && Array.isArray(result.data)) {
        const ids = (result.data as GraphNode[]).map(node => node.id);
        onHighlight(ids);
      } else {
        onHighlight([]);
      }

      const updatedUser = await findUserById(user.id);

      if (updatedUser) {
        onUserUpdate(updatedUser);
      }

      setQuery('');
      inputRef.current?.focus();
    } catch (error) {
      console.error('Query error:', error);
      onHighlight([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRepeat = (text: string) => {
    setQuery(text);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleExportHistory = () => {
    if (!history.length) {
      return;
    }
    const payload = history.map(item => ({
      query: item.query,
      success: item.success,
      timestamp: item.timestamp.toISOString(),
      explanation: item.explanation,
      resultSummary: item.success
        ? item.result.aggregated
          ? item.result.data
          : Array.isArray(item.result.data)
            ? { count: item.result.data.length }
            : item.result.data
        : item.result.error ?? item.result.denialReason ?? null
    }));

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `query_history_${new Date().toISOString().slice(0, 19)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

const exampleQueries = [
  'Сколько беспилотников в секторе A за последний 1 час',
  'Покажи последние события в секторе A',
  'Какие сенсоры недоступны в секторе A',
  'Сколько целей в секторе B'
];

const TYPE_LABELS: Record<string, string> = {
  UAV: 'БПЛА',
  Target: 'Цель',
  Sensor: 'Сенсор',
  Event: 'Событие',
  Sector: 'Сектор'
};

const LEVEL_LABELS: Record<string, string> = {
  SECRET: 'СЕКРЕТНО',
  CONFIDENTIAL: 'ДСП',
  UNCLASSIFIED: 'ОБЩЕДОСТУПНО'
};

const ATTRIBUTE_LABELS: Record<string, string> = {
  sector: 'Сектор',
  category: 'Категория',
  coordinates: 'Координаты',
  last_seen: 'Последнее наблюдение',
  threat_level: 'Уровень угрозы',
  composition: 'Состав',
  timestamp: 'Время события',
  description: 'Описание',
  severity: 'Критичность',
  status: 'Статус',
  source: 'Источник',
  target: 'Цель',
  speed: 'Скорость',
  heading: 'Курс',
  role: 'Роль',
  created_at: 'Создано',
  updated_at: 'Обновлено'
};

const translateType = (type: string) => TYPE_LABELS[type] || type;

const translateLevel = (level: string) => LEVEL_LABELS[level] || level;

const renderAttributeValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map(item => renderAttributeValue(item)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value ?? '—');
};

const RECOGNIZED_LABELS: Record<string, string> = {
  entity: 'Сущность',
  sector: 'Сектор',
  status: 'Статус',
  category: 'Категория',
  level: 'Уровень',
  time_window: 'Окно',
  time_range: 'Диапазон',
  geo: 'Гео',
  limit: 'Лимит',
  comparison: 'Сравнение'
};

  return (
    <div className="flex flex-col h-full bg-slate-800">
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Запросы на естественном языке</h2>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-slate-400">Бюджет: {user.query_budget}</span>
            <button
              type="button"
              onClick={handleExportHistory}
              disabled={!history.length}
              className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700/60 text-slate-200 transition-colors duration-150"
            >
              Экспорт
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Введите запрос на русском или английском..."
            className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
            ref={inputRef}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white rounded-lg transition-colors duration-200"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>

        <div className="mt-3">
          <p className="text-xs text-slate-400 mb-2">Примеры запросов:</p>
          <div className="space-y-1">
            {exampleQueries.map((example, i) => (
              <button
                key={i}
                onClick={() => setQuery(example)}
                className="block w-full text-left text-xs text-slate-400 hover:text-slate-300 hover:bg-slate-700/50 px-2 py-1 rounded transition-colors duration-150"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Нажмите на карточку результата, чтобы подсветить найденные объекты на графе.
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {history.length === 0 ? (
          <div className="text-center text-slate-400 mt-8">
            <p>Запросов пока нет. Попробуйте задать вопрос выше.</p>
          </div>
        ) : (
          history.map((item, i) => (
            <div
              key={i}
              className="bg-slate-700 border border-slate-600 rounded-lg p-4"
              onClick={() => {
                if (item.success && !item.result.aggregated && Array.isArray(item.result.data)) {
                  onHighlight((item.result.data as GraphNode[]).map((node: GraphNode) => node.id));
                } else {
                  onHighlight([]);
                }
              }}
            >
              <div className="flex items-start gap-2 mb-2">
                {item.success ? (
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-slate-200 font-medium break-words">{item.query}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {item.timestamp.toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRepeat(item.query);
                      }}
                      className="px-2 py-1 text-[11px] bg-slate-600 hover:bg-slate-500 text-slate-100 rounded transition-colors duration-150"
                    >
                      Повторить
                    </button>
                  </div>
                </div>
              </div>

              {item.explanation ? (
                <div className="mt-3 pl-7">
                  <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3 mb-3 text-xs text-slate-300 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">Интерпретация запроса</span>
                      <span className="text-slate-500 uppercase text-[10px] tracking-wide">
                        {item.explanation.intent === 'timeline'
                          ? 'ТАЙМЛАЙН'
                          : item.explanation.intent === 'count'
                            ? 'ПОДСЧЕТ'
                            : 'ПОИСК'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Логика фильтров: {item.explanation.logic === 'OR' ? 'ИЛИ (любой из условий)' : 'И (все условия)'}
                    </div>
                    {item.explanation.entity ? (
                      <div>
                        <span className="text-slate-400">Объект:</span>{' '}
                        <span className="text-slate-200">{item.explanation.entity}</span>
                      </div>
                    ) : null}
                    {item.explanation.timeWindow ? (
                      <div>
                        <span className="text-slate-400">Временной диапазон:</span>{' '}
                        <span className="text-slate-200">{item.explanation.timeWindow}</span>
                      </div>
                    ) : null}
                    {item.explanation.timeRange ? (
                      <div>
                        <span className="text-slate-400">Точное время:</span>{' '}
                        <span className="text-slate-200">{item.explanation.timeRange}</span>
                      </div>
                    ) : null}
                    {item.explanation.geo ? (
                      <div>
                        <span className="text-slate-400">Геофильтр:</span>{' '}
                        <span className="text-slate-200">{item.explanation.geo}</span>
                      </div>
                    ) : null}
                    {item.explanation.filters.length ? (
                      <div>
                        <span className="text-slate-400">Фильтры:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.explanation.filters.map(filter => (
                            <span
                              key={filter}
                              className="bg-slate-700 text-slate-200 px-2 py-0.5 rounded-md"
                            >
                              {filter}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {item.explanation.comparisons.length ? (
                      <div>
                        <span className="text-slate-400">Сравнения:</span>
                        <div className="mt-1 space-y-1">
                          {item.explanation.comparisons.map(comparison => (
                            <div key={comparison} className="bg-slate-700/50 px-2 py-1 rounded">
                              {comparison}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {item.explanation.recognized.length ? (
                      <div>
                        <span className="text-slate-400">Распознанные элементы:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.explanation.recognized.map((token, index) => (
                            <span
                              key={`${token.text}-${index}`}
                              className="bg-slate-700/80 text-slate-100 px-2 py-0.5 rounded-md border border-slate-600"
                            >
                              {token.text}
                              <span className="ml-1 text-[10px] uppercase text-slate-400">
                                {RECOGNIZED_LABELS[token.type] || token.type}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {item.explanation.warnings?.length ? (
                      <div className="bg-amber-900/40 border border-amber-700/40 text-amber-100 rounded px-2 py-2 space-y-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wide">Предупреждения</div>
                        <ul className="list-disc list-inside space-y-1">
                          {item.explanation.warnings.map(warning => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {item.explanation.limit ? (
                      <div>
                        <span className="text-slate-400">Лимит результатов:</span>{' '}
                        <span className="text-slate-200">{item.explanation.limit}</span>
                      </div>
                    ) : null}
                    {item.explanation.tips.length ? (
                      <div>
                        <span className="text-slate-400">Подсказки:</span>
                        <ul className="mt-1 list-disc list-inside space-y-1 text-slate-400">
                          {item.explanation.tips.map(tip => (
                            <li key={tip}>{tip}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="pl-7 mt-2">
                {item.success ? (
                  <div>
                    {item.result.aggregated ? (
                      <div className="bg-amber-900/30 border border-amber-700/50 rounded p-3 text-sm text-amber-200">
                        <p className="font-medium mb-1">Защита k-анонимностью</p>
                        <p>{item.result.data.message}</p>
                        <p className="mt-2">Количество: {item.result.data.count}</p>
                      </div>
                    ) : Array.isArray(item.result.data) ? (
                      <div>
                        <p className="text-slate-300 text-sm mb-2">
                          Найдено результатов: {item.result.data.length}
                        </p>
                        <div className="space-y-2">
                          {item.result.data.map((node: GraphNode, j: number) => (
                            <div
                              key={j}
                              className="bg-slate-800 rounded p-3 text-sm"
                            >
                              <p className="text-slate-200 font-medium">{node.name}</p>
                              <p className="text-slate-400 text-xs mt-1">
                                Тип: {translateType(node.entity_type)} | Уровень допуска: {translateLevel(node.classification_level)}
                              </p>
                              {node.attributes && (
                                <div className="mt-2 space-y-1 text-xs text-slate-300">
                                  {Object.entries(node.attributes).map(([key, value]) => (
                                    <div key={key} className="flex gap-1">
                                      <span className="text-slate-400">{ATTRIBUTE_LABELS[key] || key}:</span>
                                      <span className="text-slate-200">{renderAttributeValue(value)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <pre className="text-slate-300 text-sm whitespace-pre-wrap">
                        {JSON.stringify(item.result.data, null, 2)}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="bg-red-900/30 border border-red-700/50 rounded p-3 text-sm text-red-200">
                    <p className="font-medium mb-1">Доступ запрещен</p>
                    <p>{item.result.error || item.result.denialReason}</p>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
