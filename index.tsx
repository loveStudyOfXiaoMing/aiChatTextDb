import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useCallback } from 'react';
import 'antd/dist/reset.css';
import { Modal, Input, Button, Checkbox, Divider, message, ConfigProvider, theme, Table as AntTable, Select, Alert } from 'antd';
import Editor from '@monaco-editor/react';
import { GoogleGenAI } from '@google/genai';
import {
    Database,
    Table,
    Play,
    Sparkles,
    Settings,
    Server,
    Plus,
    X,
    ChevronRight,
    ChevronDown,
    LayoutGrid,
    MessageSquare,
    Save,
    Eraser,
    Wand2,
    PanelLeft,
    ChevronLeft,
    RefreshCw,
    Trash2
} from 'lucide-react';

type DbType = 'mysql' | 'postgres' | 'oracle' | 'sqlserver' | 'redis';
type Activity = 'database' | 'history' | 'settings';
type AiProvider = 'google' | 'openai' | 'deepseek' | 'ollama';

interface DatabaseNode {
    id: string;
    name: string;
    expanded: boolean;
    tablesExpanded: boolean;
    viewsExpanded: boolean;
    tables: string[];
    views: string[];
    loaded?: boolean;
}

interface ConnectionNode {
    id: string;
    name: string;
    type: DbType;
    host: string;
    config?: DbConnectionConfig;
    runtimeId?: string | null;
    status?: 'idle' | 'connecting' | 'connected' | 'error';
    lastError?: string;
    expanded: boolean;
    databases: DatabaseNode[];
}

interface TabData {
    id: string;
    title: string;
    type: 'query';
    initialQuery?: string;
    connId?: string | null;
    dbName?: string | null;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    timestamp: number;
}

interface ColumnDefinition {
    name: string;
    type: string;
    length?: number;
    decimal?: number;
    notNull: boolean;
    virtual: boolean;
    isKey: boolean;
    comment: string;
}

type AiConfig = {
    provider: AiProvider;
    model: string;
    temperature: number;
    baseUrl: string;
    apiKey: string;
};

const STORAGE_KEY = 'connections_v1';
const AI_STORAGE_KEY = 'ai_config_v1';
const THEME_STORAGE_KEY = 'theme_preference';
const PROFILE_STORAGE_KEY = 'profile_info_v1';
const ACCENT_STORAGE_KEY = 'accent_color_v1';

declare global {
    interface Window {
        desktopAPI?: {
            connect(config: DbConnectionConfig): Promise<{ id: string; name: string; type: DbType; host: string; database: string }>;
            listSchema(payload: { connId: string; database?: string }): Promise<{ databases: DatabaseNode[] }>;
            runQuery(payload: { connId: string; sql: string; database?: string }): Promise<{ headers: string[]; rows: any[]; error?: string }>;
            close?(payload: { connId: string }): Promise<void>;
        };
        echarts?: any;
    }
}

const DEFAULT_PORT: Record<DbType, number> = {
    mysql: 3306,
    postgres: 5432,
    oracle: 1521,
    sqlserver: 1433,
    redis: 6379
};

const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
    google: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
    deepseek: 'deepseek-chat',
    ollama: 'llama3'
};

const INITIAL_SCHEMA: Record<string, ColumnDefinition[]> = {};

const defaultColumn = (): ColumnDefinition => ({
    name: 'new_col',
    type: 'VARCHAR',
    length: 255,
    decimal: undefined,
    notNull: false,
    virtual: false,
    isKey: false,
    comment: ''
});

const extractJsonFromCode = (raw: string): string => {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) return fence[1].trim();
    return raw.trim();
};

const parseAiColumns = (raw: string): ColumnDefinition[] => {
    const cleaned = extractJsonFromCode(raw);
    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
            return parsed.map((c: any) => {
                const lenNum = Number(c.length);
                const decNum = Number(c.decimal);
                return {
                    name: c.name || 'col',
                    type: (c.type || 'VARCHAR').toUpperCase(),
                    length: Number.isFinite(lenNum) && lenNum > 0 ? lenNum : undefined,
                    decimal: Number.isFinite(decNum) && decNum > 0 ? decNum : undefined,
                    notNull: !!c.notNull,
                    virtual: false,
                    isKey: !!c.isKey,
                    comment: c.comment || ''
                };
            });
        }
    } catch (err) {
        console.warn('parse ai columns failed', err);
    }
    return [];
};

const parseAiTableDesign = (raw: string): { tableName?: string; columns: ColumnDefinition[] } => {
    const cleaned = extractJsonFromCode(raw);
    try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
            return { columns: parseAiColumns(cleaned) };
        }
        if (parsed && typeof parsed === 'object') {
            const maybeCols = (parsed as any).columns;
            const maybeName = typeof (parsed as any).tableName === 'string' ? (parsed as any).tableName : undefined;
            if (Array.isArray(maybeCols)) {
                return { tableName: maybeName, columns: parseAiColumns(JSON.stringify(maybeCols)) };
            }
        }
    } catch (err) {
        console.warn('parse ai table design failed', err);
    }
    return { columns: [] };
};

const extractChartOption = (text: string) => {
    if (!text) return null;
    const body = extractJsonFromCode(text);
    try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && (parsed.series || parsed.tooltip || parsed.xAxis || parsed.yAxis)) {
            return parsed;
        }
    } catch (e) {
        return null;
    }
    return null;
};

const buildChartOptionFromResult = (headers: string[], rows: any[], intent: 'auto' | 'line' | 'bar' | 'pie') => {
    if (!rows || !rows.length) return null;
    const effectiveHeaders = headers && headers.length ? headers : Object.keys(rows[0] || {});
    if (!effectiveHeaders.length) return null;
    const categories = rows.map((r) => r[effectiveHeaders[0]]);
    const numericCols = effectiveHeaders.slice(1).filter((h) =>
        rows.some((r) => {
            const v = r[h];
            return typeof v === 'number' || (!isNaN(Number(v)) && v !== null && v !== '');
        })
    );
    const pickIntent = intent === 'auto'
        ? (numericCols.length <= 1 && effectiveHeaders.length <= 2 ? 'pie' : 'line')
        : intent;
    if (pickIntent === 'pie') {
        const valueCol = numericCols[0] || effectiveHeaders[1] || effectiveHeaders[0];
        const data = rows.map((r) => ({ name: r[effectiveHeaders[0]], value: Number(r[valueCol]) || 0 }));
        return {
            tooltip: { trigger: 'item' },
            legend: { top: '5%' },
            series: [
                {
                    type: 'pie',
                    radius: '60%',
                    data,
                    label: { formatter: '{b}: {c} ({d}%)' }
                }
            ]
        };
    }
    const series = (numericCols.length ? numericCols : effectiveHeaders.slice(1)).map((h) => ({
        name: h,
        type: pickIntent === 'bar' ? 'bar' : 'line',
        data: rows.map((r) => Number(r[h]) || 0)
    }));
    if (!series.length) return null;
    return {
        tooltip: { trigger: 'axis' },
        legend: { top: 0 },
        xAxis: { type: 'category', data: categories },
        yAxis: { type: 'value' },
        series
    };
};

const Resizer = ({ onResize, direction = 'horizontal' }: { onResize: (delta: number) => void; direction?: 'horizontal' | 'vertical' }) => {
    const isDragging = useRef(false);
    const startPos = useRef(0);
    const prefersDark = typeof document !== 'undefined' && document.body?.getAttribute('data-theme') === 'dark';

    useEffect(() => {
        const handleMove = (e: MouseEvent) => {
            if (!isDragging.current) return;
            const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
            const delta = currentPos - startPos.current;
            onResize(delta);
            startPos.current = currentPos;
        };
        const handleUp = () => {
            isDragging.current = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [onResize, direction]);

    const cursorClass = direction === 'horizontal' ? 'cursor-col-resize w-1 hover:w-1.5 h-full top-0' : 'cursor-row-resize h-1 hover:h-1.5 w-full left-0';
    const themeBg = prefersDark ? 'bg-[#1f1f1f]' : 'bg-slate-200';
    const hoverBg = 'hover:bg-blue-500/70';

    return (
        <div
            className={`${cursorClass} ${themeBg} ${hoverBg} transition-all z-50 flex-shrink-0 relative group`}
            onMouseDown={(e) => {
                isDragging.current = true;
                startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
                document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
                document.body.style.userSelect = 'none';
            }}
        >
            <div className={`absolute bg-transparent ${direction === 'horizontal' ? 'inset-y-0 -left-1 -right-1' : 'inset-x-0 -top-1 -bottom-1'}`} />
        </div>
    );
};

const ChatChart = ({ option, isDark, ensureEcharts }: { option: any; isDark: boolean; ensureEcharts: () => Promise<any> }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let chart: any;
        let disposed = false;
        const renderChart = async () => {
            try {
                const echarts = await ensureEcharts();
                if (!ref.current || disposed) return;
                chart = echarts.init(ref.current, isDark ? 'dark' : undefined);
                chart.setOption(option, true);
            } catch (e) {
                console.warn('render chart failed', e);
            }
        };
        renderChart();
        return () => {
            disposed = true;
            if (chart) chart.dispose();
        };
    }, [option, isDark, ensureEcharts]);

    return <div ref={ref} style={{ width: '100%', height: 260 }} className={`${isDark ? 'bg-[#0f172a]' : 'bg-white'} rounded-md border ${isDark ? 'border-[#1e293b]' : 'border-slate-200'}`} />;
};

interface TableEditorModalProps {
    open: boolean;
    mode: 'create' | 'design';
    title: string;
    tableName: string;
    columns: ColumnDefinition[];
    aiPrompt: string;
    aiLoading: boolean;
    onChangeName: (name: string) => void;
    onChangeColumns: (cols: ColumnDefinition[]) => void;
    onChangeAiPrompt: (text: string) => void;
    onAiGenerate: () => void;
    onSave: () => void;
    onCancel: () => void;
    extraContent?: React.ReactNode;
}

const TableEditorModal: React.FC<TableEditorModalProps> = ({
                                                               open,
                                                               mode,
                                                               title,
                                                               tableName,
                                                               columns,
                                                               aiPrompt,
                                                               aiLoading,
                                                               onChangeName,
                                                               onChangeColumns,
                                                               onChangeAiPrompt,
                                                               onAiGenerate,
                                                               onSave,
                                                               onCancel,
                                                               extraContent
                                                           }) => {
    const typeOptions = ['BIGINT', 'INTEGER', 'VARCHAR', 'TEXT', 'DATE', 'DATETIME', 'DECIMAL', 'BOOLEAN'];

    const updateColumn = (idx: number, patch: Partial<ColumnDefinition>) => {
        const copy = [...columns];
        copy[idx] = { ...copy[idx], ...patch };
        onChangeColumns(copy);
    };

    const removeColumn = (idx: number) => {
        onChangeColumns(columns.filter((_, i) => i !== idx));
    };

    return (
        <Modal
            open={open}
            title={title}
            width={900}
            onOk={onSave}
            onCancel={onCancel}
            okText={mode === 'create' ? '创建' : '保存'}
            cancelText="取消"
            destroyOnClose
            maskClosable={false}
            zIndex={1400}
        >
            <div className="space-y-4">
                {extraContent}
                <div className="flex gap-3 items-start">
                    <span className="text-sm w-20 leading-6">AI 生成</span>
                    <div className="flex-1 flex gap-2">
                        <Input.TextArea
                            value={aiPrompt}
                            onChange={(e) => onChangeAiPrompt(e.target.value)}
                            placeholder="描述业务/表用途，AI 将按此生成表名与字段"
                            autoSize={{ minRows: 2, maxRows: 4 }}
                        />
                        <Button icon={<Sparkles size={14} />} loading={aiLoading} onClick={onAiGenerate} disabled={!aiPrompt.trim()}>
                            生成
                        </Button>
                    </div>
                </div>
                <div className="flex gap-3 items-center">
                    <span className="text-sm w-20">表名</span>
                    <Input value={tableName} onChange={(e) => onChangeName(e.target.value)} placeholder="table_name" />
                </div>
                <Divider />
                <div className="flex items-center justify-between px-1 mb-2">
                    <div className="text-xs uppercase text-gray-500">字段</div>
                    <Button size="small" type="dashed" onClick={() => onChangeColumns([...columns, defaultColumn()])}>
                        新增字段
                    </Button>
                </div>
                <div className="max-h-80 overflow-auto rounded-lg p-2" style={{ borderColor: '#e5e7eb' }}>
                    <div className="grid grid-cols-12 gap-2 font-mono text-xs text-gray-500 mb-1 px-1">
                        <div className="col-span-2">字段名</div>
                        <div className="col-span-2">类型</div>
                        <div className="col-span-2">长度</div>
                        <div className="col-span-1">精度</div>
                        <div className="col-span-1 text-center">非空</div>
                        <div className="col-span-1 text-center">虚拟</div>
                        <div className="col-span-1 text-center">主键</div>
                        <div className="col-span-1 text-center">注释</div>
                        <div className="col-span-1" />
                    </div>
                    <Divider className="my-2" />
                    {columns.map((col, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center mb-2">
                            <Input size="small" value={col.name} onChange={(e) => updateColumn(idx, { name: e.target.value })} className="col-span-2" />
                            <Select
                                value={col.type}
                                onChange={(val) => updateColumn(idx, { type: val })}
                                options={typeOptions.map((t) => ({ label: t, value: t }))}
                                size="small"
                                className="col-span-2"
                                style={{ width: '100%' }}
                                popupMatchSelectWidth={false}
                            />
                            <Input
                                type="number"
                                value={col.length ?? ''}
                                onChange={(e) => updateColumn(idx, { length: e.target.value ? Number(e.target.value) : undefined })}
                                className="col-span-2"
                                size="small"
                            />
                            <Input
                                type="number"
                                value={col.decimal ?? ''}
                                onChange={(e) => updateColumn(idx, { decimal: e.target.value ? Number(e.target.value) : undefined })}
                                className="col-span-1"
                                size="small"
                            />
                            <div className="col-span-1 text-center">
                                <Checkbox checked={col.notNull} onChange={(e) => updateColumn(idx, { notNull: e.target.checked })} />
                            </div>
                            <div className="col-span-1 text-center">
                                <Checkbox checked={col.virtual} onChange={(e) => updateColumn(idx, { virtual: e.target.checked })} />
                            </div>
                            <div className="col-span-1 text-center">
                                <Checkbox checked={col.isKey} onChange={(e) => updateColumn(idx, { isKey: e.target.checked })} />
                            </div>
                            <Input value={col.comment} onChange={(e) => updateColumn(idx, { comment: e.target.value })} className="col-span-1" size="small" />
                            <Button danger type="link" onClick={() => removeColumn(idx)}>
                                删除
                            </Button>
                        </div>
                    ))}
                    {columns.length === 0 && <div className="text-center text-sm opacity-60 py-4">请添加至少一个字段</div>}
                </div>
            </div>
        </Modal>
    );
};

interface ConsoleTabProps {
    tabId: string;
    isActive: boolean;
    initialQuery: string;
    ai: GoogleGenAI | null;
    aiConfig: AiConfig;
    activeConnId: string | null;
    activeDbName: string | null;
    activeTableName: string | null;
    connections: ConnectionNode[];
    schemaColumns: Record<string, ColumnDefinition[]>;
    isDark: boolean;
    onOpenRightPanel: () => void;
    onRunQuery: (sql: string) => Promise<{ headers: string[]; rows: any[]; error?: string }>;
    onChangeConn: (connId: string) => void;
    onChangeDb: (dbName: string | null) => void;
    onChangeTable: (table: string | null) => void;
    onRegisterQuerySetter: (tabId: string, setter: (sql: string, mode?: 'replace' | 'append') => void) => void;
    onUnregisterQuerySetter: (tabId: string) => void;
}

