import { useState, useEffect, useMemo, useRef, useCallback, ChangeEvent } from 'react';
import { LogOut, Shield, Database, Activity, Eye, Upload, Download } from 'lucide-react';
import { User, AuditLog, getAuditLogsForUser, exportLevelData, importLevelData } from '../lib/supabase';
import { AUDIT_DENIAL_CODES } from '../lib/queryEngine';
import GraphView from './GraphView';
import QueryPanel from './QueryPanel';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

type ClearanceLevel = 'UNCLASSIFIED' | 'CONFIDENTIAL' | 'SECRET';

const LEVEL_ORDER: ClearanceLevel[] = ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET'];

const LEVEL_LABELS: Record<string, string> = {
  UNCLASSIFIED: 'Уровень L',
  CONFIDENTIAL: 'Уровень M',
  SECRET: 'Уровень H'
};

const DENIAL_REASON_DETAILS: Record<
  string,
  { title: string; description: string; tone: 'danger' | 'warning' | 'info'; suggestion?: string }
> = {
  [AUDIT_DENIAL_CODES.BUDGET_EXHAUSTED]: {
    title: 'Бюджет исчерпан',
    description: 'Запрос заблокирован политикой расходования бюджета. Подождите восстановления или переключитесь на пользователя с более высоким лимитом.',
    tone: 'danger',
    suggestion: 'Сделайте паузу или выполните действия от имени роли с большим бюджетом (например, commander).'
  },
  [AUDIT_DENIAL_CODES.K_ANONYMITY]: {
    title: 'Сработала k-анонимность',
    description: 'Выборка оказалась меньше порога k, поэтому система вернула только агрегированную статистику.',
    tone: 'warning',
    suggestion: 'Расширьте фильтры (добавьте сектор или категорию), чтобы получить ≥ 2 объектов.'
  }
};

interface TrainingProgressState {
  budgetHit: boolean;
  kAnonHit: boolean;
  nextReset: Date | null;
  minutesLeft: number | null;
  budgetRemaining: number;
  totalLogs: number;
  deniedLogs: number;
  lastDeniedReason: string | null;
}

interface TrainingMission {
  id: string;
  label: string;
  hint: string;
  check: (progress: TrainingProgressState) => boolean;
}

const TRAINING_MISSIONS: TrainingMission[] = [
  {
    id: 'k-anon',
    label: 'Добиться отказа по k-анонимности',
    hint: 'Сузьте фильтры до < 2 результатов или уточните категорию.',
    check: progress => progress.kAnonHit
  },
  {
    id: 'budget',
    label: 'Исчерпать бюджет запросов',
    hint: 'Выполните серию запросов до блокировки и дождитесь восстановления бюджета.',
    check: progress => progress.budgetHit
  },
  {
    id: 'review',
    label: 'Разобрать три записи журнала',
    hint: 'Просмотрите минимум 3 записи и оцените причины отказа/допуска.',
    check: progress => progress.totalLogs >= 3
  }
];