const ConsoleTab: React.FC<ConsoleTabProps> = ({ tabId, isActive, initialQuery, ai, aiConfig, activeConnId, activeDbName, activeTableName, connections, schemaColumns, isDark, onOpenRightPanel, onRunQuery, onChangeConn, onChangeDb, onChangeTable, onRegisterQuerySetter, onUnregisterQuerySetter }) => {
    const [query, setQuery] = useState(initialQuery || '');
    const [results, setResults] = useState<{ headers: string[]; rows: any[]; error: string | null } | null>(null);
    const [activeTabResult, setActiveTabResult] = useState<'results' | 'messages'>('results');
     const [editorHeight] = useState(360);
    const [inlineAiPrompt, setInlineAiPrompt] = useState('');
    const [isInlineAiThinking, setIsInlineAiThinking] = useState(false);
    const [showInlineAi, setShowInlineAi] = useState(false);
    const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
    const [resultsHeight, setResultsHeight] = useState(450);
    const [isOptimizingSelection, setIsOptimizingSelection] = useState(false);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [simModal, setSimModal] = useState(false);
    const [simCount, setSimCount] = useState(10);
    const [simHint, setSimHint] = useState('');
    const [simTable, setSimTable] = useState<string | null>(null);
    const [isSimGenerating, setIsSimGenerating] = useState(false);
    const [lastRuntime, setLastRuntime] = useState<number | null>(null);
    const [lastRowCount, setLastRowCount] = useState<number | null>(null);
    const [messageApi, contextHolder] = message.useMessage();
    const monacoRef = useRef<any>(null);
    const editorRef = useRef<any>(null);
    const completionDisposable = useRef<any>(null);

    useEffect(() => {
        const setter = (sql: string, mode: 'replace' | 'append' = 'append') => {
            if (mode === 'replace') setQuery(sql);
            else setQuery((prev) => (prev ? `${prev}\n\n${sql}` : sql));
            setShowInlineAi(false);
            setActiveTabResult('results');
            const editor = editorRef.current;
            if (editor) {
                editor.focus();
                editor.revealLine(editor.getModel()?.getLineCount?.() || 1);
            }
        };
        onRegisterQuerySetter(tabId, setter);
        return () => onUnregisterQuerySetter(tabId);
    }, [tabId, onRegisterQuerySetter, onUnregisterQuerySetter]);
    const currentConn = connections.find((c) => c.id === activeConnId);
    const currentDb = currentConn?.databases.find((d) => d.name === activeDbName);
    const formatValue = (val: any) => {
        if (val === null || val === undefined) return 'NULL';
        if (val instanceof Date) return val.toISOString();
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
    };

    const runQuery = async (sqlText?: string) => {
        const sqlSource = typeof sqlText === 'string' ? sqlText : query || '';
        const sql = sqlSource.trim();
        if (!sql) {
            messageApi.error('请输入 SQL');
            return;
        }
        const start = performance.now();
        try {
            const res = await onRunQuery(sql);
            const duration = performance.now() - start;
            setLastRuntime(duration);
            setLastRowCount(res?.rows?.length ?? null);
            if (res.error) {
                setResults({ headers: res.headers || [], rows: res.rows || [], error: res.error });
                setActiveTabResult('messages');
            } else {
                setResults({ headers: res.headers || [], rows: res.rows || [], error: null });
                setActiveTabResult('results');
                messageApi.success(`执行成功，耗时 ${duration.toFixed(0)} ms`);
            }
        } catch (e: any) {
            const duration = performance.now() - start;
            setLastRuntime(duration);
            setLastRowCount(null);
            setResults({ headers: [], rows: [], error: e?.message || String(e) });
            setActiveTabResult('messages');
        }
    };

    useEffect(() => {
        if (initialQuery && !results) {
            runQuery(initialQuery);
        }
    }, []);

    useEffect(() => {
        const tables = currentDb?.tables || [];
        setSelectedTable((prev) => {
            if (activeTableName && tables.includes(activeTableName)) return activeTableName;
            if (prev && tables.includes(prev)) return prev;
            return tables[0] || null;
        });
        if (tables.length) {
            const targetTable = tables.includes(activeTableName || '') ? activeTableName : tables[0];
            onChangeTable(targetTable || null);
        } else {
            onChangeTable(null);
        }
    }, [activeConnId, activeDbName, connections, activeTableName]);

    useEffect(() => {
        setPagination((p) => ({ ...p, current: 1 }));
    }, [results?.rows?.length]);

    const runInlineAi = async (prompt: string, schemaText: string) => {
        if (!prompt.trim()) return '';
        const schemaInfo = schemaText ? `当前数据库表结构：\n${schemaText}\n` : '';
        const fullPrompt = `${schemaInfo}你是资深 SQL 专家，请根据用户需求生成 SQL 语句：“${prompt}”。仅返回 SQL 代码，不要包含 Markdown。`;
        if (aiConfig.provider === 'google') {
            if (!ai) throw new Error('未配置 AI Key');
            const response = await ai.models.generateContent({
                model: aiConfig.model || 'gemini-2.5-flash',
                contents: fullPrompt
            });
            return response.text?.replace(/```sql|```/g, '').trim() || '';
        }
        const baseUrl =
            aiConfig.baseUrl ||
            (aiConfig.provider === 'openai'
                ? 'https://api.openai.com/v1'
                : aiConfig.provider === 'deepseek'
                ? 'https://api.deepseek.com/v1'
                : 'http://localhost:11434/v1');
        if (!aiConfig.apiKey && aiConfig.provider !== 'ollama') throw new Error('未配置 AI Key');
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(aiConfig.provider === 'ollama' ? {} : { Authorization: `Bearer ${aiConfig.apiKey}` })
            },
            body: JSON.stringify({
                model: aiConfig.model,
                temperature: aiConfig.temperature,
                messages: [
                    { role: 'system', content: '你是资深 SQL 专家，直接返回 SQL 代码。' },
                    { role: 'user', content: fullPrompt }
                ]
            })
        });
        if (!res.ok) throw new Error(`AI 调用失败: ${res.status}`);
        const data = await res.json();
        const text =
            data.choices?.[0]?.message?.content ||
            data.choices?.[0]?.text ||
            data.output ||
            '';
        return text.replace(/```sql|```/g, '').trim();
    };

    const handleInlineAi = async () => {
        if (!inlineAiPrompt.trim()) return;
        const conn = connections.find((c) => c.id === activeConnId);
        const db = conn?.databases.find((d) => d.name === activeDbName);
        if (!conn || !db) {
            messageApi.error('请先选择连接和数据库');
            return;
        }
        const targetTable = selectedTable || activeTableName || db.tables?.[0] || null;
        if (!targetTable) {
            messageApi.error('请先选择表');
            return;
        }
        const cols = schemaColumns[`${db.name}.${targetTable}`] || schemaColumns[targetTable];
        const schemaText = cols && cols.length
            ? `表 ${targetTable}: ${cols.map((c) => `${c.name} ${c.type}${c.notNull ? ' NOT NULL' : ''}`).join('; ')}`
            : `表 ${targetTable}`;

        setIsInlineAiThinking(true);
        try {
            const newQuery = await runInlineAi(inlineAiPrompt, schemaText);
            if (newQuery) setQuery(newQuery);
        } catch (e: any) {
            console.error(e);
            const errMsg = e?.message || 'AI 调用失败';
            setResults({ headers: [], rows: [], error: errMsg });
            setActiveTabResult('messages');
        } finally {
            setIsInlineAiThinking(false);
        }
    };

    const handleRunSelected = () => {
        const selection = editorRef.current?.getSelection();
        const model = editorRef.current?.getModel();
        const selectedSql = selection && model ? model.getValueInRange(selection) : '';
        if (!selectedSql.trim()) {
            messageApi.error('请先选择 SQL 再运行');
            return;
        }
        runQuery(selectedSql);
    };

    const fetchTableColumns = async (table: string): Promise<ColumnDefinition[]> => {
        const guesses = [
            `DESCRIBE \`${table}\``,
            `SHOW FULL COLUMNS FROM \`${table}\``,
            activeDbName
                ? `SELECT column_name AS Field, data_type AS Type, is_nullable AS \`Null\`, column_default AS \`Default\`, column_key AS \`Key\`
                   FROM information_schema.columns
                   WHERE table_schema='${activeDbName}' AND table_name='${table}'`
                : null
        ].filter(Boolean) as string[];
        for (const sql of guesses) {
            try {
                const res = await onRunQuery(sql);
                if (!res.error && res.rows?.length) {
                    return res.rows.map((r: any) => {
                        const rawType = r.Type || r.type || '';
                        const lenMatch = String(rawType).match(/\((\d+)(?:,(\d+))?\)/);
                        const length = lenMatch && lenMatch[1] ? Number(lenMatch[1]) : undefined;
                        const decimal = lenMatch && lenMatch[2] ? Number(lenMatch[2]) : undefined;
                        const baseType = String(rawType).split('(')[0]?.toUpperCase() || 'VARCHAR';
                        return {
                            name: r.Field || r.column_name || '',
                            type: baseType,
                            length,
                            decimal,
                            notNull: String(r.Null || r.is_nullable || '').toUpperCase() === 'NO',
                            virtual: false,
                            isKey: String(r.Key || r.column_key || '').toUpperCase().includes('PRI'),
                            comment: r.Comment || r.comment || ''
                        };
                    });
                }
            } catch (e) {
                // ignore and try next
            }
        }
        return [];
    };

    const handleConnSelect = (value: string) => {
        onChangeConn(value);
        const nextConn = connections.find((c) => c.id === value);
        const firstDb = nextConn?.databases?.[0]?.name || null;
        onChangeDb(firstDb);
        const firstTable = nextConn?.databases?.[0]?.tables?.[0] || null;
        setSelectedTable(firstTable);
        onChangeTable(firstTable);
    };

    const handleDbSelect = (value: string) => {
        onChangeDb(value);
        const db = connections.find((c) => c.id === activeConnId)?.databases.find((d) => d.name === value);
        const t = db?.tables?.[0] || null;
        setSelectedTable(t);
        onChangeTable(t);
    };

    const handleTableSelect = (value: string) => {
        setSelectedTable(value);
        onChangeTable(value);
        setQuery(`SELECT * FROM ${value} LIMIT 100;`);
    };

    const connOptions = connections.map((c) => ({ label: c.name, value: c.id }));
    const dbOptions = currentConn?.databases?.map((d) => ({ label: d.name, value: d.name })) || [];
    const tableOptions = currentDb?.tables?.map((t) => ({ label: t, value: t })) || [];

    const formatSqlText = (sqlText: string) => {
        if (!sqlText) return '';
        let text = sqlText.replace(/\s+/g, ' ').trim();
        const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'UNION', 'INSERT', 'VALUES', 'UPDATE', 'SET', 'DELETE'];
        keywords.forEach((kw) => {
            const re = new RegExp(`\\s${kw}\\s`, 'gi');
            text = text.replace(re, `\n${kw} `);
        });
        return text.trim();
    };

    const handleFormat = () => {
        setQuery((q) => formatSqlText(q));
        messageApi.success('已格式化 SQL');
    };

    const handleOptimizeSelection = async () => {
        const selection = editorRef.current?.getSelection();
        const model = editorRef.current?.getModel();
        const sql = selection && model ? model.getValueInRange(selection) : '';
        const targetSql = sql && sql.trim() ? sql : query;
        if (!targetSql.trim()) {
            message.error('请先输入或选择 SQL');
            return;
        }
        const conn = connections.find((c) => c.id === activeConnId);
        const db = conn?.databases.find((d) => d.name === activeDbName);
        const schemaText = (db?.tables || [])
            .map((t) => {
                const cols = schemaColumns[`${activeDbName}.${t}`] || schemaColumns[t] || [];
                if (cols.length) return `表 ${t}: ${cols.map((c) => `${c.name} ${c.type}`).join(', ')}`;
                return `表 ${t}`;
            })
            .join('\n');
        const prompt = `优化并重写以下 SQL，保留原语义，确保可在当前数据库执行，返回优化后的 SQL，勿含 Markdown。\n${schemaText ? `当前表结构：\n${schemaText}\n` : ''}待优化 SQL:\n${targetSql}`;
        setIsOptimizingSelection(true);
        try {
            const optimized = await runInlineAi(prompt, schemaText);
            if (optimized) {
                setQuery(optimized);
                messageApi.success('已优化 SQL');
            } else {
                messageApi.error('AI 未返回结果');
            }
        } catch (e: any) {
            message.error(e?.message || '优化失败');
        } finally {
            setIsOptimizingSelection(false);
        }
    };

    const handleSimOk = async () => {
        const table = simTable || selectedTable;
        if (!table) {
            messageApi.error('请选择表');
            return;
        }
        let cols =
            (activeDbName ? schemaColumns[`${activeDbName}.${table}`] : undefined) ||
            schemaColumns[table] ||
            [];
        if (!cols.length) {
            cols = await fetchTableColumns(table);
        }
        if (!cols.length) {
            messageApi.error('未找到该表的字段信息，请先展开表或刷新库结构');
            return;
        }
        const schemaLines = cols.map((c) => {
            const len = c.length ? `(${c.length}${c.decimal ? `,${c.decimal}` : ''})` : '';
            const nullable = c.notNull ? 'NOT NULL' : 'NULL';
            const key = c.isKey ? 'PRIMARY KEY' : '';
            return `${c.name} ${c.type}${len} ${nullable} ${key}`.trim();
        });
        const schemaText = schemaLines.length ? `表 ${table}:\n${schemaLines.join('\n')}` : '';
        const prompt = `请为表 ${table} 生成 ${Math.max(1, simCount)} 行模拟数据的 INSERT 语句，必须只使用下方字段，不要新增字段，遵守类型/非空/主键约束。${
            simHint ? `额外要求：${simHint}。` : ''
        }\n字段列表：\n${schemaLines.join('\n')}\n仅返回 SQL，不要包含 Markdown。`;
        setIsSimGenerating(true);
        try {
            const sql = await runInlineAi(prompt, schemaText || `表 ${table}`);
            if (sql) {
                setQuery((prev) => `${prev ? `${prev}\n\n` : ''}${sql}`);
                messageApi.success('已生成模拟数据 SQL');
            } else {
                messageApi.error('AI 未返回结果');
            }
            setSimModal(false);
        } catch (e: any) {
            messageApi.error(e?.message || '生成失败');
        } finally {
            setIsSimGenerating(false);
        }
    };

    const handleSave = () => {
        try {
            localStorage.setItem('saved_query', query);
            messageApi.success('已保存当前 SQL');
        } catch (e) {
            messageApi.error('保存失败');
        }
    };

    useEffect(() => {
        if (!isActive) return;
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
            if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) {
                e.preventDefault();
                runQuery();
            }
            if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                handleSave();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isActive, runQuery, handleSave]);

    const buildCompletionItems = () => {
        const suggestions: any[] = [];
        const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON', 'CREATE', 'TABLE', 'DROP', 'ALTER'];
        keywords.forEach((kw) =>
            suggestions.push({
                label: kw,
                kind: (monacoRef.current?.languages?.CompletionItemKind?.Keyword) || 14,
                insertText: kw,
                detail: 'SQL'
            })
        );
        const conn = connections.find((c) => c.id === activeConnId);
        const db = conn?.databases.find((d) => d.name === activeDbName);
        const tableList = db?.tables || [];
        tableList.forEach((t) =>
            suggestions.push({
                label: t,
                kind: (monacoRef.current?.languages?.CompletionItemKind?.Class) || 5,
                insertText: t,
                detail: '表'
            })
        );
        const columns: ColumnDefinition[] = [];
        if (activeDbName) {
            tableList.forEach((t) => {
                const key = `${activeDbName}.${t}`;
                const cols = schemaColumns[key] || schemaColumns[t] || [];
                cols.forEach((c) => columns.push(c));
            });
        }
        columns.forEach((c) =>
            suggestions.push({
                label: c.name,
                kind: (monacoRef.current?.languages?.CompletionItemKind?.Field) || 4,
                insertText: c.name,
                detail: c.type
            })
        );
        return suggestions;
    };

    useEffect(() => {
        if (!monacoRef.current) return;
        if (completionDisposable.current) {
            completionDisposable.current.dispose();
        }
        const monaco = monacoRef.current;
        completionDisposable.current = monaco.languages.registerCompletionItemProvider('sql', {
            triggerCharacters: [' ', '.', '\n'],
            provideCompletionItems: () => {
                return { suggestions: buildCompletionItems() };
            }
        });
        return () => {
            if (completionDisposable.current) completionDisposable.current.dispose();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeConnId, activeDbName, connections, schemaColumns]);

    return (
            <div className={`flex-col h-full min-w-0 ${isDark ? 'bg-[#1e1e1e]' : 'bg-white'} ${isActive ? 'flex' : 'hidden'}`}>
                {contextHolder}
                <div className={`h-10 flex items-center px-3 select-none flex-shrink-0 border-b ${isDark ? 'bg-[#252526] border-[#1e1e1e] text-gray-200 shadow-inner' : 'bg-slate-50 border-slate-200 text-slate-700 shadow-sm'}`}>
                    <div className="flex items-center gap-2">
                        <button onClick={() => runQuery()} title="执行" className="flex items-center gap-1.5 text-xs bg-green-700 hover:bg-green-600 text-white px-2.5 py-1 rounded transition-colors shadow-sm">
                            <Play size={10} fill="currentColor" />
                    </button>
                    <button onClick={handleRunSelected} title="仅运行选中 SQL" className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${isDark ? 'text-gray-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                        <Play size={10} />
                        <span>选中运行</span>
                    </button>
                    <div className={`w-[1px] h-4 mx-1 ${isDark ? 'bg-[#3e3e42]' : 'bg-slate-300'}`}></div>
                    <button
                        onClick={() => setShowInlineAi(!showInlineAi)}
                        title="AI 编辑"
                        className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${showInlineAi ? (isDark ? 'bg-blue-900/40 text-blue-400' : 'bg-blue-100 text-blue-700 border border-blue-200') : isDark ? 'text-gray-300 hover:text-white' : 'text-slate-600 hover:text-slate-900 border border-transparent hover:border-blue-200'}`}
                    >
                        <Sparkles size={12} className={showInlineAi ? 'text-blue-400' : 'text-blue-400'} />
                    </button>
                    <button
                        onClick={() => {
                            setSimTable(selectedTable);
                            setSimModal(true);
                        }}
                        title="生成模拟数据"
                        className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${isDark ? 'text-gray-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        <LayoutGrid size={12} />
                    </button>
                    <button
                        onClick={() => handleOptimizeSelection()}
                        title="优化选中 SQL"
                        disabled={isOptimizingSelection}
                        className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${isDark ? 'text-gray-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'} disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        <Wand2 size={12} />
                    </button>
                    <button onClick={handleSave} title="保存" className={`flex items-center gap-1.5 text-xs transition-colors ${isDark ? 'text-gray-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                        <Save size={12} />
                    </button>
                    <button onClick={handleFormat} title="格式化" className={`flex items-center gap-1.5 text-xs transition-colors ${isDark ? 'text-gray-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                        <Eraser size={12} />
                    </button>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                    <Select
                        size="small"
                        placeholder="连接"
                        style={{ width: 140 }}
                        value={activeConnId || undefined}
                        options={connOptions}
                        onChange={handleConnSelect}
                        popupMatchSelectWidth={false}
                    />
                    <Select
                        size="small"
                        placeholder="数据库"
                        style={{ width: 140 }}
                        value={activeDbName || undefined}
                        options={dbOptions}
                        onChange={handleDbSelect}
                        disabled={!activeConnId || dbOptions.length === 0}
                        popupMatchSelectWidth={false}
                    />
                    <Select
                        size="small"
                        placeholder="表"
                        style={{ width: 140 }}
                        value={selectedTable || undefined}
                        options={tableOptions}
                        onChange={handleTableSelect}
                        disabled={!activeDbName || tableOptions.length === 0}
                        popupMatchSelectWidth={false}
                    />
                </div>
            </div>

            <div style={{ height: editorHeight }} className={`relative flex flex-col flex-shrink-0 ${isDark ? 'bg-[#1e1e1e]' : 'bg-white'}`}>
                <Editor
                    height="100%"
                    language="sql"
                    theme={isDark ? 'vs-dark' : 'vs'}
                    value={query}
                    onMount={(editor, monaco) => {
                        editorRef.current = editor;
                        monacoRef.current = monaco;
                    }}
                    onChange={(val) => setQuery(val || '')}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        wordWrap: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        suggestOnTriggerCharacters: true,
                        quickSuggestions: true,
                        tabSize: 2
                    }}
                />
            </div>

            <div
                className={`flex flex-col border-t shadow-[0_-6px_12px_rgba(0,0,0,0.35)] ${isDark ? 'bg-[#111] border-[#333]' : 'bg-slate-50 border-slate-200 shadow-inner'}`}
                style={{ height: resultsHeight, flex: `0 0 ${resultsHeight}px`, marginTop: 'auto' }}
            >
                <div className={`h-2 w-full relative z-10 ${isDark ? 'bg-[#111] border-b border-[#333]' : 'bg-slate-100 border-b border-slate-200'}`}>
                    <Resizer onResize={(d) => setResultsHeight((p) => Math.max(200, Math.min(800, p - d)))} direction="vertical" />
                </div>
                {showInlineAi && (
                    <div className={`${isDark ? 'bg-[#1f1f1f] border-[#333]' : 'bg-white border-slate-200'} border-b px-3 py-2 flex gap-2 items-center flex-shrink-0 animate-fade-in`}>
                        <input
                            autoFocus
                            value={inlineAiPrompt}
                            onChange={(e) => setInlineAiPrompt(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleInlineAi()}
                            placeholder="描述你的需求或查询语句..."
                            className={`flex-1 border rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors ${isDark ? 'bg-[#111] border-[#3e3e42] text-gray-200' : 'bg-white border-slate-200 text-slate-800'}`}
                        />
                        <button onClick={handleInlineAi} disabled={isInlineAiThinking} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-md transition-colors disabled:opacity-50">
                            {isInlineAiThinking ? '思考中...' : '生成'}
                        </button>
                        <button onClick={() => setShowInlineAi(false)} className={`p-2 rounded-md ${isDark ? 'hover:bg-[#3e3e42] text-gray-400' : 'hover:bg-slate-200 text-slate-500'}`}>
                            <X size={14} />
                        </button>
                    </div>
                )}
                <div className={`flex border-b flex-shrink-0 ${isDark ? 'bg-[#252526] border-[#333]' : 'bg-slate-100 border-slate-200'}`}>
                    <button onClick={() => setActiveTabResult('results')} className={`px-4 py-1.5 text-xs border-r ${isDark ? 'border-[#333]' : 'border-slate-200'} ${activeTabResult === 'results' ? (isDark ? 'bg-[#1e1e1e] text-white border-t-2 border-t-blue-500' : 'bg-white text-blue-700 border-t-2 border-t-blue-500') : isDark ? 'text-gray-400 hover:bg-[#2d2d30]' : 'text-slate-600 hover:bg-slate-200'}`}>
                        结果
                    </button>
                    <button onClick={() => setActiveTabResult('messages')} className={`px-4 py-1.5 text-xs border-r ${isDark ? 'border-[#333]' : 'border-slate-200'} ${activeTabResult === 'messages' ? (isDark ? 'bg-[#1e1e1e] text-white border-t-2 border-t-blue-500' : 'bg-white text-blue-700 border-t-2 border-t-blue-500') : isDark ? 'text-gray-400 hover:bg-[#2d2d30]' : 'text-slate-600 hover:bg-slate-200'}`}>
                        消息
                    </button>
                </div>
                <div className={`flex-1 overflow-auto ${isDark ? 'bg-[#1e1e1e]' : 'bg-white'}`}>
                    {activeTabResult === 'results' && results && !results.error && results.rows.length > 0 && (
                        <AntTable
                            size="small"
                            bordered
                            pagination={{
                                current: pagination.current,
                                pageSize: pagination.pageSize,
                                total: results.rows.length,
                                showQuickJumper: true,
                                onChange: (page, pageSize) => setPagination({ current: page, pageSize })
                            }}
                            columns={[
                                {
                                    title: '#',
                                    dataIndex: '__index',
                                    width: 60,
                                    render: (_: any, __: any, idx: number) => (pagination.current - 1) * pagination.pageSize + idx + 1
                                },
                                ...(results.headers || []).map((h) => ({
                                    title: h,
                                    dataIndex: h,
                                    key: h,
                                    ellipsis: true,
                                    render: (val: any) => formatValue(val)
                                }))
                            ]}
                            dataSource={(results.rows || []).map((row, idx) => ({ __index: idx + 1, key: idx, ...row }))}
                            rowKey="key"
                            locale={{ emptyText: null }}
                        />
                    )}
                    {activeTabResult === 'results' && (!results || results.rows.length === 0) && !results?.error && (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-40" style={{ height: resultsHeight }}>
                            <LayoutGrid size={48} strokeWidth={1} />
                            <span className="mt-2 text-sm">暂无结果</span>
                        </div>
                    )}
                    {activeTabResult === 'messages' && (
                        <div className="p-3 text-xs font-mono">{results?.error ? <span className="text-red-400">{results.error}</span> : <span className="text-gray-400">执行完成。</span>}</div>
                    )}
                </div>
                <div className={`flex items-center justify-between px-3 py-1 text-xs ${isDark ? 'bg-[#0f0f0f] border-t border-[#333] text-gray-300' : 'bg-slate-50 border-t border-slate-200 text-slate-600'}`}>
                    <span>运行时长：{lastRuntime !== null ? `${lastRuntime.toFixed(0)} ms` : '--'}</span>
                    <span>结果行数：{lastRowCount !== null ? lastRowCount : '--'}</span>
                </div>
            </div>
            <Modal
                open={simModal}
                title="生成模拟数据"
                onCancel={() => {
                    if (!isSimGenerating) setSimModal(false);
                }}
                onOk={handleSimOk}
                okText={isSimGenerating ? '生成中...' : '生成 SQL'}
                cancelText="取消"
                maskClosable={false}
                confirmLoading={isSimGenerating}
            >
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="w-20 text-sm text-right">目标表</span>
                        <Select
                            className="flex-1"
                            placeholder="选择表"
                            value={simTable || selectedTable || undefined}
                            options={tableOptions}
                            onChange={(val) => setSimTable(val)}
                            popupMatchSelectWidth={false}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-20 text-sm text-right">生成条数</span>
                        <Input
                            type="number"
                            min={1}
                            value={simCount}
                            onChange={(e) => setSimCount(Math.max(1, Number(e.target.value) || 1))}
                        />
                    </div>
                    <div className="flex items-start gap-2">
                        <span className="w-20 text-sm text-right leading-6">生成提示</span>
                        <Input.TextArea
                            className="flex-1"
                            value={simHint}
                            onChange={(e) => setSimHint(e.target.value)}
                            placeholder="示例：订单表包含商品、数量、买家信息等"
                            autoSize={{ minRows: 2, maxRows: 4 }}
                        />
                    </div>
                </div>
            </Modal>
        </div>
    );
};

const App = () => {
    const [activeActivity, setActiveActivity] = useState<Activity>('database');
    const [isDark, setIsDark] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem(THEME_STORAGE_KEY);
            if (saved === 'dark') return true;
            if (saved === 'light') return false;
        } catch (e) {
            console.warn('load theme failed', e);
        }
        return true;
    });
    const [leftSidebarWidth, setLeftSidebarWidth] = useState(260);
    const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(350);
    const [showRightSidebar, setShowRightSidebar] = useState(false);
    const [accentColor, setAccentColor] = useState('#3b82f6');
    const [tabs, setTabs] = useState<TabData[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [activeConnId, setActiveConnId] = useState<string | null>(null);
    const [activeDbName, setActiveDbName] = useState<string | null>(null);
    const [activeTableName, setActiveTableName] = useState<string | null>(null);
    const [connections, setConnections] = useState<ConnectionNode[]>([]);
    const [showConnMenu, setShowConnMenu] = useState(false);
    const [showConnTypeMenu, setShowConnTypeMenu] = useState(false);
    const connMenuRef = useRef<HTMLDivElement | null>(null);
    const connProviders: { type: DbType; label: string; icon: string }[] = [
        { type: 'mysql', label: 'MySQL', icon: 'devicon-mysql-plain' },
        { type: 'postgres', label: 'PostgreSQL', icon: 'devicon-postgresql-plain' },
        { type: 'sqlserver', label: 'SQL Server', icon: 'devicon-microsoftsqlserver-plain' },
        { type: 'oracle', label: 'Oracle', icon: 'devicon-oracle-original' },
        { type: 'redis', label: 'Redis', icon: 'devicon-redis-plain' }
    ];
    const getConnProvider = (type?: DbType) => connProviders.find((c) => c.type === type);

    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([{ id: '1', role: 'model', text: '你好！我是你的 SQL 助手，需要我帮你优化或查询什么数据？', timestamp: Date.now() }]);
    const [chatInput, setChatInput] = useState('');
    const [chatSelectedTables, setChatSelectedTables] = useState<string[]>([]);
    const [chatChartIntent, setChatChartIntent] = useState<'none' | 'auto' | 'line' | 'bar' | 'pie'>('none');
    const [isChatThinking, setIsChatThinking] = useState(false);
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const tabQuerySetters = useRef<Record<string, (sql: string, mode?: 'replace' | 'append') => void>>({});

    const [aiConfig, setAiConfig] = useState<AiConfig>({ provider: 'google', model: AI_DEFAULT_MODELS.google, temperature: 0.4, baseUrl: '', apiKey: '' });
    const [modals, setModals] = useState({ settings: false, newTable: false, designTable: false, erDiagram: false, newConn: false, newDatabase: false });
    const [settingsTab, setSettingsTab] = useState<'theme' | 'model' | 'profile'>('theme');
    const [newConnForm, setNewConnForm] = useState({ name: '新连接', type: 'mysql' as DbType, host: 'localhost', port: DEFAULT_PORT.mysql, user: 'root', password: '', database: '' });
    const [tableForm, setTableForm] = useState({ name: '', columns: [defaultColumn()] });
    const [newTableTarget, setNewTableTarget] = useState<{ connId: string | null; dbName: string | null }>({ connId: null, dbName: null });
    const [newDatabaseForm, setNewDatabaseForm] = useState<{ connId: string | null; name: string; charset: string; collation: string }>({
        connId: null,
        name: '',
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci'
    });
    const [profile, setProfile] = useState<{ name: string; avatar: string }>({ name: 'JS', avatar: '' });
    const [globalError, setGlobalError] = useState<string | null>(null);
    const [isAiCreateLoading, setIsAiCreateLoading] = useState(false);
    const [isAiDesignLoading, setIsAiDesignLoading] = useState(false);
    const [lastQueryContext, setLastQueryContext] = useState<{ sql?: string; db?: string | null; connId?: string | null; error?: string | null; rows?: any[]; headers?: string[] }>({});
    const [chartOptions, setChartOptions] = useState<Record<string, any>>({});
    const [designTableData, setDesignTableData] = useState<{ name: string; columns: ColumnDefinition[] }>({ name: '', columns: [] });
    const [tableAiPrompt, setTableAiPrompt] = useState('');
    const [designAiPrompt, setDesignAiPrompt] = useState('');
    const [mockSchema, setMockSchema] = useState<Record<string, ColumnDefinition[]>>(INITIAL_SCHEMA);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean; table?: string; type?: 'table' | 'conn'; connId?: string; dbName?: string }>({ x: 0, y: 0, visible: false, table: undefined, type: 'table', connId: undefined, dbName: undefined });

    const [messageApi, contextHolder] = message.useMessage();
    const [isTestingConn, setIsTestingConn] = useState(false);

    const aiClient = useMemo(() => {
        if (aiConfig.provider !== 'google') return null;
        const key = aiConfig.apiKey || process.env.API_KEY;
        if (!key) return null;
        return new GoogleGenAI({ apiKey: key });
    }, [aiConfig.provider, aiConfig.apiKey]);

    const ensureEcharts = useCallback(async () => {
        if ((window as any).echarts) return (window as any).echarts;
        await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            const prevDefine = (window as any).define;
            const hadDefine = typeof prevDefine === 'function';
            // 避免与 RequireJS/Monaco AMD 冲突
            (window as any).define = undefined;
            script.src = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';
            script.onload = () => {
                if (hadDefine) (window as any).define = prevDefine;
                else delete (window as any).define;
                resolve();
            };
            script.onerror = () => {
                if (hadDefine) (window as any).define = prevDefine;
                else delete (window as any).define;
                reject(new Error('加载 ECharts 失败'));
            };
            document.body.appendChild(script);
        });
        return (window as any).echarts;
    }, []);

    const handleResizeLeft = (delta: number) => {
        setLeftSidebarWidth((prev) => Math.max(200, Math.min(600, prev + delta)));
    };

    const handleResizeRight = (delta: number) => {
        setRightSidebarWidth((prev) => Math.max(250, Math.min(800, prev - delta)));
    };

    const handleActiveConnChange = (connId: string) => {
        setActiveConnId(connId);
        const nextConn = connections.find((c) => c.id === connId);
        const nextDb = nextConn?.databases?.[0]?.name || null;
        setActiveDbName(nextDb);
        const nextTable = nextConn?.databases?.[0]?.tables?.[0] || null;
        setActiveTableName(nextTable);
        setChatSelectedTables([]);
    };

    const handleActiveDbChange = (dbName: string | null) => {
        setActiveDbName(dbName);
        const table = connections.find((c) => c.id === activeConnId)?.databases.find((d) => d.name === dbName)?.tables?.[0] || null;
        setActiveTableName(table);
        setChatSelectedTables([]);
    };

    const createTab = (options?: { title?: string; initialQuery?: string; connId?: string | null; dbName?: string | null }) => {
        const newTab: TabData = {
            id: Date.now().toString(),
            title: options?.title || 'New Query',
            type: 'query',
            initialQuery: options?.initialQuery || '',
            connId: options?.connId ?? activeConnId,
            dbName: options?.dbName ?? activeDbName
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(newTab.id);
        setChatSelectedTables([]);
    };

    const closeTab = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newTabs = tabs.filter((t) => t.id !== id);
        setTabs(newTabs);
        unregisterTabQuerySetter(id);
        if (activeTabId === id && newTabs.length > 0) setActiveTabId(newTabs[newTabs.length - 1].id);
        else if (newTabs.length === 0) setActiveTabId(null);
    };

    const handleTableClick = (tableName: string, connId?: string | null, dbName?: string | null, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const targetConn = connId ?? activeConnId;
        const targetDb = dbName ?? activeDbName;
        setActiveConnId(targetConn);
        setActiveDbName(targetDb);
        setActiveTableName(tableName);
        createTab({ title: tableName, initialQuery: `SELECT * FROM ${tableName} LIMIT 100;`, connId: targetConn, dbName: targetDb });
    };

    const showToast = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
        const fn = type === 'success' ? messageApi.success : type === 'error' ? messageApi.error : messageApi.info;
        fn(msg);
    };

    const registerTabQuerySetter = useCallback((tabId: string, setter: (sql: string, mode?: 'replace' | 'append') => void) => {
        tabQuerySetters.current[tabId] = setter;
    }, []);

    const unregisterTabQuerySetter = useCallback((tabId: string) => {
        delete tabQuerySetters.current[tabId];
    }, []);

    const extractTablesFromSql = (sql: string) => {
        const tables = new Set<string>();
        const regex = /from\s+([a-zA-Z0-9_]+)/gi;
        let match;
        while ((match = regex.exec(sql)) !== null) {
            const table = match[1];
            if (table) tables.add(table);
        }
        return Array.from(tables);
    };

    const normalizeSqlText = (text: string) => {
        if (!text) return '';
        const fenceMatch = text.match(/```[\s\S]*?```/g);
        if (fenceMatch && fenceMatch.length) {
            text = fenceMatch.map((b) => b.replace(/```(?:sql)?/gi, '').replace(/```/g, '')).join('\n');
        }
        return text.replace(/```/g, '').replace(/```sql/gi, '').trim();
    };

    const handleDbAskAi = async (prompt?: string) => {
        const dbAiPrompt = prompt ?? tableAiPrompt;
        if (!dbAiPrompt.trim()) {
            showToast('请输入需求后再生成 SQL', 'error');
            return;
        }
        if (aiConfig.provider === 'google' && !aiClient) {
            showToast('请在设置中填写 Gemini API Key，或切换到其他模型提供者。', 'error');
            return;
        }
        try {
            const schemaStr = JSON.stringify(mockSchema);
            const tables = Object.keys(mockSchema);
            const instruction = `
        You are a SQL expert. Existing tables: ${tables.join(', ') || 'none'}.
        If user requests tables not in the list, respond with JSON: { "error": "表不存在: <names>" } and no SQL.
        Respond JSON only: { "sql": "...", "explanation": "..." } or with "error".
        Schema detail: ${schemaStr}.
        User question: "${dbAiPrompt}".
      `;
            if (aiConfig.provider === 'google') {
                const response = await aiClient!.models.generateContent({
                    model: aiConfig.model,
                    contents: instruction,
                    config: { responseMimeType: 'application/json', temperature: aiConfig.temperature }
                });
                const res = JSON.parse(response.text || '{}');
                if (res.error) {
                    showToast(res.error, 'error');
                    return;
                }
                const sql = normalizeSqlText(res.sql);
                const usedTables = extractTablesFromSql(sql).map((t) => t.toLowerCase());
                const missing = usedTables.filter((t) => !tables.map((x) => x.toLowerCase()).includes(t));
                if (missing.length) {
                    showToast(`表不存在: ${missing.join(', ')}`, 'error');
                    return;
                }
                createTab({ title: 'AI SQL', initialQuery: sql });
            } else {
                showToast('当前示例仅实现 Gemini，本地可扩展其他模型', 'info');
            }
        } catch (e: any) {
            showToast(`生成失败: ${e?.message || e}`, 'error');
        }
    };

const extractSqlFromText = (text: string) => {
    if (!text) return '';
    const fence = text.match(/```sql([\s\S]*?)```/i);
    if (fence && fence[1]) return fence[1].trim();
    const code = text.match(/```([\s\S]*?)```/);
    if (code && code[1]) return code[1].trim();
    return text.trim();
};

const extractSqlSnippetFromText = (text: string) => {
    if (!text) return '';
    const sqlFence = text.match(/```sql([\s\S]*?)```/i);
    if (sqlFence && sqlFence[1]) return sqlFence[1].trim();
    const codeFence = text.match(/```([\s\S]*?)```/);
    if (codeFence && codeFence[1]) return codeFence[1].trim();
    return '';
};

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
            if (e.ctrlKey && (e.key === 't' || e.key === 'T')) {
                e.preventDefault();
                createTab();
            }
            if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                handleDbAskAi();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleDbAskAi]);

    const generateTableColumnsWithAi = async (target: 'create' | 'design') => {
        const idea = target === 'create' ? tableAiPrompt : designAiPrompt;
        if (!idea.trim()) return;
        try {
            if (target === 'create') setIsAiCreateLoading(true);
            else setIsAiDesignLoading(true);
            const baseInstruction = `生成表设计，包括表名与字段，返回 JSON 格式 { "tableName": "<name>", "columns": [ ... ] }。字段 5-8 个，每个字段包含 name,type,length,decimal,notNull,isKey,comment，类型用 BIGINT, INTEGER, VARCHAR, TEXT, DATE, DATETIME, DECIMAL, BOOLEAN。`;
            let text = '';
            if (aiConfig.provider === 'google') {
                if (!aiClient) {
                    showToast('请在设置中填写 Gemini API Key，或切换到其他模型提供者。', 'error');
                    return;
                }
                const response = await aiClient.models.generateContent({
                    model: aiConfig.model,
                    contents: `${baseInstruction}\n用户需求: ${idea}`,
                    config: { temperature: aiConfig.temperature }
                });
                text = response.text || '';
            } else {
                const baseUrl =
                    aiConfig.baseUrl ||
                    (aiConfig.provider === 'openai'
                        ? 'https://api.openai.com/v1'
                        : aiConfig.provider === 'deepseek'
                        ? 'https://api.deepseek.com/v1'
                        : 'http://localhost:11434/v1');
                if (!aiConfig.apiKey && aiConfig.provider !== 'ollama') {
                    showToast('请填写 API Key', 'error');
                    return;
                }
                const resp = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(aiConfig.provider === 'ollama' ? {} : { Authorization: `Bearer ${aiConfig.apiKey}` })
                    },
                    body: JSON.stringify({
                        model: aiConfig.model,
                        temperature: aiConfig.temperature,
                        messages: [
                            { role: 'system', content: baseInstruction },
                            { role: 'user', content: idea }
                        ]
                    })
                });
                if (!resp.ok) throw new Error(`AI 调用失败: ${resp.status}`);
                const data = await resp.json();
                text =
                    data.choices?.[0]?.message?.content ||
                    data.choices?.[0]?.text ||
                    data.output ||
                    '';
            }
            const parsed = parseAiTableDesign(text);
            const cols = parsed.columns.length ? parsed.columns : parseAiColumns(text);
            if (!cols.length) {
                showToast('AI 未返回有效字段', 'error');
                return;
            }
            if (target === 'create') {
                setTableForm((p) => ({ ...p, name: parsed.tableName || p.name || 'new_table', columns: cols }));
            } else {
                setDesignTableData((p) => ({ ...p, name: parsed.tableName || p.name, columns: cols }));
            }
        } catch (err: any) {
            showToast(`生成失败: ${err?.message || err}`, 'error');
        } finally {
            if (target === 'create') setIsAiCreateLoading(false);
            else setIsAiDesignLoading(false);
        }
    };

    const handleSaveNewTable = async () => {
        if (!tableForm.name.trim()) {
            showToast('请输入表名', 'error');
            return;
        }
        if (!tableForm.columns.length) {
            showToast('请至少添加一列', 'error');
            return;
        }
        if (!newTableTarget.connId || !newTableTarget.dbName) {
            showToast('请选择连接与数据库', 'error');
            return;
        }
        if (window.desktopAPI && newTableTarget.connId) {
            try {
                const runtimeId = await ensureConnection(newTableTarget.connId);
                const createSql = buildCreateTableSql(tableForm.name, tableForm.columns);
                const res = await window.desktopAPI.runQuery({ connId: runtimeId, sql: createSql, database: newTableTarget.dbName || undefined });
                if (res.error) {
                    showToast(res.error, 'error');
                    return;
                }
                await loadSchemaForConnection(newTableTarget.connId);
                showToast('已在数据库创建表', 'success');
            } catch (e: any) {
                showToast(`创建失败: ${e?.message || e}`, 'error');
                return;
            }
        }
        setModals((m) => ({ ...m, newTable: false }));
        setTableForm({ name: '', columns: [defaultColumn()] });
    };

    const handleSaveDesignTable = () => {
        if (!designTableData.name.trim()) {
            showToast('请输入表名', 'error');
            return;
        }
        setMockSchema((prev) => ({ ...prev, [designTableData.name]: designTableData.columns }));
        showToast('已保存表结构', 'success');
        setModals((m) => ({ ...m, designTable: false }));
    };

    const handleSaveNewDatabase = async () => {
        if (!newDatabaseForm.connId || !newDatabaseForm.name.trim()) {
            showToast('请选择连接并填写库名', 'error');
            return;
        }
        const conn = connections.find((c) => c.id === newDatabaseForm.connId);
        if (!conn) {
            showToast('连接不存在', 'error');
            return;
        }
        const dbName = newDatabaseForm.name.trim();
        let sql = '';
        if (conn.type === 'mysql') {
            sql = `CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET ${newDatabaseForm.charset} COLLATE ${newDatabaseForm.collation};`;
        } else if (conn.type === 'postgres') {
            sql = `CREATE DATABASE "${dbName}" WITH ENCODING '${newDatabaseForm.charset || 'UTF8'}' LC_COLLATE '${newDatabaseForm.collation || 'en_US.UTF-8'}' LC_CTYPE '${newDatabaseForm.collation || 'en_US.UTF-8'}';`;
        } else if (conn.type === 'sqlserver') {
            sql = `IF NOT EXISTS(SELECT * FROM sys.databases WHERE name='${dbName}') CREATE DATABASE [${dbName}];`;
        } else if (conn.type === 'oracle') {
            sql = `CREATE USER ${dbName} IDENTIFIED BY ${dbName}; GRANT CONNECT, RESOURCE TO ${dbName};`;
        } else {
            showToast('当前类型暂不支持创建数据库', 'error');
            return;
        }
        const res = await runSql(conn.id, null, sql);
        if (res.error) {
            showToast(`创建失败: ${res.error}`, 'error');
            return;
        }
        showToast('数据库已创建', 'success');
        setModals((m) => ({ ...m, newDatabase: false }));
        setNewDatabaseForm((f) => ({ ...f, name: '' }));
        await loadSchemaForConnection(conn.id);
    };

    const handleDeleteTable = (table: string, dbName?: string | null, connId?: string | null) => {
        Modal.confirm({
            title: `确认删除表 ${table}?`,
            content: '此操作不可恢复，请谨慎执行。',
            okText: '删除',
            cancelText: '取消',
            okType: 'danger',
            centered: true,
            async onOk() {
                try {
                    const targetConnId = connId || activeConnId;
                    if (window.desktopAPI && targetConnId) {
                        const res = await runSql(targetConnId, dbName || null, `DROP TABLE ${table};`);
                        if (res.error) {
                            showToast(res.error, 'error');
                            return;
                        }
                    }
                    setConnections((prev) =>
                        prev.map((c) => {
                            if (c.id !== targetConnId) return c;
                            const dbs = c.databases.map((d) =>
                                d.name === dbName ? { ...d, tables: (d.tables || []).filter((t) => t !== table) } : d
                            );
                            return { ...c, databases: dbs };
                        })
                    );
                    setMockSchema((prev) => {
                        const next = { ...prev };
                        delete next[table];
                        if (dbName) delete next[`${dbName}.${table}`];
                        return next;
                    });
                    showToast('已删除表', 'success');
                } catch (e: any) {
                    showToast(e?.message || String(e), 'error');
                }
            }
        });
    };

    const handleTestConnection = async () => {
        if (!newConnForm.host.trim()) {
            showToast('请填写主机地址', 'error');
            return;
        }
        if (!window.desktopAPI) {
            showToast('缺少 desktopAPI，无法真实测试', 'error');
            return;
        }
        setIsTestingConn(true);
        try {
            const cfg: DbConnectionConfig = { name: newConnForm.name, type: newConnForm.type, host: newConnForm.host, port: newConnForm.port, user: newConnForm.user, password: newConnForm.password };
            const res = await window.desktopAPI.connect(cfg);
            const schema = await window.desktopAPI.listSchema({ connId: res.id });
            showToast('连接测试成功', 'success');
            setConnections((prev) => {
                const exists = prev.find((c) => c.id === res.id);
                if (!exists) return prev;
                return prev.map((c) =>
                    c.id === res.id
                        ? {
                            ...c,
                            runtimeId: res.id,
                            status: 'connected',
                            databases: (schema.databases || []).map((d) => ({ ...d, expanded: false, tablesExpanded: false, viewsExpanded: false }))
                        }
                        : c
                );
            });
        } catch (e: any) {
            showToast(`连接失败: ${e?.message || e}`, 'error');
        } finally {
            setIsTestingConn(false);
        }
    };

    const handleOpenDesign = async (table: string, dbName?: string, connId?: string | null) => {
        const key = dbName ? `${dbName}.${table}` : table;
        let cols = mockSchema[key] || mockSchema[table] || [];

        if ((!cols || !cols.length) && connId && window.desktopAPI) {
            const res = await loadSchemaForConnection(connId, dbName, connections.find((c) => c.id === connId)?.runtimeId);
            const merged = res?.schema || {};
            cols = merged[key] || merged[table] || mockSchema[key] || mockSchema[table] || [];
            if ((!cols || !cols.length) && activeConnId) {
                const targetConn = connections.find((c) => c.id === (connId || activeConnId));
                const dbNameSafe = dbName || activeDbName || '';
                if (targetConn) {
                    let describeSql = '';
                    if (targetConn.type === 'mysql') {
                        describeSql = `SELECT COLUMN_NAME as name, DATA_TYPE as data_type, CHARACTER_MAXIMUM_LENGTH as len, NUMERIC_SCALE as scale, IS_NULLABLE, COLUMN_KEY FROM information_schema.columns WHERE table_schema='${dbNameSafe}' AND table_name='${table}' ORDER BY ORDINAL_POSITION;`;
                    } else if (targetConn.type === 'postgres') {
                        describeSql = `SELECT column_name as name, data_type, character_maximum_length as len, numeric_scale as scale, is_nullable FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position;`;
                    } else if (targetConn.type === 'sqlserver') {
                        describeSql = `SELECT COLUMN_NAME as name, DATA_TYPE as data_type, CHARACTER_MAXIMUM_LENGTH as len, NUMERIC_SCALE as scale, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${table}' ORDER BY ORDINAL_POSITION;`;
                    } else if (targetConn.type === 'oracle') {
                        describeSql = `SELECT COLUMN_NAME as name, DATA_TYPE as data_type, DATA_LENGTH as len, DATA_SCALE as scale, NULLABLE as is_nullable FROM USER_TAB_COLUMNS WHERE TABLE_NAME='${table.toUpperCase()}';`;
                    }
                    if (describeSql) {
                        try {
                            const result = await runSql(targetConn.id, dbNameSafe || null, describeSql);
                            if (result && result.rows && result.rows.length) {
                                cols = result.rows.map((r: any) => {
                                    const name = r.name || r.column_name || r.COLUMN_NAME;
                                    const type = (r.data_type || r.DATA_TYPE || '').toUpperCase();
                                    const len = r.len || r.character_maximum_length || r.CHARACTER_MAXIMUM_LENGTH || r.DATA_LENGTH;
                                    const dec = r.scale || r.numeric_scale || r.NUMERIC_SCALE || r.DATA_SCALE;
                                    const nullable = (r.is_nullable || r.IS_NULLABLE || r.NULLABLE || '').toString().toLowerCase();
                                    const colKey = (r.column_key || r.COLUMN_KEY || '').toUpperCase();
                                    return {
                                        name: name || '',
                                        type: type || 'TEXT',
                                        length: len ? Number(len) : undefined,
                                        decimal: dec ? Number(dec) : undefined,
                                        notNull: nullable === 'no' ? true : false,
                                        virtual: false,
                                        isKey: colKey === 'PRI'
                                    } as ColumnDefinition;
                                });
                            }
                        } catch (e) {
                            console.warn('describe table failed', e);
                        }
                    }
                }
            }
        }

        setDesignTableData({ name: table, columns: JSON.parse(JSON.stringify(cols || [])) });
        setDesignAiPrompt('');
        if (dbName) setActiveDbName(dbName);
        setModals((m) => ({ ...m, designTable: true }));
    };

    const handleGenerateMockData = () => {
        showToast('生成模拟数据功能已禁用（需真实数据源）', 'error');
    };

    const generateERConnections = () => {
        let tables = Object.keys(mockSchema);
        if (!tables.length) {
            connections.forEach((c) => {
                c.databases.forEach((d) => {
                    (d.tables || []).forEach((t) => tables.push(d.name ? `${d.name}.${t}` : t));
                });
            });
        }
        const lines: { x1: number; y1: number; x2: number; y2: number; from: string; to: string }[] = [];
        const tablePositions: Record<string, { x: number; y: number }> = {};
        const cardWidth = 240;
        const cardHeight = 140;
        const gapX = 60;
        const gapY = 50;
        const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
        tables.forEach((table, index) => {
            const row = Math.floor(index / cols);
            const col = index % cols;
            tablePositions[table] = {
                x: 80 + col * (cardWidth + gapX),
                y: 80 + row * (cardHeight + gapY)
            };
        });
        tables.forEach((table) => {
            const colsDef = mockSchema[table] || [];
            colsDef.forEach((col) => {
                if (col.name.endsWith('_id')) {
                    const targetTable = col.name.replace('_id', '') + 's';
                    if (tables.includes(targetTable) && targetTable !== table) {
                        const p1 = tablePositions[table];
                        const p2 = tablePositions[targetTable];
                        if (p1 && p2) {
                            lines.push({
                                x1: p1.x + cardWidth / 2,
                                y1: p1.y + cardHeight / 2,
                                x2: p2.x + cardWidth / 2,
                                y2: p2.y + cardHeight / 2,
                                from: table,
                                to: targetTable
                            });
                        }
                    }
                }
            });
        });
        return { tablePositions, lines };
    };

    const erData = useMemo(() => (modals.erDiagram ? generateERConnections() : { tablePositions: {}, lines: [] }), [modals.erDiagram, mockSchema]);

    const ensureConnection = async (connId: string, fallback?: ConnectionNode) => {
        const conn = connections.find((c) => c.id === connId) || fallback;
        if (!conn) throw new Error('连接不存在');
        if (!window.desktopAPI) throw new Error('缺少桌面数据库接口 window.desktopAPI');
        const cfg: DbConnectionConfig =
            conn.config || {
                name: conn.name,
                type: conn.type,
                host: conn.host.split(':')[0],
                port: Number(conn.host.split(':')[1]) || DEFAULT_PORT[conn.type],
                user: 'root',
                password: ''
            };
        if (conn.runtimeId) return conn.runtimeId;
        setConnections((prev) => prev.map((c) => (c.id === connId ? { ...c, status: 'connecting', lastError: undefined } : c)));
        try {
            const res = await window.desktopAPI.connect(cfg);
            setConnections((prev) => prev.map((c) => (c.id === connId ? { ...c, runtimeId: res.id, status: 'connected', lastError: undefined, config: cfg } : c)));
            return res.id;
        } catch (e: any) {
            setConnections((prev) => prev.map((c) => (c.id === connId ? { ...c, status: 'error', lastError: e?.message || String(e) } : c)));
            throw e;
        }
    };

    const loadSchemaForConnection = async (connId: string, dbName?: string, runtimeIdOverride?: string | null) => {
        const safeDb = typeof dbName === 'string' ? dbName : undefined;
        if (!window.desktopAPI) {
            showToast('缺少桌面数据库接口，无法刷新连接', 'error');
            return { schema: {} as Record<string, ColumnDefinition[]> };
        }
        let mergedSchema: Record<string, ColumnDefinition[]> = {};
        try {
            const runtimeId = runtimeIdOverride || (await ensureConnection(connId));
            const res = await window.desktopAPI.listSchema({ connId: runtimeId, database: safeDb });
            const schemaMap: Record<string, Record<string, ColumnDefinition[]>> = (res as any).schema || {};

            if (safeDb) {
                const incoming = (res.databases && res.databases[0]) || { name: safeDb, tables: [], views: [] };
                setConnections((prev) =>
                    prev.map((c) => {
                        if (c.id !== connId) return c;
                        const prevDb = c.databases.find((d) => d.name === incoming.name || d.id === incoming.id);
                        const prevTables = prevDb?.tables || [];
                        const prevViews = prevDb?.views || [];
                        const mergedTables = Array.isArray(incoming.tables) && incoming.tables.length ? incoming.tables : prevTables;
                        const mergedViews = Array.isArray(incoming.views) && incoming.views.length ? incoming.views : prevViews;
                        const updated = c.databases.map((d) =>
                            d.name === incoming.name || d.id === incoming.id
                                ? {
                                      ...d,
                                      ...incoming,
                                      tables: mergedTables,
                                      views: mergedViews,
                                      expanded: true,
                                      tablesExpanded: true,
                                      viewsExpanded: true,
                                      loaded: true
                                  }
                                : d
                        );
                        if (!updated.find((d) => d.name === incoming.name || d.id === incoming.id)) {
                            updated.push({
                                id: incoming.id || `db-${Date.now()}`,
                                name: incoming.name,
                                expanded: true,
                                tablesExpanded: true,
                                viewsExpanded: true,
                                tables: Array.isArray(incoming.tables) ? incoming.tables : [],
                                views: Array.isArray(incoming.views) ? incoming.views : [],
                                loaded: true
                            });
                        }
                        return { ...c, databases: updated, status: 'connected' };
                    })
                );
            } else {
                setConnections((prev) => {
                    const prevConn = prev.find((c) => c.id === connId);
                    let databases = (res.databases || []).map((d) => {
                        const prevDb = prevConn?.databases.find((p) => p.name === d.name || p.id === d.id);
                        const prevTables = prevDb?.tables || [];
                        const prevViews = prevDb?.views || [];
                        const tablesFromSchema = schemaMap && schemaMap[d.name] ? Object.keys(schemaMap[d.name]) : [];
                        return {
                            ...d,
                            tables: Array.isArray(d.tables) && d.tables.length ? d.tables : tablesFromSchema.length ? tablesFromSchema : prevTables,
                            views: Array.isArray(d.views) && d.views.length ? d.views : prevViews,
                            expanded: d.expanded ?? false,
                            tablesExpanded: d.tablesExpanded ?? false,
                            viewsExpanded: d.viewsExpanded ?? false,
                            loaded: false
                        };
                    });
                    if ((!databases || databases.length === 0) && schemaMap && Object.keys(schemaMap).length) {
                        databases = Object.keys(schemaMap).map((dbName) => {
                            const prevDb = prevConn?.databases.find((p) => p.name === dbName);
                            const prevTables = prevDb?.tables || [];
                            const prevViews = prevDb?.views || [];
                            return {
                                id: `db-${dbName}`,
                                name: dbName,
                                expanded: true,
                                tablesExpanded: true,
                                viewsExpanded: false,
                                tables: Object.keys(schemaMap[dbName] || {}) || prevTables,
                                views: prevViews,
                                loaded: false
                            };
                        });
                    }
                    const nextConns = prev.map((c) => (c.id === connId ? { ...c, databases, status: 'connected' } : c));
                    if (databases.length) {
                        setActiveConnId(connId);
                        setActiveDbName(databases[0].name);
                    }
                    return nextConns;
                });
            }
            if (schemaMap && Object.keys(schemaMap).length) {
                const merged: Record<string, ColumnDefinition[]> = {};
                Object.entries(schemaMap).forEach(([dbNameKey, db]) => {
                    Object.entries(db).forEach(([tableName, cols]) => {
                        merged[tableName] = cols as ColumnDefinition[];
                        merged[`${dbNameKey}.${tableName}`] = cols as ColumnDefinition[];
                    });
                });
                if (Object.keys(merged).length) {
                    mergedSchema = merged;
                    setMockSchema((prev) => ({ ...prev, ...merged }));
                }
            }
        } catch (e: any) {
            showToast(`加载库结构失败: ${e?.message || e}`, 'error');
        }
        return { schema: mergedSchema };
    };

    const runSql = async (connId: string | null | undefined, dbName: string | null | undefined, sql: string) => {
        if (window.desktopAPI && connId) {
            try {
                const runtimeId = await ensureConnection(connId);
                const res = await window.desktopAPI.runQuery({ connId: runtimeId, sql, database: dbName || undefined });
                setLastQueryContext({ sql, db: dbName || null, connId, error: res.error || null, rows: res.rows || [], headers: res.headers || [] });
                if (res.error) return { headers: res.headers || [], rows: res.rows || [], error: res.error };
                return { headers: res.headers || [], rows: res.rows || [], error: undefined };
            } catch (e: any) {
                setLastQueryContext({ sql, db: dbName || null, connId, error: e?.message || String(e), rows: [], headers: [] });
                return { headers: [], rows: [], error: e?.message || String(e) };
            }
        }
        setLastQueryContext({ sql, db: dbName || null, connId: connId || null, error: '缺少 desktopAPI 或连接信息，无法执行真实查询', rows: [], headers: [] });
        return { headers: [], rows: [], error: '缺少 desktopAPI 或连接信息，无法执行真实查询' };
    };

    const buildCreateTableSql = (tableName: string, columns: ColumnDefinition[]) => {
        const cols = columns
            .map((c) => {
                const len = c.length ? `(${c.length}${c.decimal ? `,${c.decimal}` : ''})` : '';
                const notNull = c.notNull ? 'NOT NULL' : '';
                return `\`${c.name}\` ${c.type}${len} ${notNull}`.trim();
            })
            .join(', ');
        return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${cols});`;
    };

    useEffect(() => {
        const closeMenu = () => setContextMenu((p) => ({ ...p, visible: false }));
        if (contextMenu.visible) {
            document.addEventListener('click', closeMenu);
        }
        return () => document.removeEventListener('click', closeMenu);
    }, [contextMenu.visible]);

    useEffect(() => {
        const onError = (msg: any, src?: any, line?: any, col?: any, err?: any) => {
            const text = err?.message || msg?.toString?.() || 'Unknown error';
            setGlobalError(text);
            return false;
        };
        const onRejection = (e: PromiseRejectionEvent) => {
            setGlobalError(e.reason?.message || e.reason?.toString?.() || 'Unhandled rejection');
        };
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        };
    }, []);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as ConnectionNode[];
                setConnections(parsed);
                if (parsed.length) {
                    setActiveConnId(parsed[0].id);
                    setActiveDbName(parsed[0].databases?.[0]?.name || null);
                    setNewTableTarget({ connId: parsed[0].id, dbName: parsed[0].databases?.[0]?.name || null });
                }
            }
        } catch (e) {
            console.warn('load connections failed', e);
        }
        try {
            const rawAi = localStorage.getItem(AI_STORAGE_KEY);
            if (rawAi) {
                const parsed = JSON.parse(rawAi);
                setAiConfig((c) => ({ ...c, ...parsed }));
            }
        } catch (e) {
            console.warn('load ai config failed', e);
        }
        try {
            const rawProfile = localStorage.getItem(PROFILE_STORAGE_KEY);
            if (rawProfile) {
                const parsed = JSON.parse(rawProfile);
                setProfile((p) => ({ ...p, ...parsed }));
            }
        } catch (e) {
            console.warn('load profile failed', e);
        }
        try {
            const rawAccent = localStorage.getItem(ACCENT_STORAGE_KEY);
            if (rawAccent) setAccentColor(rawAccent);
        } catch (e) {
            console.warn('load accent failed', e);
        }
    }, []);

    useEffect(() => {
        if (!newTableTarget.connId && connections.length) {
            setNewTableTarget({ connId: connections[0].id, dbName: connections[0].databases?.[0]?.name || null });
        }
        if (!activeConnId && connections.length) {
            setActiveConnId(connections[0].id);
            setActiveDbName(connections[0].databases?.[0]?.name || null);
        }
        if (window.desktopAPI && activeConnId && connections.find((c) => c.id === activeConnId)?.databases?.length === 0) {
            const target = connections.find((c) => c.id === activeConnId);
            loadSchemaForConnection(activeConnId, undefined, target?.runtimeId);
        }
    }, [connections, newTableTarget.connId, activeConnId]);

    useEffect(() => {
        try {
            const toSave = connections.map((c) => ({
                ...c,
                runtimeId: null,
                status: 'idle' as const,
                lastError: undefined
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        } catch (e) {
            console.warn('save connections failed', e);
        }
    }, [connections]);

    useEffect(() => {
        try {
            localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(aiConfig));
        } catch (e) {
            console.warn('save ai config failed', e);
        }
    }, [aiConfig]);

    useEffect(() => {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
        } catch (e) {
            console.warn('save theme failed', e);
        }
        document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }, [isDark]);

    useEffect(() => {
        try {
            localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
        } catch (e) {
            console.warn('save profile failed', e);
        }
    }, [profile]);

    useEffect(() => {
        if (!showConnMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (connMenuRef.current && !connMenuRef.current.contains(e.target as Node)) {
                setShowConnMenu(false);
                setShowConnTypeMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showConnMenu]);

    useEffect(() => {
        try {
            localStorage.setItem(ACCENT_STORAGE_KEY, accentColor);
        } catch (e) {
            console.warn('save accent failed', e);
        }
        document.documentElement.style.setProperty('--accent-color', accentColor);
    }, [accentColor]);

    const openNewTableModal = (connId?: string, dbName?: string) => {
        if (!connections.length) {
            showToast('请先新增连接', 'error');
            return;
        }
        const fallbackConn = connId || connections[0]?.id || null;
        const fallbackDb =
            dbName ||
            connections.find((c) => c.id === fallbackConn)?.databases?.[0]?.name ||
            connections[0]?.databases?.[0]?.name ||
            null;
        setNewTableTarget({ connId: fallbackConn, dbName: fallbackDb });
        setTableForm({ name: '', columns: [defaultColumn()] });
        setTableAiPrompt('');
        setModals((m) => ({ ...m, newTable: true }));
    };

const handleSaveConnection = async () => {
        if (!newConnForm.name.trim() || !newConnForm.host.trim()) {
            showToast('请填写连接名称和主机', 'error');
            return;
        }
        const connId = newConnForm['id'] || `conn-${Date.now()}`;
        const dbName = '';
        const newConn: ConnectionNode = {
            id: connId,
            name: newConnForm.name.trim(),
            type: newConnForm.type,
            host: `${newConnForm.host}:${newConnForm.port || DEFAULT_PORT[newConnForm.type]}`,
            config: { name: newConnForm.name.trim(), type: newConnForm.type, host: newConnForm.host, port: newConnForm.port, user: newConnForm.user, password: newConnForm.password },
            expanded: true,
            databases: newConnForm['databases'] || []
        };
        setConnections((prev) => {
            const exists = prev.find((c) => c.id === connId);
            if (exists) {
                return prev.map((c) => (c.id === connId ? { ...newConn } : c));
            }
            return [...prev, newConn];
        });
        setModals((m) => ({ ...m, newConn: false }));
        setNewConnForm({ name: '新连接', type: 'mysql', host: 'localhost', port: DEFAULT_PORT.mysql, user: 'root', password: '', database: '' });
        setActiveConnId(connId);
        setActiveDbName(null);
        showToast('已新增连接', 'success');
        if (window.desktopAPI) {
            try {
                await loadSchemaForConnection(connId, undefined, newConn.runtimeId);
            } catch (e) {
                // 已有 toast 提示
            }
        }
    };

    const fetchColumnsForChat = async (table: string): Promise<ColumnDefinition[]> => {
        const key = activeDbName ? `${activeDbName}.${table}` : table;
        const cached = mockSchema[key] || mockSchema[table];
        if (cached && cached.length) return cached;
        const conn = connections.find((c) => c.id === activeConnId);
        if (!conn || !activeConnId) return [];
        if (!window.desktopAPI) return [];
        const guesses = [
            `DESCRIBE \`${table}\``,
            `SHOW FULL COLUMNS FROM \`${table}\``,
            activeDbName
                ? `SELECT column_name AS Field, data_type AS Type, is_nullable AS \`Null\`, column_default AS \`Default\`, column_key AS \`Key\`
                   FROM information_schema.columns
                   WHERE table_schema='${activeDbName}' AND table_name='${table}'`
                : null
        ].filter(Boolean) as string[];
        for (const sql of guesses) {
            try {
                const res = await runSql(activeConnId, activeDbName, sql);
                if (!res.error && res.rows?.length) {
                    const cols = res.rows.map((r: any) => {
                        const rawType = r.Type || r.type || '';
                        const lenMatch = String(rawType).match(/\((\d+)(?:,(\d+))?\)/);
                        const length = lenMatch && lenMatch[1] ? Number(lenMatch[1]) : undefined;
                        const decimal = lenMatch && lenMatch[2] ? Number(lenMatch[2]) : undefined;
                        const baseType = String(rawType).split('(')[0]?.toUpperCase() || 'VARCHAR';
                        return {
                            name: r.Field || r.column_name || '',
                            type: baseType,
                            length,
                            decimal,
                            notNull: String(r.Null || r.is_nullable || '').toUpperCase() === 'NO',
                            virtual: false,
                            isKey: String(r.Key || r.column_key || '').toUpperCase().includes('PRI'),
                            comment: r.Comment || r.comment || ''
                        } as ColumnDefinition;
                    });
                    setMockSchema((prev) => ({ ...prev, [table]: cols, [key]: cols }));
                    return cols;
                }
            } catch (e) {
                // ignore and try next
            }
        }
        return [];
    };

    const handleInsertSqlSnippet = (sql: string) => {
        const setter = activeTabId ? tabQuerySetters.current[activeTabId] : undefined;
        if (!setter) {
            showToast('请先打开一个查询标签页', 'error');
            return;
        }
        setter(sql, 'append');
        setActiveActivity('database');
        messageApi.success('已插入到编辑器');
    };

    const handleChatSend = async (override?: string) => {
        const rawInput = typeof override === 'string' ? override : chatInput || '';
        const userText = rawInput.trim();
        if (!userText) return;
        const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: userText, timestamp: Date.now() };
        setChatHistory((prev) => [...prev, userMsg]);
        setChatInput('');
        setIsChatThinking(true);
        setTimeout(() => chatScrollRef.current?.scrollTo(0, chatScrollRef.current.scrollHeight), 50);
        try {
            const currentConn = connections.find((c) => c.id === activeConnId);
            const currentDb = currentConn?.databases.find((d) => d.name === activeDbName);
            const dbTables = currentDb?.tables || [];
            const targetTables = chatSelectedTables.length ? chatSelectedTables : dbTables;
            const resolveSchemaLines = async (tables: string[]) => {
                const lines: string[] = [];
                for (const t of tables) {
                    const cols = await fetchColumnsForChat(t);
                    if (cols && cols.length) {
                        lines.push(`表 ${t}: ${cols.map((c) => `${c.name} ${c.type}${c.notNull ? ' NOT NULL' : ''}`).join('; ')}`);
                    } else {
                        lines.push(`表 ${t}: 未获取到字段`);
                    }
                }
                return lines.join('\n');
            };
            const tablesForSchema = targetTables.length ? targetTables : dbTables;
            const schemaDetail = tablesForSchema.length ? await resolveSchemaLines(tablesForSchema) : '';
            const tableScope = targetTables.length ? targetTables.join(', ') : '当前库全部表';
            const lastCtx = lastQueryContext.sql
                ? `最近一次查询: ${lastQueryContext.sql}，数据库: ${lastQueryContext.db || '未指定'}，错误: ${lastQueryContext.error || '无错误'}`
                : '最近无查询上下文';
            const chartHint =
                chatChartIntent === 'none'
                    ? ''
                    : `\n【图表需求】请同时返回 ECharts 配置 JSON（包含 series/xAxis/yAxis/tooltip），尽量输出 ${chatChartIntent === 'auto' ? '合适的' : chatChartIntent} 图类型。`;
            const systemPrompt = `你是数据库助手，支持：1) 纯文本问答；2) 生成/解释 SQL；3) 诊断和优化最近查询；4) 基于当前库表提供建议；5) 如用户要求生成图表，输出 ECharts 配置 JSON（包含 series/xAxis/yAxis/tooltip）。当前连接: ${activeConnId || '未选'}, 数据库: ${activeDbName || '未选'}, 选择表: ${tableScope}。已知表结构如下：\n${schemaDetail || '无'}\n${lastCtx}。回答时优先给出清晰、短的建议。${chartHint}`;
            const sendText = chatChartIntent === 'none' ? userText : `${userText}\n\n${chartHint}`;
            if (aiConfig.provider === 'google') {
                if (!aiClient) throw new Error('未填写 AI Key');
                const response = await aiClient.models.generateContent({
                    model: aiConfig.model,
                    contents: [
                        { role: 'user', parts: [{ text: sendText }] },
                        { role: 'model', parts: [{ text: '' }] }
                    ],
                    config: { systemInstruction: systemPrompt, temperature: aiConfig.temperature }
                });
                const modelMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: response.text || 'No response', timestamp: Date.now() };
                const option = extractChartOption(response.text || '');
                if (option) setChartOptions((p) => ({ ...p, [modelMsg.id]: option }));
                setChatHistory((prev) => [...prev, modelMsg]);
                if (!option && chatChartIntent !== 'none') {
                    const sqlSnippet = extractSqlSnippetFromText(response.text || '');
                    if (sqlSnippet) {
                        const res = await runSql(activeConnId, activeDbName, sqlSnippet);
                        if (!res.error) {
                            const built = buildChartOptionFromResult(res.headers || [], res.rows || [], chatChartIntent === 'none' ? 'auto' : chatChartIntent);
                            if (built) setChartOptions((p) => ({ ...p, [modelMsg.id]: built }));
                        }
                    }
                }
            } else {
                const baseUrl =
                    aiConfig.baseUrl ||
                    (aiConfig.provider === 'openai'
                        ? 'https://api.openai.com/v1'
                        : aiConfig.provider === 'deepseek'
                        ? 'https://api.deepseek.com/v1'
                        : 'http://localhost:11434/v1');
                if (!aiConfig.apiKey && aiConfig.provider !== 'ollama') throw new Error('未填写 API Key');
                const resp = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(aiConfig.provider === 'ollama' ? {} : { Authorization: `Bearer ${aiConfig.apiKey}` })
                    },
                    body: JSON.stringify({
                        model: aiConfig.model,
                        temperature: aiConfig.temperature,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: sendText }
                        ]
                    })
                });
                if (!resp.ok) throw new Error(`AI 调用失败: ${resp.status}`);
                const data = await resp.json();
                const text =
                    data.choices?.[0]?.message?.content ||
                    data.choices?.[0]?.text ||
                    data.output ||
                    '';
                const modelMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: text || 'No response', timestamp: Date.now() };
                const option = extractChartOption(text || '');
                if (option) setChartOptions((p) => ({ ...p, [modelMsg.id]: option }));
                setChatHistory((prev) => [...prev, modelMsg]);
                if (!option && chatChartIntent !== 'none') {
                    const sqlSnippet = extractSqlSnippetFromText(text || '');
                    if (sqlSnippet) {
                        const res = await runSql(activeConnId, activeDbName, sqlSnippet);
                        if (!res.error) {
                            const built = buildChartOptionFromResult(res.headers || [], res.rows || [], chatChartIntent === 'none' ? 'auto' : chatChartIntent);
                            if (built) setChartOptions((p) => ({ ...p, [modelMsg.id]: built }));
                        }
                    }
                }
            }
        } catch (e: any) {
            const errorMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: `Error: ${e?.message || e}`, timestamp: Date.now() };
            setChatHistory((prev) => [...prev, errorMsg]);
        } finally {
            setIsChatThinking(false);
            setTimeout(() => chatScrollRef.current?.scrollTo(0, chatScrollRef.current.scrollHeight), 50);
        }
    };

    const toggleNode = (nodeId: string, type: 'conn' | 'db' | 'tables' | 'views') => {
        setConnections((prev) =>
            prev.map((conn) => {
                if (type === 'conn' && conn.id === nodeId) {
                    const nextExpanded = !conn.expanded;
                    if (nextExpanded && window.desktopAPI) {
                        loadSchemaForConnection(nodeId, undefined, conn.runtimeId);
                    }
                    return { ...conn, expanded: nextExpanded };
                }
                if (conn.databases) {
                    const newDbs = conn.databases.map((db) => {
                        if (type === 'db' && db.id === nodeId) {
                            const next = !db.expanded;
                            if (next && window.desktopAPI && !db.loaded) loadSchemaForConnection(conn.id, db.name, conn.runtimeId);
                            return { ...db, expanded: next };
                        }
                        if (db.id === nodeId && type === 'tables') return { ...db, tablesExpanded: !db.tablesExpanded };
                        if (db.id === nodeId && type === 'views') return { ...db, viewsExpanded: !db.viewsExpanded };
                        return db;
                    });
                    return { ...conn, databases: newDbs };
                }
                return conn;
            })
        );
    };

    return (
        <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: accentColor } }}>
            <div className={`flex h-screen w-screen overflow-hidden font-sans relative ${isDark ? 'bg-[#1e1e1e] text-gray-300' : 'bg-white text-slate-800'}`}>
                {contextHolder}
                <div className={`w-[50px] flex flex-col items-center py-4 border-r flex-shrink-0 z-20 ${isDark ? 'bg-[#252526] border-[#1e1e1e]' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
                    <div className="flex flex-col gap-6 w-full items-center">
                        <button onClick={() => setIsLeftCollapsed((v) => !v)} className={`p-2 rounded-lg transition-all ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-slate-500 hover:text-slate-700'}`} title="Toggle Connections">
                            <PanelLeft size={22} strokeWidth={1.5} />
                        </button>
                    </div>
                    <div className="mt-auto flex flex-col gap-6 w-full items-center mb-2">
                        <button className={`${isDark ? 'text-gray-500 hover:text-white' : 'text-slate-500 hover:text-slate-800'} p-2`} onClick={() => setModals((m) => ({ ...m, settings: true }))}>
                            <Settings size={22} strokeWidth={1.5} />
                        </button>
                        {profile.avatar ? (
                            <img src={profile.avatar} alt="avatar" className="w-8 h-8 rounded-full object-cover border border-white/20" />
                        ) : (
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isDark ? 'bg-blue-900 text-blue-200' : 'bg-blue-100 text-blue-700'}`}>
                                {(profile.name || 'JS').slice(0, 2).toUpperCase()}
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ width: isLeftCollapsed ? 0 : leftSidebarWidth }} className={`flex flex-col flex-shrink-0 relative transition-all duration-200 ${isDark ? 'bg-[#1e1e1e] border-r border-[#1e1e1e]' : 'bg-white border-r border-slate-200 text-slate-800'} ${isLeftCollapsed ? 'overflow-hidden' : ''}`}>
                    <div className={`h-10 flex items-center justify-between px-3 text-sm font-semibold tracking-wide ${isDark ? 'text-gray-300 bg-[#252526] border-b border-[#1e1e1e]' : 'text-slate-800 bg-slate-100 border-b border-slate-200'}`}>
                        <span>Connections</span>
                        <div className="flex items-center gap-1 relative" ref={connMenuRef}>
                            <button
                                className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-[#333] text-gray-400 hover:text-white' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'}`}
                                title="New"
                                onClick={() => setShowConnMenu((v) => !v)}
                            >
                                <Plus size={18} />
                            </button>
                            <button className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-[#333] text-gray-400 hover:text-white' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'}`} title="Collapse" onClick={() => setIsLeftCollapsed(true)}>
                                <ChevronLeft size={16} />
                            </button>
                            {showConnMenu && (
                                <div
                                    className={`absolute right-0 top-9 w-40 rounded-lg border shadow-xl z-30 ${isDark ? 'bg-[#1e1e1e] border-[#333]' : 'bg-white border-slate-200'}`}
                                    onMouseEnter={() => setShowConnMenu(true)}
                                >
                                    <button
                                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-blue-900/20 ${isDark ? 'text-gray-200 hover:text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                                        onClick={() => {
                                            setShowConnMenu(false);
                                            setShowConnTypeMenu(false);
                                            showToast('分组功能即将支持，敬请期待', 'info');
                                        }}
                                    >
                                        新建组
                                    </button>
                                    <div className={`relative border-t ${isDark ? 'border-[#333]' : 'border-slate-200'}`} onMouseEnter={() => setShowConnTypeMenu(true)}>
                                        <button
                                            className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${isDark ? 'text-gray-200 hover:bg-[#252526]' : 'text-slate-700 hover:bg-slate-100'}`}
                                            onClick={() => setShowConnTypeMenu((v) => !v)}
                                            onMouseEnter={() => setShowConnTypeMenu(true)}
                                        >
                                            <span>新建连接</span>
                                            <ChevronRight size={14} />
                                        </button>
                                        {showConnTypeMenu && (
                                            <div
                                                className={`absolute top-0 left-full ml-1 w-44 rounded-lg border shadow-xl z-40 ${isDark ? 'bg-[#1b1b1b] border-[#333]' : 'bg-white border-slate-200'}`}
                                                onMouseEnter={() => setShowConnTypeMenu(true)}
                                                onMouseLeave={() => setShowConnTypeMenu(false)}
                                            >
                                            {connProviders.map((item) => (
                                                <button
                                                    key={item.type}
                                                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left ${isDark ? 'text-gray-200 hover:bg-[#252525]' : 'text-slate-700 hover:bg-slate-100'}`}
                                                    onClick={() => {
                                                        setNewConnForm((f) => ({
                                                            ...f,
                                                            type: item.type,
                                                            port: DEFAULT_PORT[item.type],
                                                            host: 'localhost'
                                                        }));
                                                        setModals((m) => ({ ...m, newConn: true }));
                                                        setShowConnMenu(false);
                                                        setShowConnTypeMenu(false);
                                                    }}
                                                >
                                                    <i
                                                        className={`${item.icon} text-lg`}
                                                        style={{
                                                            color:
                                                                item.type === 'mysql'
                                                                    ? '#4479A1'
                                                                    : item.type === 'postgres'
                                                                    ? '#336791'
                                                                    : item.type === 'sqlserver'
                                                                    ? '#A91D22'
                                                                    : item.type === 'oracle'
                                                                    ? '#F80000'
                                                                    : '#D82C20'
                                                        }}
                                                    ></i>
                                                    <span>{item.label}</span>
                                                </button>
                                            ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto custom-scrollbar text-sm">
                        {connections.map((conn) => (
                            <div key={conn.id} className={`${isDark ? 'border-b border-[#1e1e1e]' : 'border-b border-slate-200'}`}>
                                <div
                                    className={`flex items-center justify-between px-3 py-2 cursor-pointer ${isDark ? 'hover:bg-[#252526]' : 'hover:bg-slate-100'}`}
                                    onClick={() => toggleNode(conn.id, 'conn')}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setContextMenu({ x: e.clientX, y: e.clientY, visible: true, type: 'conn', connId: conn.id });
                                    }}
                                >
                                    <div className={`flex items-center gap-2 ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
                                        <Server size={14} className="text-blue-400" />
                                        <span className="font-medium">{conn.name}</span>
                                        <span className={`text-[10px] px-2 py-0.5 rounded border ${isDark ? 'text-gray-400 bg-[#1e1e1e] border-[#333]' : 'text-slate-600 bg-slate-100 border-slate-200'}`}>{conn.type}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            className={`p-1 rounded ${isDark ? 'hover:bg-[#333] text-gray-400 hover:text-white' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'}`}
                                            title="新建数据库"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setNewDatabaseForm((f) => ({
                                                    ...f,
                                                    connId: conn.id,
                                                    name: '',
                                                    charset: 'utf8mb4',
                                                    collation: 'utf8mb4_unicode_ci'
                                                }));
                                                setModals((m) => ({ ...m, newDatabase: true }));
                                            }}
                                        >
                                            <Plus size={14} />
                                        </button>
                                        <button
                                            className={`p-1 rounded ${isDark ? 'hover:bg-[#333] text-gray-400 hover:text-white' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'}`}
                                            title="刷新数据库列表"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                loadSchemaForConnection(conn.id, undefined, conn.runtimeId);
                                            }}
                                        >
                                            <RefreshCw size={14} />
                                        </button>
                                        {conn.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </div>
                                </div>

                                {conn.expanded && (
                                    <div className="pl-4 pb-2">
                                        {conn.databases.map((db) => (
                                            <div key={db.id} className="mb-2">
                                                <div
                                                    className={`flex items-center justify-between px-2 py-1 cursor-pointer ${isDark ? 'hover:bg-[#2a2d2e]' : 'hover:bg-slate-100'}`}
                                                    onClick={() => {
                                                        toggleNode(db.id, 'db');
                                                        setActiveConnId(conn.id);
                                                        setActiveDbName(db.name);
                                                    }}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <Database size={12} className={db.loaded ? 'text-green-400' : 'text-gray-500'} />
                                                        <span>{db.name || '(未命名数据库)'}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            className={`p-1 rounded ${isDark ? 'hover:bg-[#333] text-gray-400 hover:text-white' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'}`}
                                                            title="新建表"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setActiveConnId(conn.id);
                                                                setActiveDbName(db.name);
                                                                setNewTableTarget({ connId: conn.id, dbName: db.name });
                                                                setModals((m) => ({ ...m, newTable: true }));
                                                            }}
                                                        >
                                                            <Plus size={12} />
                                                        </button>
                                                        <button
                                                            className={`p-1 rounded ${isDark ? 'hover:bg-[#333] text-gray-400 hover:text-white' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'}`}
                                                            title="刷新当前库结构"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                loadSchemaForConnection(conn.id, db.name, conn.runtimeId);
                                                            }}
                                                        >
                                                            <RefreshCw size={12} />
                                                        </button>
                                                        {db.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                    </div>
                                                </div>
                                                {db.expanded && (
                                                    <div className="ml-3">
                                                        <div className={`flex items-center gap-1 text-xs px-2 py-1 uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>Tables</div>
                                                        {(db.tables?.length ? db.tables : ['(空)']).map((t) => (
                                                            <div
                                                                key={t}
                                                                className={`flex items-center gap-2 ml-4 px-2 py-1 cursor-pointer text-xs ${isDark ? 'text-gray-400 hover:text-blue-300 hover:bg-[#2a2d2e]' : 'text-slate-600 hover:text-blue-600 hover:bg-slate-100'}`}
                                                                onClick={(e) => {
                                                                    if (t === '(空)') return;
                                                                    setActiveConnId(conn.id);
                                                                    setActiveDbName(db.name);
                                                                    handleTableClick(t, conn.id, db.name, e as any);
                                                                }}
                                                                onContextMenu={(e) => {
                                                                    if (t === '(空)') return;
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    setContextMenu({ x: e.clientX, y: e.clientY, visible: true, table: t, type: 'table', connId: conn.id, dbName: db.name });
                                                                }}
                                                            >
                                                                <Table size={12} className={db.loaded ? 'text-blue-400' : 'text-gray-500'} />
                                                                {t}
                                                            </div>
                                                        ))}
                                                        {db.views && db.views.length > 0 && (
                                                            <>
                                                                <div className={`flex items-center gap-1 text-xs px-2 py-1 uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>Views</div>
                                                                {db.views.map((v) => (
                                                                    <div
                                                                        key={v}
                                                                        className={`flex items-center gap-2 ml-4 px-2 py-1 cursor-pointer text-xs ${isDark ? 'text-gray-400 hover:text-blue-300 hover:bg-[#2a2d2e]' : 'text-slate-600 hover:text-blue-600 hover:bg-slate-100'}`}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setActiveConnId(conn.id);
                                                                            setActiveDbName(db.name);
                                                                            handleTableClick(v, conn.id, db.name, e as any);
                                                                        }}
                                                                    >
                                                                        <Table size={12} className="text-green-300" />
                                                                        {v}
                                                                    </div>
                                                                ))}
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {!isLeftCollapsed && (
                        <div className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 z-10 opacity-0 hover:opacity-100 transition-opacity">
                            <Resizer onResize={handleResizeLeft} />
                        </div>
                    )}
                </div>

                <div className={`flex-1 flex flex-col min-w-0 relative ${isDark ? 'bg-[#1e1e1e]' : 'bg-white'}`}>
                    {tabs.length > 0 ? (
                        <div className={`flex items-center h-9 border-b overflow-x-auto custom-scrollbar-hide ${isDark ? 'bg-[#252526] border-[#1e1e1e]' : 'bg-slate-100 border-slate-200'}`}>
                            {tabs.map((tab) => (
                                <div
                                    key={tab.id}
                                    onClick={() => setActiveTabId(tab.id)}
                                    className={`group flex items-center gap-2 px-3 h-full min-w-[120px] max-w-[200px] text-xs cursor-pointer border-r select-none ${isDark ? 'border-[#1e1e1e]' : 'border-slate-200'} ${activeTabId === tab.id ? (isDark ? 'bg-[#1e1e1e] text-blue-400 border-t-2 border-t-blue-500' : 'bg-white text-blue-600 border-t-2 border-t-blue-500') : isDark ? 'text-gray-500 hover:bg-[#2d2d30]' : 'text-slate-600 hover:bg-slate-100'}`}
                                >
                                    <LayoutGrid size={12} className={activeTabId === tab.id ? 'text-blue-400' : isDark ? 'text-gray-500' : 'text-slate-500'} />
                                    <span className="truncate flex-1">{tab.title}</span>
                                    <button onClick={(e) => closeTab(tab.id, e)} className={`p-0.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-white/20 ${activeTabId === tab.id ? 'text-gray-300' : ''}`}>
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                            <button onClick={() => createTab()} className={`px-3 h-full transition-colors ${isDark ? 'text-gray-500 hover:text-white hover:bg-[#333]' : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'}`}>
                                <Plus size={14} />
                            </button>
                        </div>
                    ) : null}

            <div className={`flex-1 relative overflow-hidden ${isDark ? 'bg-[#1e1e1e]' : 'bg-white'}`}>
                {tabs.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 z-0">
                        <div className={`w-24 h-24 rounded-2xl flex items-center justify-center mb-6 shadow-2xl ring-1 ${isDark ? 'bg-[#252526] ring-[#333]' : 'bg-slate-100 ring-slate-200'}`}>
                            <Database size={48} className={isDark ? 'text-blue-500' : 'text-blue-600'} />
                        </div>
                        <h1 className="text-4xl font-bold text-gray-200 mb-2 tracking-tight">SQLSense</h1>
                        <p className="text-gray-500 text-sm mb-12">AI 驱动的数据库管理工具</p>

                        <div className="grid grid-cols-2 gap-x-12 gap-y-4 text-xs">
                            <div className="flex items-center justify-between w-48 group cursor-pointer hover:text-gray-300 transition-colors" onClick={() => createTab()}>
                            <span className="flex items-center gap-2">
                                <LayoutGrid size={14} /> 执行 SQL
                            </span>
                                <span className={`font-mono px-1.5 py-0.5 rounded border ${isDark ? 'bg-[#252526] border-[#333] text-gray-200' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>Ctrl + R</span>
                            </div>
                            <div className="flex items-center justify-between w-48 group cursor-pointer hover:text-gray-300 transition-colors">
                            <span className="flex items-center gap-2">
                                <Save size={14} /> 保存控制台
                            </span>
                                <span className={`font-mono px-1.5 py-0.5 rounded border ${isDark ? 'bg-[#252526] border-[#333] text-gray-200' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>Ctrl + S</span>
                            </div>
                            <div className="flex items-center justify-between w-48 group cursor-pointer hover:text-gray-300 transition-colors" onClick={() => createTab()}>
                            <span className="flex items-center gap-2">
                                <Plus size={14} /> 新建控制台
                            </span>
                                <span className={`font-mono px-1.5 py-0.5 rounded border ${isDark ? 'bg-[#252526] border-[#333] text-gray-200' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>Ctrl + T</span>
                            </div>
                            <div className="flex items-center justify-between w-48 group cursor-pointer hover:text-gray-300 transition-colors" onClick={() => handleDbAskAi('帮我写一个SQL')}>
                            <span className="flex items-center gap-2">
                                <Wand2 size={14} /> AI 文本转 SQL
                            </span>
                                <span className={`font-mono px-1.5 py-0.5 rounded border ${isDark ? 'bg-[#252526] border-[#333] text-gray-200' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>/</span>
                            </div>
                        </div>

                        <button onClick={() => createTab()} className={`mt-12 px-6 py-2.5 rounded-lg text-sm transition-all flex items-center gap-2 shadow-lg border ${isDark ? 'bg-[#252526] hover:bg-[#333] border-[#333] text-gray-200' : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'}`}>
                            <Sparkles size={14} className={isDark ? 'text-yellow-500' : 'text-yellow-600'} />
                            开始新的查询控制台
                        </button>
                            </div>
                        ) : (
                            tabs.map((tab) => (
                            <ConsoleTab
                                key={tab.id}
                                tabId={tab.id}
                                isActive={activeTabId === tab.id}
                                initialQuery={tab.initialQuery || ''}
                                ai={aiClient}
                                aiConfig={aiConfig}
                                activeConnId={activeConnId}
                                activeDbName={activeDbName}
                                activeTableName={activeTableName}
                                connections={connections}
                                schemaColumns={mockSchema}
                                isDark={isDark}
                                onOpenRightPanel={() => setShowRightSidebar(true)}
                                onRunQuery={(sql) => runSql(tab.connId ?? activeConnId, tab.dbName ?? activeDbName, sql)}
                                onChangeConn={handleActiveConnChange}
                                onChangeDb={handleActiveDbChange}
                                onChangeTable={(table) => setActiveTableName(table)}
                                onRegisterQuerySetter={registerTabQuerySetter}
                                onUnregisterQuerySetter={unregisterTabQuerySetter}
                            />
                        ))
                )}
                    </div>

                    {!showRightSidebar && tabs.length > 0 && (
                        <button
                            onClick={() => setShowRightSidebar(true)}
                            className={`absolute top-2 right-4 z-20 p-2 rounded-full shadow-xl hover:scale-105 transition-all border ${isDark ? 'bg-[#252526] border-[#333] text-blue-300 hover:text-blue-200' : 'bg-white border-slate-200 text-blue-600 hover:text-blue-700'}`}
                            title="Open AI Chat"
                        >
                            <MessageSquare size={20} />
                        </button>
                    )}
                </div>

                <div style={{ width: showRightSidebar ? rightSidebarWidth : 0 }} className={`flex flex-col flex-shrink-0 relative transition-all duration-300 ${isDark ? 'bg-[#1e1e1e] border-l border-[#1e1e1e]' : 'bg-white border-l border-slate-200'} ${!showRightSidebar ? 'overflow-hidden' : ''}`}>
                    <div className="absolute top-0 left-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 z-10">
                        <Resizer onResize={handleResizeRight} />
                    </div>

                    <div className={`h-10 flex items-center justify-between px-4 border-b ${isDark ? 'bg-[#252526] border-[#1e1e1e]' : 'bg-slate-100 border-slate-200'}`}>
                        <div className={`flex items-center gap-2 font-medium text-sm ${isDark ? 'text-gray-300' : 'text-slate-800'}`}>
                            <Sparkles size={14} className="text-purple-400" />
                            AI Assistant
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setChatHistory([])} className={`p-1 rounded ${isDark ? 'hover:bg-[#333] text-gray-500' : 'hover:bg-slate-200 text-slate-600'}`} title="Clear History">
                                <Eraser size={14} />
                            </button>
                            <button onClick={() => setShowRightSidebar(false)} className={`p-1 rounded ${isDark ? 'hover:bg-[#333] text-gray-500' : 'hover:bg-slate-200 text-slate-600'}`}>
                                <X size={14} />
                            </button>
                        </div>
                    </div>

                    <div className={`flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar ${isDark ? 'bg-[#1e1e1e]' : 'bg-white'}`} ref={chatScrollRef}>
                                    {chatHistory.map((msg) => {
                                        const chartOpt = chartOptions[msg.id];
                                        const sqlFence = msg.role === 'model' ? msg.text.match(/```sql([\s\S]*?)```/i) : null;
                                        const genericFence = msg.role === 'model' && !sqlFence ? msg.text.match(/```([\s\S]*?)```/) : null;
                                        const candidateSnippet = msg.role === 'model' ? (sqlFence?.[1] || genericFence?.[1] || '').trim() : '';
                                        const sqlSnippet =
                                            candidateSnippet && (sqlFence || /^\s*(select|insert|update|delete|with|create|alter|drop)/i.test(candidateSnippet))
                                                ? candidateSnippet
                                                : '';
                                        const cleanedText = msg.text.replace(/```[\s\S]*?```/g, '').trim();
                                        return (
                                            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'model' ? (isDark ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700') : isDark ? 'bg-gray-700 text-gray-300' : 'bg-slate-200 text-slate-700'}`}>
                                                    {msg.role === 'model' ? <Sparkles size={14} /> : <MessageSquare size={14} />}
                                                </div>
                                                <div className={`max-w-[85%] rounded-lg p-3 text-sm leading-relaxed space-y-2 ${msg.role === 'model' ? (isDark ? 'bg-[#252526] text-gray-300 border border-[#333]' : 'bg-slate-50 text-slate-800 border-slate-200') : isDark ? 'bg-blue-900/20 text-blue-100 border border-blue-900/30' : 'bg-blue-50 text-blue-800 border-blue-200'}`}>
                                                    {cleanedText && <div className="whitespace-pre-wrap">{cleanedText}</div>}
                                                    {sqlSnippet && (
                                                        <div className={`border rounded-md text-xs ${isDark ? 'border-[#333] bg-[#1b1b1b]' : 'border-slate-200 bg-white'} overflow-hidden`}>
                                                            <div className={`flex items-center justify-between px-2 py-1 ${isDark ? 'bg-[#111] text-gray-300 border-b border-[#333]' : 'bg-slate-100 text-slate-700 border-b border-slate-200'}`}>
                                                                <span className="font-semibold">AI SQL</span>
                                                                <button
                                                                    onClick={() => handleInsertSqlSnippet(sqlSnippet)}
                                                                    className={`flex items-center gap-1 px-2 py-1 rounded ${isDark ? 'bg-blue-900/40 text-blue-200 hover:bg-blue-800/60' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                                                                >
                                                                    <Play size={12} />
                                                                    <span>插入到编辑器</span>
                                                                </button>
                                                            </div>
                                                            <pre className={`m-0 p-2 whitespace-pre-wrap font-mono text-xs ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>{sqlSnippet}</pre>
                                                        </div>
                                                    )}
                                                    {chartOpt && <ChatChart option={chartOpt} isDark={isDark} ensureEcharts={ensureEcharts} />}
                                                </div>
                                            </div>
                                        );
                                    })}
                        {isChatThinking && (
                            <div className="flex gap-3">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center ${isDark ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
                                    <Sparkles size={14} className="animate-spin" />
                                </div>
                                <div className={`rounded-lg p-3 text-sm border ${isDark ? 'bg-[#252526] text-gray-400 border-[#333]' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>Thinking...</div>
                            </div>
                        )}
                    </div>

            <div className={`p-3 border-t ${isDark ? 'bg-[#252526] border-[#1e1e1e]' : 'bg-slate-100 border-slate-200'}`}>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs text-gray-500">选择表</span>
                            <Select
                                className="flex-1"
                                mode="multiple"
                                allowClear
                                size="small"
                                placeholder="多选表，留空则使用当前库全部表"
                                value={chatSelectedTables}
                                options={(connections.find((c) => c.id === activeConnId)?.databases.find((d) => d.name === activeDbName)?.tables || []).map((t) => ({
                                    label: t,
                                    value: t
                                }))}
                                onChange={(vals) => setChatSelectedTables(vals as string[])}
                                maxTagCount="responsive"
                            />
                        </div>
                        <div className="relative">
                        <textarea
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleChatSend();
                                }
                            }}
                            placeholder="Ask me anything about your data..."
                            className={`w-full text-sm rounded-lg p-3 pr-10 resize-none outline-none border focus:border-blue-500 transition-colors h-20 custom-scrollbar ${isDark ? 'bg-[#1e1e1e] text-gray-200 border-[#333]' : 'bg-white text-slate-800 border-slate-300'}`}
                        />
                            <button onClick={handleChatSend} disabled={!chatInput.trim() || isChatThinking} className="absolute bottom-2 right-2 p-1.5 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
                                发送
                            </button>
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-xs">
                            <span className="text-gray-500">工具</span>
                            <Select
                                size="small"
                                value={chatChartIntent}
                                style={{ width: 180 }}
                                onChange={(val) => setChatChartIntent(val as any)}
                                options={[
                                    { label: '无', value: 'none' },
                                    { label: '自动图表', value: 'auto' },
                                    { label: '折线图', value: 'line' },
                                    { label: '柱状图', value: 'bar' },
                                    { label: '饼图', value: 'pie' }
                                ]}
                            />
                            <span className="text-gray-400">选择图表类型后，会要求 AI 返回 ECharts 配置并自动展示图表</span>
                        </div>
                    </div>
                </div>

            {contextMenu.visible && contextMenu.type === 'table' && (
                <div
                    className={`fixed z-[120] py-1 rounded-lg border shadow-xl w-48 text-sm animate-fade-in ${
                        isDark ? 'bg-[#1b1b1b] border-[#2f2f2f] text-slate-100 shadow-[0_12px_30px_rgba(0,0,0,0.45)]' : 'bg-white border-slate-200 text-slate-800 shadow-lg'
                    }`}
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <button
                        className={`w-full text-left px-4 py-2 flex items-center gap-2 transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
                        onClick={() => contextMenu.table && handleOpenDesign(contextMenu.table!, contextMenu.dbName, contextMenu.connId)}
                    >
                        <Table size={14} /> 设计表结构
                    </button>
                    <button
                        className={`w-full text-left px-4 py-2 flex items-center gap-2 transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
                        onClick={() => setModals((m) => ({ ...m, erDiagram: true }))}
                    >
                        <LayoutGrid size={14} /> 生成 ER 图
                    </button>
                    <button
                        className={`w-full text-left px-4 py-2 flex items-center gap-2 transition-colors text-red-400 ${isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
                        onClick={() => contextMenu.table && handleDeleteTable(contextMenu.table!, contextMenu.dbName, contextMenu.connId)}
                    >
                        <Trash2 size={14} /> 删除表
                    </button>
                </div>
            )}

                {contextMenu.visible && contextMenu.type === 'conn' && (
                    <div
                        className={`fixed z-[120] py-1 rounded-lg border shadow-xl w-48 text-sm animate-fade-in ${
                            isDark ? 'bg-[#1b1b1b] border-[#2f2f2f] text-slate-100 shadow-[0_12px_30px_rgba(0,0,0,0.45)]' : 'bg-white border-slate-200 text-slate-800 shadow-lg'
                        }`}
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                    >
                        <button
                            className={`w-full text-left px-4 py-2 flex items-center gap-2 transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
                            onClick={() => {
                                const target = connections.find((c) => c.id === contextMenu.connId);
                                if (!target) return;
                                setNewConnForm({
                                    ...newConnForm,
                                    id: target.id,
                                    name: target.name,
                                    type: target.type,
                                    host: target.config?.host || target.host.split(':')[0],
                                    port: target.config?.port || Number(target.host.split(':')[1]) || DEFAULT_PORT[target.type],
                                    user: target.config?.user || '',
                                    password: target.config?.password || '',
                                    databases: target.databases
                                });
                                setModals((m) => ({ ...m, newConn: true }));
                                setContextMenu((p) => ({ ...p, visible: false }));
                            }}
                        >
                            <Settings size={14} /> 编辑连接
                        </button>
                        <button
                            className={`w-full text-left px-4 py-2 flex items-center gap-2 transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
                            onClick={() => {
                                const connId = contextMenu.connId;
                                if (!connId) return;
                                setConnections((prev) => prev.filter((c) => c.id !== connId));
                                setContextMenu((p) => ({ ...p, visible: false }));
                                if (activeConnId === connId) {
                                    setActiveConnId(connections[0]?.id || null);
                                    setActiveDbName(connections[0]?.databases?.[0]?.name || null);
                                }
                            }}
                        >
                            <Trash2 size={14} /> 删除连接
                        </button>
                    </div>
                )}

                <Modal
                    open={modals.newConn}
                    onCancel={() => setModals((m) => ({ ...m, newConn: false }))}
                    footer={
                        <div className="flex items-center justify-between gap-3">
                            <Button onClick={handleTestConnection} loading={isTestingConn}>
                                测试连接
                            </Button>
                            <div className="flex gap-2">
                                <Button onClick={() => setModals((m) => ({ ...m, newConn: false }))}>取消</Button>
                                <Button type="primary" onClick={handleSaveConnection}>
                                    保存
                                </Button>
                            </div>
                        </div>
                    }
                    styles={{}}
                    maskClosable={false}
                    width={520}
                    title={
                        <div className="flex items-center gap-2">
                            <Server className="text-blue-400" size={18} />
                            <span>新建连接</span>
                        </div>
                    }
                    zIndex={1450}
                >
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 p-2 rounded-lg border" style={{ borderColor: isDark ? '#333' : '#e2e8f0' }}>
                            {(() => {
                                const meta = getConnProvider(newConnForm.type);
                                const color =
                                    newConnForm.type === 'mysql'
                                        ? '#4479A1'
                                        : newConnForm.type === 'postgres'
                                        ? '#336791'
                                        : newConnForm.type === 'sqlserver'
                                        ? '#A91D22'
                                        : newConnForm.type === 'oracle'
                                        ? '#F80000'
                                        : '#D82C20';
                                return (
                                    <>
                                        <i className={`${meta?.icon} text-xl`} style={{ color }}></i>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-semibold">{meta?.label || newConnForm.type}</span>
                                            <span className="text-xs text-gray-500">已选择的数据库类型</span>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-20 text-sm">名称</span>
                            <Input value={newConnForm.name} onChange={(e) => setNewConnForm((f) => ({ ...f, name: e.target.value }))} placeholder="连接名称" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-20 text-sm">主机</span>
                            <Input value={newConnForm.host} onChange={(e) => setNewConnForm((f) => ({ ...f, host: e.target.value }))} placeholder="localhost 或 IP" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-20 text-sm">端口</span>
                            <Input type="number" value={newConnForm.port} onChange={(e) => setNewConnForm((f) => ({ ...f, port: Number(e.target.value) }))} />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-20 text-sm">用户</span>
                            <Input value={newConnForm.user} onChange={(e) => setNewConnForm((f) => ({ ...f, user: e.target.value }))} placeholder="root" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-20 text-sm">密码</span>
                            <Input.Password value={newConnForm.password} onChange={(e) => setNewConnForm((f) => ({ ...f, password: e.target.value }))} placeholder="可选" />
                        </div>
                    </div>
                </Modal>

                <Modal
                    open={modals.settings}
                    title={
                        <div className="flex items-center gap-2">
                            <Settings className="text-blue-400" size={18} />
                            <span>设置</span>
                        </div>
                    }
                    onCancel={() => setModals((m) => ({ ...m, settings: false }))}
                    onOk={() => {
                        setModals((m) => ({ ...m, settings: false }));
                        messageApi.success('设置已保存');
                    }}
                    okText="确定"
                    cancelText="取消"
                    maskClosable={false}
                    width={600}
                    zIndex={1500}
                >
                    <div className={`flex gap-4 ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
                        <div className={`w-40 flex flex-col gap-2 p-3 rounded-lg border ${isDark ? 'bg-[#0f172a] border-[#1f2937]' : 'bg-slate-50 border-slate-200'}`}>
                            {[
                                { key: 'profile', label: '个人设置' },
                                { key: 'theme', label: '主题' },
                                { key: 'model', label: '模型设置' }
                            ].map((item) => (
                                <button
                                    key={item.key}
                                    onClick={() => setSettingsTab(item.key as any)}
                                    className={`text-left px-3 py-2 rounded-md text-sm font-medium transition-all border ${
                                        settingsTab === item.key
                                            ? isDark
                                                ? 'bg-gradient-to-r from-blue-600/30 to-purple-600/30 text-blue-100 border-blue-500/60'
                                                : 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm'
                                            : isDark
                                            ? 'text-gray-300 border-transparent hover:border-[#2f2f2f] hover:bg-[#191919]'
                                            : 'text-slate-700 border-transparent hover:border-slate-200 hover:bg-slate-100'
                                    }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1">
                            {settingsTab === 'theme' && (
                                <div className="space-y-3">
                                    <div className="text-xs uppercase text-gray-400 mb-1">主题</div>
                                    <button
                                        onClick={() => setIsDark((v) => !v)}
                                        className={`px-3 py-2 rounded-lg border transition flex items-center gap-2 ${isDark ? 'bg-[#1e1e1e] text-gray-200 border-[#333] hover:border-blue-500/50 hover:bg-[#222]' : 'bg-white text-slate-800 border-slate-200 hover:border-blue-300 hover:shadow-sm'}`}
                                    >
                                        {isDark ? '切换为浅色模式' : '切换为深色模式'}
                                    </button>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs uppercase text-gray-400">主题色</span>
                                        <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-10 h-8 border border-slate-200 rounded" />
                                        <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-28" />
                                    </div>
                                </div>
                            )}

                            {settingsTab === 'model' && (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs uppercase text-gray-400 mb-2">模型提供者</div>
                                        <div className="flex gap-2 flex-wrap">
                                            {(['google', 'openai', 'deepseek', 'ollama'] as AiProvider[]).map((p) => (
                                                <button
                                                    key={p}
                                                    onClick={() => setAiConfig((c) => ({ ...c, provider: p, model: AI_DEFAULT_MODELS[p] }))}
                                                    className={`px-3 py-2 rounded-lg text-left transition-all border ${aiConfig.provider === p ? (isDark ? 'border-blue-500/60 bg-blue-900/40 text-blue-100 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]' : 'border-blue-300 bg-blue-50 text-blue-800 shadow-sm') : isDark ? 'border-[#2f2f2f] bg-[#161616] text-gray-200 hover:border-[#3d3d3d]' : 'border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:text-blue-700'}`}
                                                >
                                                    {p.toUpperCase()}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {aiConfig.provider !== 'google' && (
                                        <div className="space-y-2">
                                            <div className="text-xs uppercase text-gray-400">Base URL</div>
                                            <Input value={aiConfig.baseUrl} onChange={(e) => setAiConfig((c) => ({ ...c, baseUrl: e.target.value }))} placeholder={aiConfig.provider === 'openai' ? 'https://api.openai.com/v1' : aiConfig.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'http://localhost:11434/v1'} />
                                        </div>
                                    )}
                                    {aiConfig.provider !== 'ollama' && (
                                        <div className="space-y-2">
                                            <div className="text-xs uppercase text-gray-400">API Key</div>
                                            <Input.Password value={aiConfig.apiKey} onChange={(e) => setAiConfig((c) => ({ ...c, apiKey: e.target.value }))} placeholder="sk-..." />
                                        </div>
                                    )}
                                    <div className="space-y-2">
                                        <div className="text-xs uppercase text-gray-400">模型</div>
                                        <Input value={aiConfig.model} onChange={(e) => setAiConfig((c) => ({ ...c, model: e.target.value }))} placeholder="gemini-2.5-flash" />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="text-xs uppercase text-gray-400">Temperature: {aiConfig.temperature}</div>
                                        <input type="range" min="0" max="1" step="0.1" value={aiConfig.temperature} onChange={(e) => setAiConfig((c) => ({ ...c, temperature: parseFloat(e.target.value) }))} className="w-full" />
                                    </div>
                                </div>
                            )}

                            {settingsTab === 'profile' && (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        {profile.avatar ? (
                                            <img src={profile.avatar} alt="avatar" className="w-12 h-12 rounded-full object-cover border border-white/20" />
                                        ) : (
                                            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold ${isDark ? 'bg-blue-900 text-blue-200' : 'bg-blue-100 text-blue-700'}`}>
                                                {(profile.name || 'JS').slice(0, 2).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="text-xs text-gray-400">头像将显示在左侧侧栏</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="w-20 text-sm">昵称</span>
                                        <Input value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} placeholder="你的名字" />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="w-20 text-sm">头像 URL</span>
                                        <Input value={profile.avatar} onChange={(e) => setProfile((p) => ({ ...p, avatar: e.target.value }))} placeholder="https://..." />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </Modal>

                <TableEditorModal
                    open={modals.newTable}
                    mode="create"
                    title="新建表"
                    tableName={tableForm.name}
                    columns={tableForm.columns}
                    aiPrompt={tableAiPrompt}
                    aiLoading={isAiCreateLoading}
                    onChangeName={(name) => setTableForm((f) => ({ ...f, name }))}
                    onChangeColumns={(cols) => setTableForm((f) => ({ ...f, columns: cols }))}
                    onChangeAiPrompt={setTableAiPrompt}
                    onAiGenerate={() => generateTableColumnsWithAi('create')}
                    onSave={handleSaveNewTable}
                    onCancel={() => setModals((m) => ({ ...m, newTable: false }))}
                extraContent={
                    <div className="flex gap-3 items-center">
                        <span className="text-sm w-20">目标</span>
                        <Select
                            className="w-40"
                            placeholder="选择连接"
                            value={newTableTarget.connId || undefined}
                            onChange={(connId) => {
                                const dbName = connections.find((c) => c.id === connId)?.databases?.[0]?.name || null;
                                setNewTableTarget({ connId, dbName });
                            }}
                            options={connections.map((c) => ({ label: c.name, value: c.id }))}
                        />
                        <Select
                            className="w-40"
                            placeholder="选择数据库"
                            value={newTableTarget.dbName || undefined}
                            onChange={(dbName) => setNewTableTarget((t) => ({ ...t, dbName }))}
                            options={(connections.find((c) => c.id === newTableTarget.connId)?.databases || connections[0]?.databases || []).map((d) => ({
                                label: d.name,
                                value: d.name
                            }))}
                        />
                    </div>
                }
            />

                <TableEditorModal
                    open={modals.designTable}
                    mode="design"
                    title={`设计表: ${designTableData.name || ''}`}
                    tableName={designTableData.name}
                    columns={designTableData.columns}
                    aiPrompt={designAiPrompt}
                    aiLoading={isAiDesignLoading}
                    onChangeName={(name) => setDesignTableData((f) => ({ ...f, name }))}
                    onChangeColumns={(cols) => setDesignTableData((f) => ({ ...f, columns: cols }))}
                    onChangeAiPrompt={setDesignAiPrompt}
                    onAiGenerate={() => generateTableColumnsWithAi('design')}
                    onSave={handleSaveDesignTable}
                    onCancel={() => setModals((m) => ({ ...m, designTable: false }))}
                />

                <Modal
                    open={modals.newDatabase}
                    title="新建数据库"
                    onOk={handleSaveNewDatabase}
                    onCancel={() => setModals((m) => ({ ...m, newDatabase: false }))}
                    okText="创建"
                    cancelText="取消"
                    destroyOnClose
                    zIndex={1450}
                >
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <span className="w-20 text-sm">连接</span>
                            <Select
                                className="w-60"
                                placeholder="选择连接"
                                value={newDatabaseForm.connId || undefined}
                                onChange={(connId) => setNewDatabaseForm((f) => ({ ...f, connId }))}
                                options={connections.map((c) => ({ label: c.name, value: c.id }))}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-20 text-sm">库名</span>
                            <Input value={newDatabaseForm.name} onChange={(e) => setNewDatabaseForm((f) => ({ ...f, name: e.target.value }))} placeholder="database_name" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-20 text-sm">字符集</span>
                            <Input value={newDatabaseForm.charset} onChange={(e) => setNewDatabaseForm((f) => ({ ...f, charset: e.target.value }))} placeholder="utf8mb4" />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-20 text-sm">排序规则</span>
                            <Input value={newDatabaseForm.collation} onChange={(e) => setNewDatabaseForm((f) => ({ ...f, collation: e.target.value }))} placeholder="utf8mb4_unicode_ci" />
                        </div>
                    </div>
                </Modal>

                <Modal
                    open={modals.erDiagram}
                    onCancel={() => setModals((m) => ({ ...m, erDiagram: false }))}
                    footer={null}
                    width={900}
                    title={
                        <div className="flex items-center gap-2">
                            <LayoutGrid className="text-blue-400" size={18} />
                            <span>ER 图</span>
                        </div>
                    }
                    zIndex={1450}
                >
                    <div className="relative w-full h-[480px] bg-[#0f172a] rounded-lg overflow-auto border border-[#1e293b]">
                        {Object.entries(erData.tablePositions).map(([table, pos]) => (
                            <div key={table} className="absolute w-56 h-32 rounded-xl bg-[#111827] border border-[#1e293b] shadow-lg text-slate-200 p-3" style={{ left: pos.x, top: pos.y }}>
                                <div className="font-semibold mb-2 flex items-center gap-2">
                                    <Table size={14} />
                                    {table}
                                </div>
                                <div className="text-xs space-y-1 overflow-auto max-h-24 pr-1">
                                    {(mockSchema[table] || []).map((c) => (
                                        <div key={c.name} className="flex justify-between">
                                            <span>{c.name}</span>
                                            <span className="text-slate-400">{c.type}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <svg className="absolute inset-0 pointer-events-none">
                            {erData.lines.map((l, idx) => (
                                <line key={idx} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#38bdf8" strokeWidth="2" strokeOpacity="0.6" />
                            ))}
                        </svg>
                    </div>
                </Modal>

                {globalError && (
                    <div className="fixed bottom-4 right-4 z-[200] max-w-md">
                        <Alert
                            type="error"
                            showIcon
                            title="发生错误"
                            description={<div className="break-words">{globalError}</div>}
                            closable
                            onClose={() => setGlobalError(null)}
                        />
                    </div>
                )}
            </div>
        </ConfigProvider>);
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