export default function Dashboard({ user: initialUser, onLogout }: DashboardProps) {
  const [user, setUser] = useState(initialUser);
  const [viewMode, setViewMode] = useState<'virtual' | 'level' | 'overlay'>('virtual');
  const [showAudit, setShowAudit] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [overlayMenuOpen, setOverlayMenuOpen] = useState(false);
  const [highlightNodeIds, setHighlightNodeIds] = useState<string[]>([]);

  const levelButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlayButtonRef = useRef<HTMLButtonElement | null>(null);
  const levelMenuRef = useRef<HTMLDivElement | null>(null);
  const overlayMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [refreshToken, setRefreshToken] = useState(0);
  const [transferMessage, setTransferMessage] = useState('');
  const [trainingMode, setTrainingMode] = useState(false);

  useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);

  const accessibleLevels = useMemo(() => {
    const maxIndex = LEVEL_ORDER.indexOf(user.clearance_level as any);
    if (maxIndex === -1) {
      return LEVEL_ORDER.slice(0, 1);
    }
    return LEVEL_ORDER.slice(0, maxIndex + 1);
  }, [user.clearance_level]);

  const trainingProgress = useMemo<TrainingProgressState>(() => {
    const budgetHit = auditLogs.some(
      log => log.denial_reason === AUDIT_DENIAL_CODES.BUDGET_EXHAUSTED
    );
    const kAnonHit = auditLogs.some(
      log => log.denial_reason === AUDIT_DENIAL_CODES.K_ANONYMITY
    );
    const nextReset = user?.budget_reset_at ? new Date(user.budget_reset_at) : null;
    const minutesLeft = nextReset
      ? Math.max(0, Math.round((nextReset.getTime() - Date.now()) / 60000))
      : null;
    const totalLogs = auditLogs.length;
    const deniedLogs = auditLogs.filter(log => !log.access_granted).length;
    const lastDenied = auditLogs.find(log => !log.access_granted) || null;
    return {
      budgetHit,
      kAnonHit,
      nextReset,
      minutesLeft,
      budgetRemaining: user.query_budget,
      totalLogs,
      deniedLogs,
      lastDeniedReason: lastDenied?.denial_reason ?? null
    };
  }, [auditLogs, user]);

  const budgetResetLabel = trainingProgress.nextReset
    ? trainingProgress.nextReset.toLocaleTimeString('ru-RU')
    : '—';

  const completedMissions = useMemo(
    () => TRAINING_MISSIONS.filter(mission => mission.check(trainingProgress)),
    [trainingProgress]
  );

  const missionsProgressPercent = Math.round(
    (completedMissions.length / TRAINING_MISSIONS.length) * 100
  );

  const lastDeniedLog = useMemo(() => auditLogs.find(log => !log.access_granted) || null, [auditLogs]);
  const lastDeniedMeta = lastDeniedLog?.denial_reason ? DENIAL_REASON_DETAILS[lastDeniedLog.denial_reason] : undefined;

  const [selectedLevel, setSelectedLevel] = useState<ClearanceLevel>(
    accessibleLevels[accessibleLevels.length - 1] || 'CONFIDENTIAL'
  );
  const [overlayLevels, setOverlayLevels] = useState<ClearanceLevel[]>(accessibleLevels);
  const [transferLevel, setTransferLevel] = useState<ClearanceLevel>(
    accessibleLevels[accessibleLevels.length - 1] || 'CONFIDENTIAL'
  );

  useEffect(() => {
    if (showAudit) {
      loadAuditLogs();
    }
  }, [showAudit]);

  useEffect(() => {
    if (!accessibleLevels.includes(selectedLevel)) {
      setSelectedLevel(accessibleLevels[accessibleLevels.length - 1] || selectedLevel);
    }

    setOverlayLevels(prev => {
      const filtered = prev.filter(level => accessibleLevels.includes(level));
      if (filtered.length === 0) {
        return accessibleLevels.length ? accessibleLevels : prev;
      }
      return Array.from(new Set(filtered)).sort(
        (a, b) => LEVEL_ORDER.indexOf(a as any) - LEVEL_ORDER.indexOf(b as any)
      );
    });
    if (!accessibleLevels.includes(transferLevel)) {
      setTransferLevel(accessibleLevels[accessibleLevels.length - 1] || transferLevel);
    }
  }, [accessibleLevels, selectedLevel, transferLevel]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (levelMenuOpen) {
        if (
          levelMenuRef.current &&
          !levelMenuRef.current.contains(target) &&
          levelButtonRef.current &&
          !levelButtonRef.current.contains(target)
        ) {
          setLevelMenuOpen(false);
        }
      }
      if (overlayMenuOpen) {
        if (
          overlayMenuRef.current &&
          !overlayMenuRef.current.contains(target) &&
          overlayButtonRef.current &&
          !overlayButtonRef.current.contains(target)
        ) {
          setOverlayMenuOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [levelMenuOpen, overlayMenuOpen]);

  const loadAuditLogs = async () => {
    const data = await getAuditLogsForUser(user.id, 20);
    setAuditLogs(data);
  };

  const handleUserUpdate = (updatedUser: User) => {
    setUser(updatedUser);
  };

  const handleLogout = () => {
    setHighlightNodeIds([]);
    onLogout();
  };

  const getLevelBadgeColor = (level: string) => {
    switch (level) {
      case 'SECRET':
        return 'bg-red-600';
      case 'CONFIDENTIAL':
        return 'bg-amber-600';
      default:
        return 'bg-slate-600';
    }
  };

  const handleExport = useCallback(async () => {
    try {
      const dataset = await exportLevelData(transferLevel);
      const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${transferLevel.toLowerCase()}_dataset.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setTransferMessage(`Выгружено: ${LEVEL_LABELS[transferLevel] || transferLevel}`);
    } catch (error: any) {
      setTransferMessage(error?.message || 'Не удалось выгрузить данные.');
    }
  }, [transferLevel]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        await importLevelData(transferLevel, payload);
        setTransferMessage(`Импортировано: ${LEVEL_LABELS[transferLevel] || transferLevel}`);
        setRefreshToken(token => token + 1);
      } catch (error: any) {
        console.error(error);
        setTransferMessage(error?.message || 'Не удалось загрузить файл.');
      }
    },
    [transferLevel]
  );

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-blue-500" />
              <h1 className="text-xl font-bold text-slate-100">Система MLS/ABAC</h1>
            </div>

            <div className="flex items-center gap-2 ml-8">
              <button
                onClick={() => {
                  setViewMode('virtual');
                  setLevelMenuOpen(false);
                  setOverlayMenuOpen(false);
                }}
                className={`px-3 py-1.5 rounded text-sm transition-colors duration-200 ${
                  viewMode === 'virtual'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
                title="Сформировать единую картину из доступных уровней"
              >
                <Eye className="w-4 h-4 inline mr-1" />
                Виртуальный
              </button>

              <div className="relative">
                <button
                  ref={levelButtonRef}
                  onClick={() => {
                    setViewMode('level');
                    setLevelMenuOpen(prev => !prev);
                    setOverlayMenuOpen(false);
                  }}
                  className={`px-3 py-1.5 rounded text-sm transition-colors duration-200 flex items-center gap-1 ${
                    viewMode === 'level'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                  title="Выбрать конкретный уровень секретности"
                >
                  <Database className="w-4 h-4" />
                  <span>
                    Уровень{selectedLevel ? ` • ${LEVEL_LABELS[selectedLevel] || selectedLevel}` : ''}
                  </span>
                </button>
                {levelMenuOpen && (
                  <div
                    ref={levelMenuRef}
                    className="absolute z-20 mt-2 w-52 rounded-lg border border-slate-700 bg-slate-800 shadow-lg py-2"
                  >
                    {accessibleLevels.map(level => (
                      <button
                        key={level}
                        onClick={() => {
                          setSelectedLevel(level);
                          setViewMode('level');
                          setLevelMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors duration-150 ${
                          selectedLevel === level
                            ? 'bg-blue-600/60 text-white'
                            : 'text-slate-200 hover:bg-slate-700'
                        }`}
                      >
                        {LEVEL_LABELS[level] || level}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  ref={overlayButtonRef}
                  onClick={() => {
                    if (accessibleLevels.length <= 1) {
                      return;
                    }
                    setViewMode('overlay');
                    setOverlayMenuOpen(prev => !prev);
                    setLevelMenuOpen(false);
                  }}
                  disabled={accessibleLevels.length <= 1}
                  className={`px-3 py-1.5 rounded text-sm transition-colors duration-200 flex items-center gap-1 ${
                    accessibleLevels.length <= 1
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      : viewMode === 'overlay'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                  title={
                    accessibleLevels.length <= 1
                      ? 'Доступен только один уровень'
                      : 'Сравнить несколько уровней одновременно'
                  }
                >
                  <Activity className="w-4 h-4" />
                  <span>
                    Совмещённый{overlayLevels.length ? ` • ${overlayLevels.length}` : ''}
                  </span>
                </button>
                {overlayMenuOpen && accessibleLevels.length > 1 && (
                  <div
                    ref={overlayMenuRef}
                    className="absolute z-20 mt-2 w-56 rounded-lg border border-slate-700 bg-slate-800 shadow-lg py-2"
                  >
                    {accessibleLevels.map(level => {
                      const selected = overlayLevels.includes(level);
                      return (
                        <button
                          key={level}
                          onClick={() => {
                            setOverlayLevels(prev => {
                              const has = prev.includes(level);
                              if (has) {
                                if (prev.length <= 1) {
                                  return prev;
                                }
                                return prev.filter(item => item !== level);
                              }
                              return [...prev, level].sort(
                                (a, b) => LEVEL_ORDER.indexOf(a as any) - LEVEL_ORDER.indexOf(b as any)
                              );
                            });
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors duration-150"
                        >
                          <span
                            className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                              selected ? 'border-blue-400 bg-blue-500/70 text-white' : 'border-slate-500'
                            }`}
                          >
                            {selected ? '✓' : ''}
                          </span>
                          <span>{LEVEL_LABELS[level] || level}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 ml-6">
              <label className="text-xs text-slate-400" htmlFor="transfer-level-select">
                Данные уровня:
              </label>
              <select
                id="transfer-level-select"
                className="bg-slate-700 text-slate-200 text-sm rounded px-2 py-1 border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={transferLevel}
                onChange={event => setTransferLevel(event.target.value as ClearanceLevel)}
              >
                {accessibleLevels.map(level => (
                  <option key={`transfer-${level}`} value={level}>
                    {LEVEL_LABELS[level] || level}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleImportClick}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-sm transition-colors duration-150"
                title="Загрузить JSON-файл для выбранного уровня"
              >
                <Upload className="w-4 h-4" />
                Загрузить
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-sm transition-colors duration-150"
                title="Сохранить данные выбранного уровня"
              >
                <Download className="w-4 h-4" />
                Выгрузить
              </button>
            </div>
            {transferMessage ? (
              <div className="ml-6 text-xs text-slate-400">{transferMessage}</div>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="flex items-center gap-2">
                <span className="text-slate-300 font-medium">{user.username}</span>
                <span
                  className={`${getLevelBadgeColor(
                    user.clearance_level
                  )} text-white text-xs px-2 py-1 rounded font-medium`}
                >
                  {user.clearance_level}
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {user.attributes?.sector && `Сектор: ${user.attributes.sector} | `}
                {user.attributes?.role && `Роль: ${user.attributes.role}`}
              </div>
            </div>

            <button
              onClick={() => setShowAudit(!showAudit)}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors duration-200"
              title="Журнал доступа"
            >
              <Activity className="w-5 h-5" />
            </button>

            <button
              onClick={handleLogout}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors duration-200"
              title="Выход"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <GraphView
            user={user}
            viewMode={viewMode}
            selectedLevel={selectedLevel}
            overlayLevels={overlayLevels}
            refreshToken={refreshToken}
            highlightNodeIds={highlightNodeIds}
          />
        </div>

        <div className="w-96 border-l border-slate-700 flex flex-col">
          {showAudit ? (
            <div className="flex-1 overflow-y-auto bg-slate-800 p-4">
              <div className="flex items-start justify-between mb-4 gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">Журнал доступа</h3>
                  <div className="text-xs text-slate-400 mt-1">
                    Бюджет: {trainingProgress.budgetRemaining} · Сброс: {budgetResetLabel}
                    {trainingProgress.minutesLeft != null ? ` (~${trainingProgress.minutesLeft} мин)` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={trainingMode}
                      onChange={event => setTrainingMode(event.target.checked)}
                      className="h-3 w-3 accent-blue-500"
                    />
                    Учебный режим
                  </label>
                  <button
                    onClick={() => setShowAudit(false)}
                    className="text-slate-400 hover:text-slate-300 text-sm"
                  >
                    Закрыть
                  </button>
                </div>
              </div>

              {trainingMode ? (
                <div className="mb-4 bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-100">Учебные задания</span>
                    <span className="text-[11px] text-slate-400">
                      Остаток: {trainingProgress.budgetRemaining} | Сброс: {budgetResetLabel}
                    </span>
                  </div>
                  <div className="mt-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span>Прогресс обучения</span>
                      <span>{completedMissions.length}/{TRAINING_MISSIONS.length}</span>
                    </div>
                    <div
                      className="h-2 w-full bg-slate-800 rounded"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={missionsProgressPercent}
                      aria-valuetext={`${missionsProgressPercent}% завершено`}
                    >
                      <div
                        className="h-full bg-blue-500 rounded"
                        style={{ width: `${missionsProgressPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    {TRAINING_MISSIONS.map(mission => {
                      const completed = mission.check(trainingProgress);
                      return (
                        <div key={mission.id} className="flex items-start gap-2">
                          <span
                            className={`mt-1 h-2.5 w-2.5 rounded-full ${
                              completed ? 'bg-green-400' : 'bg-slate-600'
                            }`}
                          />
                          <div>
                            <div className="text-slate-200">{mission.label}</div>
                            <div className="text-slate-400 text-[11px]">{mission.hint}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {lastDeniedLog ? (
                    <div className="bg-slate-900/70 border border-slate-800 rounded px-2 py-2 text-[11px] text-slate-200">
                      <div className="font-semibold text-[12px] mb-1">Последний отказ</div>
                      <div className="text-slate-400 mb-1">{lastDeniedLog.query_text}</div>
                      {lastDeniedMeta ? (
                        <div className={`rounded px-2 py-1 ${
                          lastDeniedMeta.tone === 'danger' ? 'bg-red-900/40 text-red-200' : 'bg-amber-900/40 text-amber-200'
                        }`}>
                          <div className="font-semibold text-[11px]">{lastDeniedMeta.title}</div>
                          <div>{lastDeniedMeta.description}</div>
                          {lastDeniedMeta.suggestion ? (
                            <div className="mt-1 text-[11px] text-slate-100">{lastDeniedMeta.suggestion}</div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="pt-2 border-t border-slate-800">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                      Рекомендации
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-slate-400">
                      <li>Сравните уровни доступа в режиме «Совмещённый», чтобы увидеть ограничения MLS.</li>
                      <li>Сформулируйте запрос по чужому сектору и наблюдайте правила ABAC.</li>
                    </ul>
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                {auditLogs.length === 0 ? (
                  <p className="text-slate-400 text-sm">Записей ещё нет.</p>
                ) : (
                  auditLogs.map(log => {
                    const meta = log.denial_reason ? DENIAL_REASON_DETAILS[log.denial_reason] : undefined;
                    const highlight = Boolean(meta) && trainingMode;
                    const cardClasses = [
                      'bg-slate-700',
                      'rounded-lg',
                      'p-3',
                      highlight
                        ? meta?.tone === 'danger'
                          ? 'border border-red-500/60 shadow-lg shadow-red-900/40'
                          : 'border border-amber-500/60 shadow-lg shadow-amber-900/30'
                        : 'border border-slate-600'
                    ].join(' ');
                    return (
                      <div key={log.id} className={cardClasses}>
                        <div className="flex items-start justify-between mb-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              log.access_granted
                                ? 'bg-green-900/50 text-green-300'
                                : 'bg-red-900/50 text-red-300'
                            }`}
                          >
                            {log.access_granted ? 'РАЗРЕШЕНО' : 'ОТКАЗАНО'}
                          </span>
                          <span className="text-xs text-slate-400">
                            {new Date(log.created_at).toLocaleTimeString()}
                          </span>
                        </div>

                        <p className="text-sm text-slate-300 mb-1">{log.query_text}</p>

                        <div className="text-xs text-slate-400">
                          Тип: {log.query_type} | Результатов: {log.result_count}
                        </div>

                        {meta ? (
                          <div
                            className={`mt-2 text-xs rounded px-3 py-2 ${
                              meta.tone === 'danger'
                                ? 'bg-red-900/40 text-red-200'
                                : 'bg-amber-900/40 text-amber-200'
                            }`}
                          >
                            <div className="font-semibold text-[12px]">{meta.title}</div>
                            <div className="mt-1 text-[11px]">{meta.description}</div>
                            {meta.suggestion ? (
                              <div className="mt-2 text-[11px] text-slate-100">{meta.suggestion}</div>
                            ) : null}
                            {trainingMode ? (
                              <div className="mt-1 text-[10px] text-slate-500">Код: {log.denial_reason}</div>
                            ) : null}
                          </div>
                        ) : log.denial_reason ? (
                          <div className="mt-2 text-xs text-slate-200 bg-slate-700/60 rounded px-2 py-1">
                            {log.denial_reason}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <QueryPanel user={user} onUserUpdate={handleUserUpdate} onHighlight={setHighlightNodeIds} />
          )}
        </div>
      </div>
    </div>
  );
}
