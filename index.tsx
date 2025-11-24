import React, { useState, useEffect, useMemo, useRef } from 'react';
import 'antd/dist/reset.css';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import { ConfigProvider, theme, Select, Button, Segmented, Modal, Input, Checkbox, Divider, Space } from 'antd';
import * as echarts from 'echarts';
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
  FileJson, 
  FileSpreadsheet, 
  Minimize2, 
  Maximize2, 
  Wand2, 
  FileText, 
  Search,
  LayoutGrid,
  Terminal,
  MessageSquare,
  Send,
  Bot,
  User,
  Trash2,
  Moon,
  Sun,
  History,
  Command,
  Eye,
  Key,
  Network,
  Save,
  ArrowRight,
  Loader2,
  RefreshCcw,
  BarChart3
} from 'lucide-react';

// --- 类型定义 ---

type DbType = 'mysql' | 'postgres' | 'oracle' | 'sqlserver';
type AccentColor = 'blue' | 'violet' | 'emerald' | 'rose' | 'orange';
type ViewMode = 'database' | 'chat';
type AiProvider = 'google' | 'openai' | 'deepseek' | 'ollama';
type ToastType = 'info' | 'success' | 'error';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, message: error?.message || '未知错误' };
  }
  componentDidCatch(error: any, info: any) {
    console.error('App crashed', error, info);
  }
  handleRetry = () => this.setState({ hasError: false, message: '' });
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen flex flex-col items-center justify-center gap-4 bg-slate-900 text-white">
          <div className="text-lg font-bold">界面出现错误</div>
          <div className="text-sm opacity-70">{this.state.message}</div>
          <button onClick={this.handleRetry} className="px-4 py-2 rounded bg-blue-500 text-white shadow hover:opacity-90">重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const STORAGE_KEY = 'nova_connections_v1';
const AI_STORAGE_KEY = 'nova_ai_config_v1';
const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  google: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  ollama: 'llama3'
};
const THEME_STORAGE_KEY = 'nova_theme_v1';

interface DatabaseNode {
  id: string;
  name: string;
  expanded: boolean;
  tablesExpanded: boolean; // Added for collapsible tables
  viewsExpanded: boolean;  // Added for collapsible views
  tables: string[];
  views: string[];
  loaded?: boolean; // 标记是否已加载表/视图
}

interface ConnectionNode {
  id: string;
  name: string;
  type: DbType;
  host: string;
  config: DbConnectionConfig;
  runtimeId?: string | null;
  status?: 'idle' | 'connecting' | 'connected' | 'error';
  lastError?: string;
  expanded: boolean;
  databases: DatabaseNode[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
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

interface DbConnectionConfig {
  name: string;
  type: DbType;
  host: string;
  port?: number;
  user: string;
  password: string;
}

interface BackendSchema {
  databases: DatabaseNode[];
  schema: Record<string, ColumnDefinition[]>;
}

declare global {
  interface Window {
    desktopAPI?: {
      connect(config: DbConnectionConfig): Promise<{ id: string; name: string; type: DbType; host: string; database: string; }>;
      listSchema(payload: { connId: string; database?: string }): Promise<BackendSchema>;
      runQuery(payload: { connId: string; sql: string; database?: string }): Promise<{ headers: string[]; rows: any[]; error?: string; }>;
      close?(payload: { connId: string }): Promise<void>;
    };
  }
}

// --- 模拟数据 ---

// Extended Schema definition for the Design Table feature
const INITIAL_SCHEMA: Record<string, ColumnDefinition[]> = {};

// Mock Views
const INITIAL_VIEWS: Record<string, any[]> = {
  high_value_users: [
    { user_id: 1, total_spent: 150.00 },
    { user_id: 3, total_spent: 1200.00 }
  ]
};

const INITIAL_DATA: Record<string, any[]> = {};

// --- 颜色配置 ---

const ACCENTS: Record<AccentColor, { bg: string, text: string, border: string, ring: string, hover: string, bgSoft: string, shadow: string }> = {
  blue:    { bg: 'bg-blue-600', text: 'text-blue-500', border: 'border-blue-500', ring: 'ring-blue-500', hover: 'hover:bg-blue-500', bgSoft: 'bg-blue-500/10', shadow: 'shadow-blue-500/20' },
  violet:  { bg: 'bg-violet-600', text: 'text-violet-500', border: 'border-violet-500', ring: 'ring-violet-500', hover: 'hover:bg-violet-500', bgSoft: 'bg-violet-500/10', shadow: 'shadow-violet-500/20' },
  emerald: { bg: 'bg-emerald-600', text: 'text-emerald-500', border: 'border-emerald-500', ring: 'ring-emerald-500', hover: 'hover:bg-emerald-500', bgSoft: 'bg-emerald-500/10', shadow: 'shadow-emerald-500/20' },
  rose:    { bg: 'bg-rose-600', text: 'text-rose-500', border: 'border-rose-500', ring: 'ring-rose-500', hover: 'hover:bg-rose-500', bgSoft: 'bg-rose-500/10', shadow: 'shadow-rose-500/20' },
  orange:  { bg: 'bg-orange-600', text: 'text-orange-500', border: 'border-orange-500', ring: 'ring-orange-500', hover: 'hover:bg-orange-500', bgSoft: 'bg-orange-500/10', shadow: 'shadow-orange-500/20' },
};

const DEFAULT_PORT: Record<DbType, number> = {
  mysql: 3306,
  postgres: 5432,
  oracle: 1521,
  sqlserver: 1433
};

const DB_OPTIONS: { type: DbType; name: string; color: string; icon: React.ReactNode; hint: string }[] = [
  { type: 'mysql', name: 'MySQL', color: 'from-blue-500 to-cyan-500', icon: <Database size={18} />, hint: '常用开源数据库' },
  { type: 'postgres', name: 'PostgreSQL', color: 'from-indigo-500 to-blue-500', icon: <Server size={18} />, hint: '企业/云端常见' },
  { type: 'sqlserver', name: 'SQL Server', color: 'from-red-500 to-orange-500', icon: <Table size={18} />, hint: '微软生态' },
  { type: 'oracle', name: 'Oracle', color: 'from-amber-500 to-rose-500', icon: <Key size={18} />, hint: '传统商业数据库' },
];

// --- 组件 ---

const App = () => {
  // --- 全局状态 ---
  const [isDark, setIsDark] = useState(true);
  const [accent, setAccent] = useState<AccentColor>('blue');
  const [activeView, setActiveView] = useState<ViewMode>('database');
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'ai'>('appearance');

  // --- 数据库状态 ---
  const [connections, setConnections] = useState<ConnectionNode[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [mockData, setMockData] = useState(INITIAL_DATA);
  const [mockSchema, setMockSchema] = useState(INITIAL_SCHEMA);
  const [activeDatabase, setActiveDatabase] = useState<string | null>(null);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<'table' | 'view'>('table'); // Track if selecting table or view
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{headers: string[], rows: any[], error: string | null} | null>(null);
  const [activeTab, setActiveTab] = useState<'results' | 'chart' | 'insight'>('results');
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 });
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [chartConfig, setChartConfig] = useState<{ type: 'bar' | 'line' | 'pie' | 'scatter'; xField: string; yFields: string[] }>({ type: 'bar', xField: '', yFields: [] });
  const chartRef = useRef<HTMLDivElement | null>(null);

  // --- AI 助手/对话 状态 ---
  const [dbAiPrompt, setDbAiPrompt] = useState("");
  const [isDbAiThinking, setIsDbAiThinking] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'ai', content: '你好！我是你的 AI 数据库助手。有什么我可以帮你的吗？', timestamp: Date.now() }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isChatThinking, setIsChatThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- 弹窗/功能 状态 ---
  const [modals, setModals] = useState({
    newConn: false,
    newDb: false,
    newTable: false,
    settings: false,
    erDiagram: false,
    designTable: false,
    readme: false,
  });
  const [connectionForm, setConnectionForm] = useState<DbConnectionConfig>({
    name: '本地连接',
    type: 'mysql',
    host: 'localhost',
    port: DEFAULT_PORT.mysql,
    user: 'root',
    password: '',
  });
  const [connectionStep, setConnectionStep] = useState<'select' | 'form'>('select');
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [designTableData, setDesignTableData] = useState<{name: string, columns: ColumnDefinition[]}>({ name: '', columns: [] });
  const [activeDesignTab, setActiveDesignTab] = useState('字段'); // Design Table Tabs

  const [contextMenu, setContextMenu] = useState<{x:number, y:number, visible:boolean, type:string, targetId:string|null}>({x:0, y:0, visible:false, type:'root', targetId:null});
  const [aiConfig, setAiConfig] = useState<{ provider: AiProvider; model: string; temperature: number; baseUrl: string; apiKey: string }>({ provider: 'google', model: AI_DEFAULT_MODELS.google, temperature: 0.4, baseUrl: '', apiKey: '' });
  const [newTableForm, setNewTableForm] = useState({ name: '', columns: [{ name: 'id', type: 'BIGINT', length: undefined as number | undefined, decimal: undefined as number | undefined, notNull: true, virtual: false, isKey: true, comment: '' }] });
  const [newTableTargetDbId, setNewTableTargetDbId] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dbAiInputRef = useRef<HTMLInputElement>(null);
  const sqlInputRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string; type: ToastType } | null>(null);
  const prevActiveConnId = useRef<string | null>(null);

  const ai = useMemo(() => {
    if (aiConfig.provider !== 'google') return null;
    const key = aiConfig.apiKey || process.env.API_KEY;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }, [aiConfig.provider, aiConfig.apiKey]);
  const colors = ACCENTS[accent];
  const isDesktop = typeof window !== 'undefined' && !!window.desktopAPI;
  const getDbKey = (db: DatabaseNode) => db.id || db.name;

  const showToast = (message: string, type: ToastType = 'info') => {
    const id = Date.now();
    setToast({ id, message, type });
    setTimeout(() => {
      setToast(prev => (prev && prev.id === id ? null : prev));
    }, 3200);
  };

  // --- 初始化 ---
  useEffect(() => {
    runQuery();
    const closeMenu = () => setContextMenu(prev => ({ ...prev, visible: false }));
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    const stored = loadConnectionsFromStorage();
    if (stored.length > 0) {
      setConnections(stored);
    }
    const storedAi = loadAiConfig();
    if (storedAi) {
      setAiConfig((prev) => ({
        ...prev,
        ...storedAi,
        apiKey: storedAi.apiKey || prev.apiKey || process.env.API_KEY || '',
        model: storedAi.model || AI_DEFAULT_MODELS[storedAi.provider as AiProvider] || AI_DEFAULT_MODELS.google,
      }));
    } else {
      setAiConfig((prev) => ({ ...prev, apiKey: process.env.API_KEY || '', model: AI_DEFAULT_MODELS.google }));
    }
    const storedTheme = loadTheme();
    if (storedTheme) {
      setIsDark(storedTheme.isDark);
      setAccent(storedTheme.accent);
    }
  }, []);

  useEffect(() => {
    saveConnectionsToStorage(connections);
  }, [connections]);

  useEffect(() => {
    saveAiConfig(aiConfig);
  }, [aiConfig]);

  useEffect(() => {
    saveConnectionsToStorage(connections);
  }, [connections]);

  useEffect(() => {
    saveAiConfig(aiConfig);
  }, [aiConfig]);

  useEffect(() => {
    saveTheme({ isDark, accent });
  }, [isDark, accent]);

  useEffect(() => {
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDark]);

  useEffect(() => {
    if (activeView === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, activeView]);

  useEffect(() => {
    if (isDesktop && !activeConnectionId && connections.length > 0) {
      setActiveConnectionId(connections[0].id);
    }
  }, [connections, activeConnectionId, isDesktop]);

  useEffect(() => {
    if (isDesktop && activeConnectionId) {
      const conn = findConnectionById(activeConnectionId);
      const justSwitched = prevActiveConnId.current && prevActiveConnId.current !== activeConnectionId;
      prevActiveConnId.current = activeConnectionId;
      if (conn?.expanded) {
        if (justSwitched) setActiveDatabase(null); // 仅在切换连接时清除选择
        loadSchemaForConnection(activeConnectionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId, connections, isDesktop]);

  // --- 核心逻辑: 数据库 ---

  const loadSchemaForConnection = async (connId: string, dbName?: string, runtimeIdOverride?: string | null) => {
    if (!isDesktop || !window.desktopAPI) return;
    try {
      setIsLoadingSchema(true);
      const runtimeId = runtimeIdOverride || await ensureConnection(connId);
      if (!runtimeId) return;
      const res = await window.desktopAPI.listSchema({ connId: runtimeId, database: dbName });
      if (res?.databases) {
        setConnections(prev => prev.map(c => {
          if (c.id !== connId) return c;
          // 如果是列表模式，直接覆盖；否则更新对应库的表结构
          if (!dbName) {
            const merged = res.databases.map(d => {
              const existing = c.databases.find(x => x.name === d.name || getDbKey(x) === d.id);
              return {
                ...d,
                expanded: existing?.expanded ?? d.expanded ?? false,
                tablesExpanded: existing?.tablesExpanded ?? d.tablesExpanded ?? false,
                viewsExpanded: existing?.viewsExpanded ?? d.viewsExpanded ?? false,
                tables: d.tables && d.tables.length ? d.tables : (existing?.tables ?? []),
                views: d.views && d.views.length ? d.views : (existing?.views ?? []),
                loaded: (existing?.loaded ?? d.loaded ?? false) || (!!existing?.tables?.length || !!existing?.views?.length)
              };
            });
            return { 
              ...c, 
              databases: merged
            };
          }
          const incoming = res.databases[0];
          const updatedDbs = c.databases.map(d => (d.name === incoming.name || getDbKey(d) === incoming.id) ? {
            ...d,
            ...incoming,
            expanded: true,
            tablesExpanded: true,
            viewsExpanded: true,
            loaded: true
          } : d);
          // 如果没有找到，则追加
          if (!updatedDbs.find(d => d.name === incoming.name || getDbKey(d) === incoming.id)) {
            updatedDbs.push({
              ...incoming,
              expanded: true,
              tablesExpanded: true,
              viewsExpanded: true,
              loaded: true
            });
          }
          return { ...c, databases: updatedDbs };
        }));
      }
      if (res?.schema && Object.keys(res.schema).length > 0) {
        setMockSchema(res.schema);
        if (dbName) setActiveDatabase(dbName);
      }
    } catch (error) {
      console.error('load schema failed', error);
      setConnections(prev => prev.map(c => c.id === connId ? { ...c, status: 'error', lastError: (error as any)?.message } : c));
      showToast(`加载库结构失败: ${(error as any)?.message || error}`, 'error');
    } finally {
      setIsLoadingSchema(false);
    }
  };

  const handleCreateConnection = async () => {
    if (isDesktop && window.desktopAPI) {
      try {
        const created = await window.desktopAPI.connect({ ...connectionForm, port: connectionForm.port || DEFAULT_PORT[connectionForm.type] });
        const newId = created.id;
        const newConn: ConnectionNode = {
          id: newId,
          runtimeId: created.id,
          name: created.name,
          type: created.type,
          host: created.host,
          expanded: true,
          databases: [],
          config: { ...connectionForm },
          status: 'connected'
        };
        setConnections(prev => [...prev, newConn]);
        setActiveConnectionId(newId);
        setModals(m => ({ ...m, newConn: false }));
        setConnectionStep('select');
        setEditingConnectionId(null);
        setActiveDatabase(null);
        setActiveTable(null);
        await loadSchemaForConnection(newId, undefined, created.id);
      } catch (e: any) {
        showToast(`连接失败: ${e.message || e}`, 'error');
      }
      return;
    }
    const fallbackId = Date.now().toString();
    setConnections(p=>[...p, {id:fallbackId, runtimeId: fallbackId, name:connectionForm.name || 'New Connection', type:connectionForm.type, host:connectionForm.host, expanded:true, databases:[], config: { ...connectionForm }, status: 'connected'}]);
    setModals(m=>({...m, newConn:false}));
    setEditingConnectionId(null);
  };

  const handleCreateTable = async () => {
    const target = findDatabaseById(newTableTargetDbId);
    if (!target) {
      showToast('请选择数据库', 'error');
      return;
    }
    const { db, conn } = target;
    if (!newTableForm.name.trim()) {
      showToast('请输入表名', 'error');
      return;
    }
    const cols = newTableForm.columns.filter(c => c.name.trim());
    if (cols.length === 0) {
      showToast('请至少添加一列', 'error');
      return;
    }
    const colDefs = cols.map(c => {
      const len = c.length ? `(${c.length}${c.decimal ? `,${c.decimal}` : ''})` : '';
      const notNull = c.notNull ? 'NOT NULL' : '';
      const pk = c.isKey ? 'PRIMARY KEY' : '';
      return `"${c.name}" ${c.type}${len} ${notNull} ${pk}`.trim();
    }).join(', ');
    const sqlText = `CREATE TABLE ${newTableForm.name} (${colDefs})`;

    try {
      if (isDesktop && window.desktopAPI) {
        await window.desktopAPI.runQuery({ connId: conn.id, sql: sqlText, database: db.name });
      }
      const targetDbKey = getDbKey(db);
      setConnections(prev => prev.map(c => c.id === conn.id ? {
        ...c,
        databases: c.databases.map(d => getDbKey(d) === targetDbKey ? { ...d, tables: Array.from(new Set([...(d.tables || []), newTableForm.name])), loaded: true, expanded: true, tablesExpanded: true } : d)
      } : c));
      setMockSchema(prev => ({...prev, [newTableForm.name]: newTableForm.columns}));
      setMockData(prev => ({...prev, [newTableForm.name]: []}));
      setNewTableForm({ name: '', columns: [{ name: 'id', type: 'BIGINT', length: undefined, decimal: undefined, notNull: true, virtual: false, isKey: true, comment: '' }] });
      setModals(m => ({...m, newTable: false}));
    } catch (e: any) {
      showToast(`创建失败: ${e.message || e}`, 'error');
    }
  };

  const runQuery = async (sqlOverride?: string, dbOverride?: string) => {
    try {
      const sqlValue = typeof sqlOverride === 'string' ? sqlOverride : query || '';
      const sql = sqlValue.trim();
      const targetDb = dbOverride ?? activeDatabase ?? undefined;
      if (!sql) return;

      if (isDesktop && activeConnectionId && window.desktopAPI) {
        const runtimeId = await ensureConnection(activeConnectionId);
        if (!runtimeId) throw new Error('连接不可用，请先展开并重新连接。');
        const res = await window.desktopAPI.runQuery({ connId: runtimeId, sql, database: targetDb });
        if (res.error) throw new Error(res.error);
        setResults({ headers: res.headers, rows: res.rows, error: null });
        setActiveTab('results');
        return;
      }

      const lowerSql = sql.toLowerCase();
      const selectMatch = lowerSql.match(/select\s+\*\s+from\s+(\w+)/);
      
      // Handle Views
      if (selectMatch) {
        const targetName = selectMatch[1];
         if (INITIAL_VIEWS[targetName]) {
           const rows = INITIAL_VIEWS[targetName];
           const headers = rows.length > 0 ? Object.keys(rows[0]) : ['Result'];
           setResults({ headers, rows, error: null });
           setActiveTab('results');
           return;
         }
      }

      if (selectMatch) {
        const tableName = selectMatch[1];
        if (mockData[tableName] || mockSchema[tableName]) {
           let rows = mockData[tableName] || [];
           // Simple filter simulation
           if (lowerSql.includes('where') && lowerSql.includes('amount >')) rows = rows.filter((r:any) => r.amount > 100);
           if (lowerSql.includes('order by') && lowerSql.includes('desc')) rows = [...rows].reverse();
           
           const headers = mockSchema[tableName] ? mockSchema[tableName].map(c => c.name) : (rows.length > 0 ? Object.keys(rows[0]) : ['Result']);
           setResults({ headers, rows, error: null });
           setPagination(p => ({ ...p, page: 1 }));
           setActiveTab('results');
           return;
        }
      }
      if (lowerSql.startsWith('show tables')) {
         const tables = Object.keys(mockSchema);
         setResults({ headers: tables.length ? ['Tables_in_database'] : [], rows: tables.map(t => ({'Tables_in_database': t})), error: null });
         return;
      }
      // Default fallback
      if (activeTable && mockData[activeTable]) {
         const headers = mockSchema[activeTable]?.map(c => c.name) || [];
         setResults({ headers, rows: mockData[activeTable], error: null });
      } else {
         setResults(null);
      }
    } catch (e: any) {
      setResults({ headers: [], rows: [], error: e.message });
    }
  };

  const saveConnectionsToStorage = (data: ConnectionNode[]) => {
    try {
      const sanitized = data.map(({ runtimeId, status, lastError, ...rest }) => ({ ...rest }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch (e) {
      console.warn('save connections failed', e);
    }
  };

  const loadConnectionsFromStorage = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return (parsed as any[]).map((c) => {
          const type = (c.type || 'mysql') as DbType;
          const baseConfig: DbConnectionConfig = c.config || {
            name: c.name || '未命名连接',
            type,
            host: c.host || '',
            port: c.port || DEFAULT_PORT[type],
            user: c.user || '',
            password: c.password || ''
          };
          return {
            ...c,
            type,
            config: baseConfig,
            expanded: false,
            databases: [],
            runtimeId: null,
            status: 'idle',
            lastError: undefined
          } as ConnectionNode;
        });
      }
    } catch (e) {
      console.warn('load connections failed', e);
    }
    return [];
  };

  const saveAiConfig = (config: typeof aiConfig) => {
    try {
      localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('save ai config failed', e);
    }
  };

  const loadAiConfig = () => {
    try {
      const raw = localStorage.getItem(AI_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('load ai config failed', e);
      return null;
    }
  };

  const saveTheme = (theme: { isDark: boolean; accent: AccentColor }) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
    } catch (e) {
      console.warn('save theme failed', e);
    }
  };

  const loadTheme = () => {
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as { isDark: boolean; accent: AccentColor };
    } catch (e) {
      console.warn('load theme failed', e);
      return null;
    }
  };

  const findConnectionById = (connId: string | null) => {
    if (!connId) return null;
    return connections.find(c => c.id === connId || c.runtimeId === connId) || null;
  };

  const ensureConnection = async (connId: string | null) => {
    const target = findConnectionById(connId);
    if (!target) return null;
    if (!isDesktop || !window.desktopAPI) return target.runtimeId || target.id;
    if (target.runtimeId) return target.runtimeId;

    const cfg = target.config || {
      name: target.name,
      type: target.type,
      host: target.host,
      port: DEFAULT_PORT[target.type],
      user: '',
      password: ''
    };

    if (!cfg.host || !cfg.user) {
      showToast('连接信息不完整，请编辑后再重试。', 'error');
      return null;
    }

    setConnections(prev => prev.map(c => c.id === target.id ? { ...c, status: 'connecting', lastError: undefined } : c));
    try {
      const created = await window.desktopAPI.connect({ ...cfg, port: cfg.port || DEFAULT_PORT[cfg.type], name: cfg.name || target.name });
      setConnections(prev => prev.map(c => c.id === target.id ? { ...c, runtimeId: created.id, name: created.name || target.name, host: created.host || target.host, status: 'connected' } : c));
      return created.id;
    } catch (e: any) {
      setConnections(prev => prev.map(c => c.id === target.id ? { ...c, status: 'error', lastError: e?.message || '连接失败' } : c));
      showToast(`连接失败: ${e?.message || e}`, 'error');
      return null;
    }
  };

  const findDatabaseById = (dbId: string | null) => {
    if (!dbId) return null;
    for (const conn of connections) {
      const db = conn.databases.find(d => getDbKey(d) === dbId || d.name === dbId);
      if (db) return { db, conn };
    }
    return null;
  };

  const getAiBaseUrl = () => {
    if (aiConfig.baseUrl) return aiConfig.baseUrl.replace(/\/$/, '');
    if (aiConfig.provider === 'openai') return 'https://api.openai.com/v1';
    if (aiConfig.provider === 'deepseek') return 'https://api.deepseek.com/v1';
    if (aiConfig.provider === 'ollama') return 'http://localhost:11434/v1';
    return '';
  };

  const formatSchemaContext = () => {
    const tables = Object.keys(mockSchema);
    if (tables.length === 0) return '当前尚未加载数据库结构。';
    const parts: string[] = [];
    tables.forEach(table => {
      const cols = mockSchema[table] || [];
      const colStr = cols.map(c => `${c.name} ${c.type}${c.length ? `(${c.length})` : ''}${c.notNull ? ' NOT NULL' : ''}${c.isKey ? ' PRIMARY KEY' : ''}`).join(', ');
      const sampleRows = mockData[table]?.slice(0, 3) || [];
      parts.push(`表 ${table}: 列 { ${colStr} } 示例数据: ${JSON.stringify(sampleRows)}`);
    });
    return parts.join('\n');
  };

  const extractTablesFromSql = (sql: string) => {
    const regex = /\bfrom\s+([`"'?]?)(\w+)\1|\bjoin\s+([`"'?]?)(\w+)\1|\bupdate\s+([`"'?]?)(\w+)\1|\binto\s+([`"'?]?)(\w+)\1/gi;
    const tables = new Set<string>();
    let m;
    while ((m = regex.exec(sql)) !== null) {
      const table = m[2] || m[4] || m[6] || m[8];
      if (table) tables.add(table);
    }
    return Array.from(tables);
  };

  const normalizeSqlText = (text: string) => {
    if (!text) return '';
    // If fenced code exists, keep inner content; otherwise strip stray backticks/labels
    const fenceMatch = text.match(/```[\s\S]*?```/g);
    if (fenceMatch && fenceMatch.length) {
      text = fenceMatch.map(b => b.replace(/```(?:sql)?/gi, '').replace(/```/g, '')).join('\n');
    }
    return text.replace(/```/g, '').replace(/```sql/gi, '').trim();
  };

  const handleDbAskAi = async () => {
    if (!dbAiPrompt) return;
    if (!activeDatabase) {
      showToast('请先在左侧选择一个数据库再生成 SQL', 'error');
      return;
    }
    if (aiConfig.provider === 'google' && !ai) {
      showToast('请在设置中填写 Gemini API Key，或切换到其他模型提供者。', 'error');
      return;
    }
    setIsDbAiThinking(true);
    try {
      // Ensure schema is fresh (MCP/IPC fetch)
      if (isDesktop && activeConnectionId && activeDatabase) {
        await loadSchemaForConnection(activeConnectionId, activeDatabase);
      }

      const schemaStr = JSON.stringify(mockSchema);
      const tables = Object.keys(mockSchema);
      const instruction = `
        You are a SQL expert. Existing tables: ${tables.join(', ') || 'none'}.
        If user requests tables not in the list, respond with JSON: { "error": "表不存在: <names>" } and no SQL.
        If multiple candidates, ask user to确认 using error field.
        If tables exist, generate valid SQL only using existing tables.
        If user explicitly names tables, use them directly if present; do not create new ones.
        Respond JSON only: { "sql": "...", "explanation": "..." } or with "error".
        Schema detail: ${formatSchemaContext()}.
        User question: "${dbAiPrompt}".
      `;
      if (aiConfig.provider === 'google') {
        const response = await ai.models.generateContent({
          model: aiConfig.model,
          contents: instruction,
          config: { responseMimeType: "application/json", temperature: aiConfig.temperature }
        });
        const res = JSON.parse(response.text || '{}');
        if (res.error) {
          setInsight(res.error);
          showToast(res.error, 'error');
          return;
        }
        setQuery(res.sql);
        setInsight(res.explanation);
        setTimeout(runQuery, 500);
      } else {
        const base = getAiBaseUrl() || 'https://api.openai.com/v1';
        const resp = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(aiConfig.apiKey ? { Authorization: `Bearer ${aiConfig.apiKey}` } : {})
          },
            body: JSON.stringify({
              model: aiConfig.model,
              temperature: aiConfig.temperature,
              messages: [
              { role: 'system', content: 'You are a SQL expert. Return JSON only.' },
              { role: 'user', content: instruction }
              ]
            })
          });
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || '';
        let sql = '';
        let explanation = '';
        try {
          const parsed = JSON.parse(text);
          if (parsed.error) {
            setInsight(parsed.error);
            showToast(parsed.error, 'error');
            return;
          }
          sql = parsed.sql || text;
          explanation = parsed.explanation || 'AI 生成的 SQL';
        } catch {
          sql = text || '-- 无法解析生成结果';
          explanation = 'AI 生成的 SQL';
        }
        const usedTables = extractTablesFromSql(sql).map(t => t.toLowerCase());
        const existingLower = tables.map(t => t.toLowerCase());
        const missing = usedTables.filter(t => !existingLower.includes(t));
        if (missing.length) {
          const msg = `表不存在: ${missing.join(', ')}`;
          setInsight(msg);
          showToast(msg, 'error');
          return;
        }
        setQuery(sql);
        setInsight(explanation);
        setTimeout(runQuery, 500);
      }
    } catch (e: any) {
      showToast(`生成失败: ${e?.message || e}`, 'error');
      setQuery("-- 生成失败，请重试");
    } finally {
      setIsDbAiThinking(false);
    }
  };

  const getResultColumns = () => {
    if (!results || !results.headers) return [];
    return results.headers.map(h => {
      const sample = results.rows?.find(r => r[h] !== null && r[h] !== undefined);
      const val = sample ? sample[h] : null;
      const isNumber = typeof val === 'number';
      const isDate = val instanceof Date || (typeof val === 'string' && /\d{4}[-/]\d{2}[-/]\d{2}/.test(val));
      return { name: h, isNumber, isDate };
    });
  };

  const applyChartConfig = (cfg?: { type?: 'bar' | 'line' | 'pie' | 'scatter'; xField?: string; yFields?: string[] }) => {
    if (!results || !results.rows?.length) {
      showToast('暂无数据可生成图表', 'error');
      return;
    }
    const cols = getResultColumns();
    const firstDim = cols.find(c => !c.isNumber) || cols[0];
    const numericCols = cols.filter(c => c.isNumber);
    const nextCfg = {
      type: cfg?.type ?? chartConfig.type,
      xField: (cfg?.xField ?? chartConfig.xField) || firstDim?.name || '',
      yFields: cfg?.yFields ?? (chartConfig.yFields.length ? chartConfig.yFields : numericCols.map(c => c.name))
    };
    if (!nextCfg.xField) {
      showToast('请选择 X 轴字段', 'error');
      return;
    }
    if (!nextCfg.yFields.length && nextCfg.type !== 'pie') {
      showToast('请选择数值列作为 Y 轴', 'error');
      return;
    }
    setChartConfig(nextCfg as any);
    renderChart(nextCfg as any);
  };

  const renderChart = (cfg: { type: 'bar' | 'line' | 'pie' | 'scatter'; xField: string; yFields: string[] }) => {
    if (!chartRef.current || !results) return;
    const inst = echarts.getInstanceByDom(chartRef.current!) || echarts.init(chartRef.current!);
    const data = results.rows.slice(0, 1000); // 防卡顿
    const option: any = {
      tooltip: { trigger: cfg.type === 'pie' ? 'item' : 'axis' },
      legend: { top: 10 },
      dataset: { source: data.map(row => ({ ...row })) },
      xAxis: cfg.type === 'pie' ? undefined : { type: 'category', name: cfg.xField },
      yAxis: cfg.type === 'pie' ? undefined : { type: 'value' },
      series: []
    };
    if (cfg.type === 'pie') {
      option.series = [{
        type: 'pie',
        radius: '55%',
        data: data.map(row => ({ name: row[cfg.xField], value: row[cfg.yFields[0] || cfg.xField] }))
      }];
    } else if (cfg.type === 'scatter') {
      option.series = cfg.yFields.map(y => ({
        type: 'scatter',
        encode: { x: cfg.xField, y },
        symbolSize: 10
      }));
    } else {
      option.series = cfg.yFields.map(y => ({
        type: cfg.type,
        encode: { x: cfg.xField, y }
      }));
    }
    inst.setOption(option, true);
  };

  const handleAiSuggestChart = async () => {
    if (!results || !results.rows?.length) {
      showToast('暂无数据可生成图表', 'error');
      return;
    }
    if (aiConfig.provider === 'google' && !ai) {
      showToast('请在设置中填写 Gemini API Key，或切换到其他模型提供者。', 'error');
      return;
    }
    setIsDbAiThinking(true);
    try {
      const cols = getResultColumns();
      const sampleRows = results.rows.slice(0, 200);
      const prompt = `给出一个简单的图表映射 JSON，字段名必须来自列表。只返回 JSON，不要多余文字。
可选type: bar|line|pie|scatter。
字段: ${cols.map(c => `${c.name} (${c.isNumber ? 'number' : c.isDate ? 'date' : 'string'})`).join(', ')}
示例 JSON: {"type":"bar","xField":"字段A","yFields":["字段B"]}`;
      if (aiConfig.provider === 'google') {
        const response = await ai.models.generateContent({
          model: aiConfig.model,
          contents: prompt + '\n样例数据:' + JSON.stringify(sampleRows),
          config: { responseMimeType: "application/json", temperature: aiConfig.temperature }
        });
        const text = response.text || '{}';
        const parsed = JSON.parse(text);
        applyChartConfig({ type: parsed.type, xField: parsed.xField, yFields: parsed.yFields });
      } else {
        const base = getAiBaseUrl() || 'https://api.openai.com/v1';
        const resp = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(aiConfig.apiKey ? { Authorization: `Bearer ${aiConfig.apiKey}` } : {})
          },
          body: JSON.stringify({
            model: aiConfig.model,
            temperature: aiConfig.temperature,
            messages: [
              { role: 'system', content: 'Return chart mapping JSON only.' },
              { role: 'user', content: prompt + '\n样例数据:' + JSON.stringify(sampleRows) }
            ]
          })
        });
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(text);
        applyChartConfig({ type: parsed.type, xField: parsed.xField, yFields: parsed.yFields });
      }
    } catch (e: any) {
      showToast(`生成图表推荐失败: ${e?.message || e}`, 'error');
    } finally {
      setIsDbAiThinking(false);
    }
  };

  // --- 核心逻辑: AI 聊天 ---

  const handleChatSend = async () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: chatInput, timestamp: Date.now() };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput("");
    setIsChatThinking(true);

    try {
      if (aiConfig.provider === 'google') {
        const chat = ai.chats.create({
          model: aiConfig.model,
          config: { systemInstruction: "You are a helpful, knowledgeable database expert and AI assistant." }
        });
        
        const result = await chat.sendMessage({ message: userMsg.content });
        const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'ai', content: result.text || "抱歉，我无法回答。", timestamp: Date.now() };
        setChatHistory(prev => [...prev, aiMsg]);
      } else {
        const base = getAiBaseUrl() || 'https://api.openai.com/v1';
        const resp = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(aiConfig.apiKey ? { Authorization: `Bearer ${aiConfig.apiKey}` } : {})
          },
          body: JSON.stringify({
            model: aiConfig.model,
            temperature: aiConfig.temperature,
            messages: [
              { role: 'system', content: 'You are a helpful, knowledgeable database expert and AI assistant.' },
              { role: 'user', content: userMsg.content }
            ]
          })
        });
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || "抱歉，我无法回答。";
        const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'ai', content: text, timestamp: Date.now() };
        setChatHistory(prev => [...prev, aiMsg]);
      }
    } catch (e) {
      const errorMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'ai', content: "出错了，请稍后再试。", timestamp: Date.now() };
      setChatHistory(prev => [...prev, errorMsg]);
    } finally {
      setIsChatThinking(false);
    }
  };

  // --- 辅助功能 ---
  const exportSchemaDoc = (format: 'word' | 'excel') => {
    const content = Object.entries(mockSchema).map(([table, cols]) => 
       `TABLE: ${table}\n${(cols as any[]).map(c => ` - ${c.name} (${c.type})`).join('\n')}\n`
    ).join('\n----------------\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `db_structure.${format === 'word' ? 'doc' : 'xls'}`; 
    a.click();
  };

  const toggleNode = (type: 'conn' | 'db' | 'db-tables' | 'db-views', id: string) => {
    setConnections(prev => prev.map(c => {
      if (type === 'conn' && c.id === id) return { ...c, expanded: !c.expanded };
      if (type === 'db' || type === 'db-tables' || type === 'db-views') {
        return {
          ...c,
          databases: c.databases.map(d => {
             const dbKey = getDbKey(d);
             if (dbKey !== id) return d;
             if (type === 'db') {
               const nextExpanded = !d.expanded;
               return { 
                 ...d, 
                 expanded: nextExpanded,
                 tablesExpanded: nextExpanded ? true : false,
                 viewsExpanded: nextExpanded ? true : false
               };
             }
             if (type === 'db-tables') return { ...d, tablesExpanded: !d.tablesExpanded };
             if (type === 'db-views') return { ...d, viewsExpanded: !d.viewsExpanded };
             return d;
          })
        };
      }
      return c;
    }));
  };

  const handleConnectionToggle = async (conn: ConnectionNode) => {
    const nextExpanded = !conn.expanded;
    setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, expanded: nextExpanded } : c));
    setActiveConnectionId(conn.id);
    if (nextExpanded) {
      const runtimeId = await ensureConnection(conn.id);
      if (runtimeId) {
        await loadSchemaForConnection(conn.id, undefined, runtimeId);
      } else {
        setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, expanded: false } : c));
      }
    }
  };

  const handleTestConnection = async () => {
    const cfg = { ...connectionForm, port: connectionForm.port || DEFAULT_PORT[connectionForm.type] };
    if (!cfg.host || !cfg.user) {
      showToast('请填写主机和用户名', 'error');
      return;
    }
    setIsTestingConn(true);
    try {
      if (isDesktop && window.desktopAPI) {
        const temp = await window.desktopAPI.connect({ ...cfg, name: cfg.name || '连接测试' });
        if (window.desktopAPI.close) {
          await window.desktopAPI.close({ connId: temp.id });
        }
        showToast('连接成功', 'success');
      } else {
        showToast('连接测试仅在桌面端可用', 'info');
      }
    } catch (e: any) {
      showToast(`连接失败: ${e?.message || e}`, 'error');
    } finally {
      setIsTestingConn(false);
    }
  };

  const openEditConnection = (connId: string) => {
    const target = findConnectionById(connId);
    if (!target) return;
    const cfg = target.config || {
      name: target.name,
      type: target.type,
      host: target.host,
      port: DEFAULT_PORT[target.type],
      user: '',
      password: ''
    };
    setConnectionForm(cfg);
    setEditingConnectionId(connId);
    setConnectionStep('form');
    setModals(m => ({ ...m, newConn: true }));
  };

  const handleSaveConnection = async () => {
    if (editingConnectionId) {
      const updatedCfg = { ...connectionForm };
      setConnections(prev => prev.map(c => c.id === editingConnectionId ? {
        ...c,
        name: updatedCfg.name || c.name,
        type: updatedCfg.type,
        host: updatedCfg.host,
        config: { ...updatedCfg, name: updatedCfg.name || c.name },
        runtimeId: null,
        status: 'idle',
        lastError: undefined,
        expanded: false,
        databases: []
      } : c));
      setModals(m => ({ ...m, newConn: false }));
      setConnectionStep('select');
      setActiveConnectionId(editingConnectionId);
      const runtimeId = await ensureConnection(editingConnectionId);
      if (runtimeId) {
        setConnections(prev => prev.map(c => c.id === editingConnectionId ? { ...c, expanded: true } : c));
        await loadSchemaForConnection(editingConnectionId, undefined, runtimeId);
      }
      setEditingConnectionId(null);
      return;
    }
    await handleCreateConnection();
  };

  const handleGenerateMockData = async (tableName: string) => {
    setActiveTable(tableName);
    setActiveType('table');
    setIsDbAiThinking(true);
    try {
      const cols = mockSchema[tableName] || [];
      const schemaStr = JSON.stringify(cols);
      const prompt = `根据表 ${tableName} 的列定义 ${schemaStr} 生成 3 条插入 SQL 语句，使用 INSERT INTO ${tableName} (...) VALUES (...) 的形式，结果只返回 SQL，多条用分号分隔。`;
      setDbAiPrompt(prompt);
      if (aiConfig.provider === 'google') {
        const response = await ai.models.generateContent({
          model: aiConfig.model,
          contents: prompt,
          config: { responseMimeType: "text/plain", temperature: aiConfig.temperature }
        });
        const text = normalizeSqlText(response.text || '');
        setQuery(text);
      } else {
        const base = getAiBaseUrl() || 'https://api.openai.com/v1';
        const resp = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(aiConfig.apiKey ? { Authorization: `Bearer ${aiConfig.apiKey}` } : {})
          },
          body: JSON.stringify({
            model: aiConfig.model,
            temperature: aiConfig.temperature,
            messages: [
              { role: 'system', content: 'You are a SQL generator.' },
              { role: 'user', content: prompt }
            ]
          })
        });
        const data = await resp.json();
        const text = normalizeSqlText(data?.choices?.[0]?.message?.content || '');
        setQuery(text);
      }
      dbAiInputRef.current?.focus();
    } catch (e: any) {
      showToast(`生成模拟数据失败: ${e?.message || e}`, 'error');
    } finally {
      setIsDbAiThinking(false);
    }
  };

  const defaultColumn = (): ColumnDefinition => ({ name: 'new_col', type: 'VARCHAR', length: 255, decimal: undefined, notNull: false, virtual: false, isKey: false, comment: '' });
  const openNewTableModal = (dbId: string | null) => {
    setNewTableTargetDbId(dbId);
    setNewTableForm({ name: '', columns: [defaultColumn()] });
    setModals(m => ({...m, newTable:true}));
  };

  const TableEditorModal = ({
    visible,
    mode,
    title,
    tableName,
    columns,
    extraInfo,
    onChangeName,
    onChangeColumns,
    onSave,
    onCancel,
  }: {
    visible: boolean;
    mode: 'create' | 'design';
    title: string;
    tableName: string;
    columns: ColumnDefinition[];
    extraInfo?: string;
    onChangeName: (name: string) => void;
    onChangeColumns: (cols: ColumnDefinition[]) => void;
    onSave: () => void;
    onCancel: () => void;
  }) => {
    const typeOptions = ['BIGINT','INTEGER','VARCHAR','TEXT','DATE','DATETIME','DECIMAL','BOOLEAN'];
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
        open={visible}
        title={title}
        width={820}
        onOk={onSave}
        onCancel={onCancel}
        okText={mode === 'create' ? '创建' : '保存'}
        cancelText="取消"
        destroyOnHidden
      >
        {extraInfo && <div className="mb-2 text-sm opacity-70">{extraInfo}</div>}
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Input
            placeholder="表名"
            value={tableName}
            onChange={e => onChangeName(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <div className="text-sm opacity-70">字段定义</div>
            <Button type="dashed" onClick={() => onChangeColumns([...columns, defaultColumn()])}>+ 添加字段</Button>
          </div>
          <div className="max-h-80 overflow-auto border rounded-lg p-2" style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb' }}>
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold opacity-70 px-1 mb-1">
              <div className="col-span-2">列名</div>
              <div className="col-span-2">类型</div>
              <div className="col-span-2">长度</div>
              <div className="col-span-1">小数</div>
              <div className="col-span-1 text-center">非空</div>
              <div className="col-span-1 text-center">虚拟</div>
              <div className="col-span-1 text-center">主键</div>
              <div className="col-span-2">备注</div>
            </div>
            <Divider className="my-2" />
            <div className="space-y-2">
              {columns.map((col, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input value={col.name} onChange={e => updateColumn(idx, { name: e.target.value })} className="col-span-2" />
                  <Select value={col.type} onChange={(val) => updateColumn(idx, { type: val })} className="col-span-2" options={typeOptions.map(t => ({ label: t, value: t }))} />
                  <Input type="number" value={col.length ?? ''} onChange={e => updateColumn(idx, { length: e.target.value ? Number(e.target.value) : undefined })} className="col-span-2" />
                  <Input type="number" value={col.decimal ?? ''} onChange={e => updateColumn(idx, { decimal: e.target.value ? Number(e.target.value) : undefined })} className="col-span-1" />
                  <div className="col-span-1 text-center"><Checkbox checked={col.notNull} onChange={e => updateColumn(idx, { notNull: e.target.checked })} /></div>
                  <div className="col-span-1 text-center"><Checkbox checked={col.virtual} onChange={e => updateColumn(idx, { virtual: e.target.checked })} /></div>
                  <div className="col-span-1 text-center"><Checkbox checked={col.isKey} onChange={e => updateColumn(idx, { isKey: e.target.checked })} /></div>
                  <Input value={col.comment} onChange={e => updateColumn(idx, { comment: e.target.value })} className="col-span-2" />
                  <Button danger type="link" onClick={() => removeColumn(idx)}>删除</Button>
                </div>
              ))}
              {columns.length === 0 && <div className="text-center text-sm opacity-60 py-4">请添加至少一个字段</div>}
            </div>
          </div>
        </Space>
      </Modal>
    );
  };

  const openDesignTable = (tableName: string) => {
    const cols = mockSchema[tableName] || [];
    setDesignTableData({ name: tableName, columns: JSON.parse(JSON.stringify(cols)) });
    setActiveDesignTab('字段');
    setModals(m => ({...m, designTable: true}));
  };

  // --- ER 图 计算逻辑 ---
  const generateERConnections = () => {
    const tables = Object.keys(mockSchema);
    const lines: {x1: number, y1: number, x2: number, y2: number, from: string, to: string}[] = [];
    const tablePositions: Record<string, {x: number, y: number}> = {};
    
    // Grid layout to avoid overlap
    const cardWidth = 260;
    const cardHeight = 170;
    const gapX = 80;
    const gapY = 60;
    const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
    tables.forEach((table, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      tablePositions[table] = {
        x: 80 + col * (cardWidth + gapX),
        y: 80 + row * (cardHeight + gapY),
      };
    });

    // Detect relations (Simple logic: user_id -> users.id)
    tables.forEach(table => {
      const cols = mockSchema[table];
      cols.forEach(col => {
        if (col.name.endsWith('_id')) {
           const targetTable = col.name.replace('_id', '') + 's'; // user_id -> users
           if (tables.includes(targetTable) && targetTable !== table) {
              const p1 = tablePositions[table];
              const p2 = tablePositions[targetTable];
              if (p1 && p2) {
                lines.push({
                   x1: p1.x + cardWidth / 2, // center of card
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
  
  const erData = useMemo(() => modals.erDiagram ? generateERConnections() : {tablePositions:{}, lines:[]}, [modals.erDiagram, mockSchema]);


  // --- 渲染组件 ---

  const renderActivityBar = () => (
    <div className={`w-16 flex flex-col items-center py-6 border-r z-20 flex-shrink-0 transition-colors duration-300
      ${isDark ? 'bg-[#05080f] border-[#1e293b]' : 'bg-slate-900 border-slate-800'} text-slate-400`}
    >
      <div className="mb-8 p-2 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-purple-500/20">
        <Database size={24} />
      </div>
      
      <div className="flex flex-col gap-6 w-full items-center flex-1">
        <button 
          onClick={() => setActiveView('database')}
          className={`p-3 rounded-xl transition-all duration-300 group relative
            ${activeView === 'database' ? 'text-white bg-white/10 shadow-inner' : 'hover:text-white hover:bg-white/5'}
          `}
        >
          <LayoutGrid size={24} />
          {activeView === 'database' && <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full ${colors.bg}`}></div>}
          <span className="absolute left-14 bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">数据库管理</span>
        </button>

        <button 
          onClick={() => setActiveView('chat')}
          className={`p-3 rounded-xl transition-all duration-300 group relative
            ${activeView === 'chat' ? 'text-white bg-white/10 shadow-inner' : 'hover:text-white hover:bg-white/5'}
          `}
        >
          <MessageSquare size={24} />
          {activeView === 'chat' && <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full ${colors.bg}`}></div>}
          <span className="absolute left-14 bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">AI 助手</span>
        </button>
      </div>

      <button 
        onClick={() => setModals(m => ({...m, settings: true}))}
        className="mt-auto p-3 rounded-xl hover:text-white hover:bg-white/5 transition-colors mb-2"
      >
        <Settings size={24} />
      </button>
      <button 
        onClick={() => setModals(m => ({...m, readme: true}))}
        className="p-3 rounded-xl hover:text-white hover:bg-white/5 transition-colors"
      >
        <FileText size={22} />
      </button>
    </div>
  );

  const renderSidebar = () => {
    if (activeView === 'chat') {
      return (
        <div className={`w-64 flex flex-col border-r transition-colors duration-300
          ${isDark ? 'bg-[#0f1218] border-[#1e293b]' : 'bg-gray-50 border-gray-200'}
        `}>
          <div className="p-5 border-b border-transparent">
            <h2 className={`font-semibold text-lg tracking-tight ${isDark ? 'text-white' : 'text-slate-800'}`}>历史会话</h2>
          </div>
          <div className="p-3 space-y-2">
            <div className={`p-3 rounded-lg cursor-pointer flex items-center gap-3 text-sm transition-colors
              ${isDark ? 'bg-[#1e293b]/50 text-white border border-white/5' : 'bg-white text-slate-800 shadow-sm border border-gray-100'}
            `}>
              <MessageSquare size={16} className={colors.text} />
              <span className="truncate">当前会话</span>
            </div>
            {/* Mock History items */}
            <div className={`p-3 rounded-lg cursor-pointer flex items-center gap-3 text-sm opacity-50 hover:opacity-100 transition-colors
               ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}
            `}>
              <History size={16} />
              <span className="truncate">SQL 优化建议...</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`w-64 flex flex-col border-r transition-colors duration-300 flex-shrink-0
        ${isDark ? 'bg-[#0f1218] border-[#1e293b]' : 'bg-gray-50 border-gray-200'}
      `}>
        <div className="p-5 flex items-center justify-between">
          <span className={`font-bold text-sm tracking-wider opacity-70 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>EXPLORER</span>
          <div className="flex gap-1">
            <button className={`p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10`} onClick={() => setConnections(prev => prev.map(c => ({...c, expanded: false})))}><Minimize2 size={14}/></button>
          </div>
        </div>
        
      <div 
        ref={sidebarRef}
        className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar" 
        onContextMenu={(e) => {e.preventDefault(); setContextMenu({x:e.clientX, y:e.clientY, visible:true, type:'root', targetId:null})}}
      >
          {connections.map(conn => (
            <div key={conn.id}>
              <div 
                  className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer group select-none transition-colors text-sm
                    ${isDark ? 'hover:bg-[#1e293b] text-slate-300' : 'hover:bg-gray-200 text-slate-700'}
                  `}
                onClick={() => handleConnectionToggle(conn)}
                onContextMenu={(e) => {e.preventDefault(); e.stopPropagation(); setContextMenu({x:e.clientX, y:e.clientY, visible:true, type:'connection', targetId:conn.id})}}
              >
                {conn.expanded ? <ChevronDown size={14} className="opacity-50"/> : <ChevronRight size={14} className="opacity-50"/>}
                <Server size={16} className={conn.type === 'mysql' ? 'text-blue-400' : 'text-indigo-400'} />
                <span className="font-medium truncate">{conn.name}</span>
              </div>
              
              {conn.expanded && conn.databases.map(db => {
                const dbKey = getDbKey(db);
                return (
                  <div key={dbKey} className="ml-4 border-l border-white/10 pl-2 mt-1">
                     <div 
                     className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer select-none transition-colors text-sm
                        ${isDark ? 'hover:bg-[#1e293b] text-slate-400' : 'hover:bg-gray-200 text-slate-600'}
                     `}
                        onClick={() => {
                          toggleNode('db', dbKey);
                          if (isDesktop && !db.loaded) {
                            loadSchemaForConnection(conn.id, db.name);
                          }
                          setActiveDatabase(db.name);
                        }}
                        onContextMenu={(e) => {e.preventDefault(); e.stopPropagation(); setContextMenu({x:e.clientX, y:e.clientY, visible:true, type:'database', targetId:dbKey})}}
                     >
                        {db.expanded ? <ChevronDown size={14} className="opacity-50"/> : <ChevronRight size={14} className="opacity-50"/>}
                        <Database size={15} className="text-amber-500/80" />
                        <span className="truncate">{db.name}</span>
                     </div>
                     
                     {/* Collapsible Tables List */}
                     {db.expanded && (
                       <>
                         <div 
                            className={`ml-5 mt-1 flex items-center gap-1 text-xs opacity-60 font-bold px-2 py-1 cursor-pointer select-none hover:opacity-100 ${isDark ? 'hover:text-white' : 'hover:text-black'}`}
                            onClick={() => toggleNode('db-tables', dbKey)}
                         >
                            {db.tablesExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                            Tables
                         </div>
                     {db.tablesExpanded && db.tables.map(table => (
                        <div 
                          key={table} 
                          className={`ml-5 flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-all mb-0.5
                                ${activeTable === table && activeType === 'table'
                                  ? `${colors.bgSoft} ${colors.text} font-medium` 
                                  : `${isDark ? 'text-slate-500 hover:text-slate-300 hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-gray-100'}`
                                }`}
                         onClick={() => { 
                           setActiveDatabase(db.name); 
                           setActiveTable(table); 
                           setActiveType('table'); 
                           const sqlText = `SELECT * FROM ${table}`;
                           setQuery(sqlText); 
                           runQuery(sqlText, db.name);
                         }}
                          onContextMenu={(e) => {e.preventDefault(); e.stopPropagation(); setContextMenu({x:e.clientX, y:e.clientY, visible:true, type:'table', targetId:table})}}
                       >
                         <Table size={14} className={activeTable === table ? 'opacity-100' : 'opacity-50'} />
                         <span className="truncate">{table}</span>
                       </div>
                     ))}

                         {/* Collapsible Views List */}
                         <div 
                            className={`ml-5 mt-1 flex items-center gap-1 text-xs opacity-60 font-bold px-2 py-1 cursor-pointer select-none hover:opacity-100 ${isDark ? 'hover:text-white' : 'hover:text-black'}`}
                            onClick={() => toggleNode('db-views', dbKey)}
                         >
                            {db.viewsExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                            Views
                         </div>
                         {db.viewsExpanded && db.views.map(view => (
                            <div 
                              key={view} 
                              className={`ml-5 flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-all mb-0.5
                                ${activeTable === view && activeType === 'view'
                                  ? `${colors.bgSoft} ${colors.text} font-medium` 
                                  : `${isDark ? 'text-slate-500 hover:text-slate-300 hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-gray-100'}`
                                }`}
                              onClick={() => { 
                                setActiveDatabase(db.name); 
                                setActiveTable(view); 
                                setActiveType('view'); 
                                const sqlText = `SELECT * FROM ${view}`;
                                setQuery(sqlText); 
                                runQuery(sqlText, db.name);
                              }}
                              onContextMenu={(e) => {e.preventDefault(); e.stopPropagation(); setContextMenu({x:e.clientX, y:e.clientY, visible:true, type:'view', targetId:view})}}
                            >
                              <Eye size={14} className={activeTable === view ? 'opacity-100' : 'opacity-50'} />
                              <span className="truncate">{view}</span>
                            </div>
                         ))}
                       </>
                     )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderDatabaseView = () => (
    <div className="flex-1 flex flex-col h-full relative min-w-0" style={{ pointerEvents: 'auto' }}>
      {/* AI Spotlight Bar - Redesigned */}
      <div className="flex flex-col items-center pt-8 px-6 pb-6 flex-shrink-0">
        <div className={`relative w-full max-w-3xl transition-all duration-300 ${isDbAiThinking ? 'scale-[1.01]' : 'hover:scale-[1.005]'}`}>
           {/* Gradient Glow Background */}
           <div className={`absolute -inset-0.5 rounded-2xl blur opacity-30 transition duration-500 group-hover:opacity-75 pointer-events-none
              bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600
              ${isDbAiThinking ? 'opacity-100 animate-pulse' : ''}
           `}></div>
           
           {/* Main Input Container */}
           <div 
             className={`relative flex items-center gap-4 px-5 py-4 rounded-2xl shadow-2xl backdrop-blur-xl border z-10
             ${isDark ? 'bg-[#0f1218]/90 border-white/10' : 'bg-white/90 border-white/40'}
           `}
             onClick={() => dbAiInputRef.current?.focus()}
             style={{ pointerEvents: 'auto' }}
           >
              {/* Icon Area */}
              <div className={`p-2 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-purple-500/20`}>
                <Sparkles size={18} className={isDbAiThinking ? 'animate-spin-slow' : ''} />
              </div>

              {/* Input Field */}
              <div className="flex-1 flex flex-col justify-center pointer-events-auto">
                  <input 
                    ref={dbAiInputRef}
                    type="text"
                    className={`w-full bg-transparent border-none outline-none text-base font-medium placeholder:font-normal focus:ring-0 pointer-events-auto
                      ${isDark ? 'text-white placeholder:text-slate-500' : 'text-slate-800 placeholder:text-slate-400'}
                    `}
                    tabIndex={0}
                    placeholder="输入指令（查询/建表/分析/生成脚本）..." 
                    value={dbAiPrompt}
                 onChange={e => setDbAiPrompt(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleDbAskAi()}
                  />
               </div>

              {/* Action Button */}
              <button 
                 onClick={handleDbAskAi}
                 disabled={!dbAiPrompt || isDbAiThinking}
                 className={`group/btn flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all
                   ${(!dbAiPrompt || isDbAiThinking) ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-400' : 
                     `${colors.bg} text-white shadow-lg ${colors.shadow} hover:opacity-90 hover:-translate-y-0.5`
                   }
                 `}
              >
                 {isDbAiThinking ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} className={dbAiPrompt ? 'group-hover/btn:rotate-12 transition-transform' : ''} />}
                 <span>{isDbAiThinking ? '生成中' : '执行'}</span>
              </button>
           </div>
        </div>
        
        {/* Quick Suggestions */}
        <div className="flex flex-wrap justify-center gap-4 mt-4 text-xs opacity-50" />
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col px-6 pb-6 gap-4 overflow-hidden">
          {/* Editor */}
          <div className={`flex flex-col rounded-xl border shadow-sm transition-all duration-300 overflow-hidden flex-shrink-0
            ${isDark ? 'bg-[#151921] border-[#1e293b]' : 'bg-white border-gray-200'}
            ${editorCollapsed ? 'h-12' : 'h-1/3 min-h-[200px]'}
          `}>
             <div className={`flex items-center justify-between px-4 py-2.5 border-b select-none ${isDark ? 'border-[#1e293b] bg-[#1e293b]/30' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex items-center gap-2 text-xs font-mono opacity-60">
                  <Terminal size={14}/> SQL EDITOR
                </div>
                <div className="flex items-center gap-2">
                   <button onClick={runQuery} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition text-white ${colors.bg} hover:opacity-90 shadow-lg ${colors.shadow}`}>
                      <Play size={12} fill="currentColor" /> 运行
                   </button>
                   <button onClick={() => setEditorCollapsed(!editorCollapsed)} className={`p-1.5 rounded hover:bg-white/10 opacity-60 hover:opacity-100`}>
                      {editorCollapsed ? <Maximize2 size={14}/> : <Minimize2 size={14}/>}
                   </button>
                </div>
             </div>
             {!editorCollapsed && (
                <div className="flex-1 relative group">
                   <div className={`absolute inset-y-0 left-0 w-12 border-r flex flex-col items-end pr-3 pt-4 font-mono text-xs opacity-20 select-none ${isDark ? 'border-[#1e293b]' : 'border-gray-100'}`}>
                      {[1,2,3,4,5,6,7,8,9].map(n => <div key={n}>{n}</div>)}
                   </div>
                   <textarea 
                     ref={sqlInputRef}
                     className={`w-full h-full p-4 pl-16 font-mono text-sm bg-transparent border-none outline-none resize-none leading-6 pointer-events-auto ${isDark ? 'text-blue-100' : 'text-slate-800'}`}
                     value={query}
                     onChange={e => setQuery(e.target.value)}
                     spellCheck={false}
                     tabIndex={0}
                     onFocus={() => {}}
                     onBlur={() => {}}
                   />
               </div>
            )}
          </div>

          {/* Results */}
          <div className={`flex-1 flex flex-col rounded-xl border shadow-sm overflow-hidden min-h-0
             ${isDark ? 'bg-[#151921] border-[#1e293b]' : 'bg-white border-gray-200'}
          `}>
             <div className={`flex items-center justify-between px-3 border-b ${isDark ? 'border-[#1e293b]' : 'border-gray-100'}`}>
                <div className="flex gap-4">
                 <button onClick={() => setActiveTab('results')} className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'results' ? `${colors.border} ${colors.text}` : 'border-transparent opacity-50 hover:opacity-100'}`}>
                   <LayoutGrid size={16}/> 数据结果
                 </button>
                  <button onClick={() => setActiveTab('chart')} className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'chart' ? `${colors.border} ${colors.text}` : 'border-transparent opacity-50 hover:opacity-100'}`}>
                    <BarChart3 size={16}/> 数据可视化
                  </button>
                  <button onClick={() => setActiveTab('insight')} className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'insight' ? `${colors.border} ${colors.text}` : 'border-transparent opacity-50 hover:opacity-100'}`}>
                    <Sparkles size={16}/> 智能分析
                  </button>
                </div>
                {activeTab === 'results' && (
                  <div className="flex items-center gap-1">
                     <button className="p-1.5 rounded hover:bg-white/5 opacity-50 hover:opacity-100" title="导出 JSON"><FileJson size={16}/></button>
                     <button className="p-1.5 rounded hover:bg-white/5 opacity-50 hover:opacity-100" title="导出 CSV"><FileSpreadsheet size={16}/></button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto custom-scrollbar relative">
                {activeTab === 'results' ? (
                   results?.error ? (
                      <div className="flex flex-col items-center justify-center h-full text-rose-400 gap-3">
                         <div className="p-4 rounded-full bg-rose-500/10"><X size={32}/></div>
                         <span>{results.error}</span>
                      </div>
                   ) : (
                     <table className="w-full text-left text-sm border-collapse">
                        <thead className={`sticky top-0 z-10 ${isDark ? 'bg-[#1e293b] text-slate-300' : 'bg-gray-50 text-slate-600'}`}>
                           <tr>
                              <th className="p-3 w-12 font-normal opacity-40 border-b border-r border-white/5">#</th>
                              {results?.headers.map(h => (
                                 <th key={h} className="p-3 font-semibold border-b border-r border-white/5 whitespace-nowrap">{h}</th>
                              ))}
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                           {results?.rows.slice((pagination.page - 1) * pagination.pageSize, pagination.page * pagination.pageSize).map((row, i) => (
                              <tr key={i} className={`group transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-blue-50'}`}>
                                 <td className="p-3 font-mono text-xs opacity-30 border-r border-white/5">{(pagination.page - 1) * pagination.pageSize + i + 1}</td>
                                 {results?.headers.map(h => (
                                    <td key={h} className={`p-3 border-r border-white/5 max-w-[200px] truncate ${isDark ? 'text-slate-400 group-hover:text-slate-200' : 'text-slate-600'}`}>
                                       {typeof row[h] === 'object' ? JSON.stringify(row[h]) : row[h]}
                                    </td>
                                 ))}
                              </tr>
                           ))}
                        </tbody>
                     </table>
                   )
                ) : activeTab === 'chart' ? (
                   <div className="flex flex-col h-full">
                     <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/10 text-sm relative z-10">
                       <div className="flex items-center gap-2">
                         <span className="opacity-70">类型</span>
                         <Segmented
                           value={chartConfig.type}
                           onChange={(val) => setChartConfig(c => ({...c, type: val as any}))}
                           options={[
                             { label: '柱状', value: 'bar' },
                             { label: '折线', value: 'line' },
                             { label: '饼图', value: 'pie' },
                             { label: '散点', value: 'scatter' },
                           ]}
                         />
                       </div>
                       <div className="flex items-center gap-2 min-w-[220px]">
                         <span className="opacity-70">X轴</span>
                         <Select
                           style={{ minWidth: 160 }}
                           placeholder="选择字段"
                           value={chartConfig.xField || undefined}
                           onChange={(val) => setChartConfig(c => ({...c, xField: val}))}
                           options={(results?.headers || []).map(h => ({ label: h, value: h }))}
                         />
                       </div>
                       {chartConfig.type !== 'pie' && (
                         <div className="flex items-center gap-2 min-w-[260px]">
                           <span className="opacity-70">Y轴</span>
                           <Select
                             mode="multiple"
                             allowClear
                             style={{ minWidth: 200 }}
                             placeholder="选择数值列"
                             value={chartConfig.yFields}
                             onChange={(vals) => setChartConfig(c => ({...c, yFields: vals as string[]}))}
                             options={(results?.headers || []).map(h => ({ label: h, value: h }))}
                           />
                         </div>
                       )}
                       <Button type="primary" onClick={() => applyChartConfig()} className="flex items-center">应用</Button>
                       <Button onClick={handleAiSuggestChart} disabled={isDbAiThinking} className="flex items-center" icon={isDbAiThinking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}>
                         AI 推荐
                       </Button>
                     </div>
                     <div className="flex-1 min-h-0 relative">
                       <div ref={chartRef} className="w-full h-full" />
                       {!results?.rows?.length && (
                         <div className="absolute inset-0 flex items-center justify-center text-slate-500 pointer-events-none">暂无数据</div>
                       )}
                     </div>
                   </div>
                ) : (
                   <div className="p-8 max-w-3xl mx-auto">
                      {insight ? (
                        <div className={`prose ${isDark ? 'prose-invert' : ''} max-w-none animate-slide-up`}>
                          <h3 className={`flex items-center gap-2 ${colors.text}`}><Sparkles/> AI 洞察报告</h3>
                          <div className="whitespace-pre-wrap text-sm opacity-80 leading-relaxed">{insight}</div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-64 opacity-40">
                           <Sparkles size={48} className="mb-4 text-slate-500"/>
                           <p>执行查询后，AI 将为您分析数据趋势</p>
                        </div>
                      )}
                   </div>
                )}
             </div>
             
             {/* Footer Status */}
             {activeTab === 'results' && (
               <div className={`h-9 border-t flex items-center justify-between px-4 text-xs select-none ${isDark ? 'border-[#1e293b] bg-[#0f1218]' : 'border-gray-200 bg-gray-50'} opacity-70`}>
                  <div className="font-mono">Total: {results?.rows.length || 0} rows</div>
                  <div className="flex gap-3">
                    <button disabled={pagination.page===1} onClick={()=>setPagination(p=>({...p, page:p.page-1}))} className={`hover:${colors.text} disabled:opacity-30`}>Prev</button>
                    <span>{pagination.page}</span>
                    <button disabled={!results || results.rows.length <= pagination.page * pagination.pageSize} onClick={()=>setPagination(p=>({...p, page:p.page + 1}))} className={`hover:${colors.text} disabled:opacity-30`}>Next</button>
                  </div>
               </div>
             )}
          </div>
      </div>
    </div>
  );

  const renderChatView = () => (
    <div className="flex-1 flex flex-col h-full relative" style={{ pointerEvents: 'auto' }}>
      <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'border-white/5 bg-[#151921]/50' : 'border-gray-200 bg-white'}`}>
         <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${colors.bg} text-white`}><Bot size={20}/></div>
            <div>
              <h2 className="font-bold text-sm">AI 智能助手</h2>
              <p className="text-xs opacity-50">Powered by Gemini 2.5</p>
            </div>
         </div>
         <button onClick={() => setChatHistory([])} className="p-2 hover:bg-white/5 rounded-lg opacity-60 hover:opacity-100 hover:text-red-400 transition"><Trash2 size={18}/></button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
        {chatHistory.map(msg => (
          <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-slide-up`}>
             <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 
               ${msg.role === 'ai' ? `${colors.bg} text-white` : 'bg-slate-700 text-slate-300'}
             `}>
               {msg.role === 'ai' ? <Bot size={16}/> : <User size={16}/>}
             </div>
             <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm
               ${msg.role === 'user' 
                 ? `${colors.bg} text-white rounded-tr-none` 
                 : `${isDark ? 'bg-[#1e293b] text-slate-200' : 'bg-white border border-gray-100 text-slate-700'} rounded-tl-none`
               }
             `}>
                {msg.content}
             </div>
          </div>
        ))}
        {isChatThinking && (
           <div className="flex gap-4 animate-fade-in">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${colors.bg} text-white`}><Bot size={16}/></div>
              <div className={`px-4 py-3 rounded-2xl rounded-tl-none text-sm ${isDark ? 'bg-[#1e293b]' : 'bg-white border border-gray-100'}`}>
                 <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"/>
                    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce delay-75"/>
                    <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce delay-150"/>
                 </div>
              </div>
           </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-6 pt-2">
          <div className={`relative p-2 rounded-xl border shadow-lg transition-all focus-within:ring-1 focus-within:ring-blue-500/50
            ${isDark ? 'bg-[#1e293b] border-white/5' : 'bg-white border-gray-200'}
          `}>
            <textarea 
              ref={chatInputRef}
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSend();
                }
              }}
              placeholder="输入消息... (Shift+Enter 换行)"
              className="w-full max-h-32 bg-transparent border-none outline-none resize-none p-2 text-sm custom-scrollbar"
              rows={1}
              onFocus={() => {}}
              onBlur={() => {}}
            />
            <div className="flex justify-between items-center px-2 pb-1 mt-1">
               <span className="text-xs opacity-30">支持 Markdown</span>
               <button 
                 onClick={handleChatSend}
                 disabled={!chatInput.trim() || isChatThinking}
                 className={`p-2 rounded-lg transition-all ${chatInput.trim() ? `${colors.bg} text-white shadow-md` : 'bg-white/5 opacity-50 cursor-not-allowed'}`}
               >
                 <Send size={16} />
               </button>
            </div>
         </div>
      </div>
    </div>
  );

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: '#3b82f6' }
      }}
    >
    <div 
      className={`flex h-screen w-screen overflow-hidden transition-colors duration-500 ${isDark ? 'bg-[#09090b] text-slate-200' : 'bg-[#f8fafc] text-slate-900'}`}
      style={{ pointerEvents: 'auto', position: 'relative', zIndex: 0 }}
    >
      
      {/* 1. Activity Bar */}
      {renderActivityBar()}

      {/* 2. Secondary Sidebar */}
      {renderSidebar()}

      {/* 3. Main Content Area */}
      {activeView === 'database' ? renderDatabaseView() : renderChatView()}

      {/* --- Global Modals --- */}

      {/* Settings Modal */}
      {modals.settings && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm animate-fade-in p-4">
          <div className={`w-[500px] rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh]
            ${isDark ? 'bg-[#0f1218] border-white/10' : 'bg-white border-gray-200'}
          `}>
             <div className="p-6 border-b border-white/5 flex justify-between items-center">
                <h2 className="text-xl font-bold flex items-center gap-2"><Settings className={colors.text}/> 设置</h2>
                <button onClick={() => setModals(m => ({...m, settings: false}))} className="hover:text-red-400"><X size={20}/></button>
             </div>
             <div className="flex h-[70vh]">
               <div className={`w-40 border-r ${isDark ? 'border-white/10 bg-[#0f172a]/60' : 'border-gray-200 bg-gray-50'} p-3 space-y-2`}>
                 <button onClick={() => setSettingsTab('appearance')} className={`w-full text-left px-3 py-2 rounded-lg ${settingsTab === 'appearance' ? `${colors.bgSoft} ${colors.text}` : `${isDark ? 'text-slate-400 hover:bg-white/5' : 'text-slate-600 hover:bg-gray-100'}`}`}>外观</button>
                 <button onClick={() => setSettingsTab('ai')} className={`w-full text-left px-3 py-2 rounded-lg ${settingsTab === 'ai' ? `${colors.bgSoft} ${colors.text}` : `${isDark ? 'text-slate-400 hover:bg-white/5' : 'text-slate-600 hover:bg-gray-100'}`}`}>模型</button>
               </div>
               <div className="flex-1 p-6 space-y-8 overflow-y-auto">
                 {settingsTab === 'appearance' && (
                  <section>
                     <h3 className="text-sm font-semibold mb-4 opacity-70 uppercase tracking-wider">外观</h3>
                     <div className="grid grid-cols-2 gap-4 mb-6">
                        <button onClick={() => setIsDark(false)} className={`p-4 rounded-xl border flex flex-col items-center gap-2 transition-all ${!isDark ? `border-${accent}-500 bg-${accent}-500/5 ring-1 ring-${accent}-500` : 'border-transparent bg-white/5 hover:bg-white/10'}`}>
                           <Sun size={24} />
                           <span className="text-sm font-medium">浅色模式</span>
                        </button>
                        <button onClick={() => setIsDark(true)} className={`p-4 rounded-xl border flex flex-col items-center gap-2 transition-all ${isDark ? `border-${accent}-500 bg-${accent}-500/5 ring-1 ring-${accent}-500` : 'border-transparent bg-white/5 hover:bg-white/10'}`}>
                           <Moon size={24} />
                           <span className="text-sm font-medium">深色模式</span>
                        </button>
                     </div>
                     <h4 className="text-xs mb-3 opacity-50">主题色</h4>
                     <div className="flex gap-4">
                        {(Object.keys(ACCENTS) as AccentColor[]).map(c => (
                           <button key={c} onClick={() => setAccent(c)} className={`w-8 h-8 rounded-full transition-transform ${ACCENTS[c].bg} ${accent === c ? 'scale-125 ring-2 ring-offset-2 ring-offset-black' : 'hover:scale-110 opacity-60 hover:opacity-100'}`} />
                        ))}
                     </div>
                  </section>
                 )}

                {settingsTab === 'ai' && (
                 <section>
                    <h3 className="text-sm font-semibold mb-4 opacity-70 uppercase tracking-wider">模型</h3>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { key: 'google', label: 'Google Gemini' },
                            { key: 'openai', label: 'OpenAI' },
                            { key: 'deepseek', label: 'DeepSeek' },
                            { key: 'ollama', label: 'Ollama (本地)' },
                          ].map(opt => (
                            <button
                              key={opt.key}
                              onClick={() => setAiConfig({...aiConfig, provider: opt.key as AiProvider, model: AI_DEFAULT_MODELS[opt.key as AiProvider] })}
                              className={`p-3 rounded-lg border text-left transition ${aiConfig.provider === opt.key ? `${colors.bgSoft} ${colors.text} border-${colors.border}` : `${isDark ? 'border-white/10 text-slate-300 hover:bg-white/5' : 'border-gray-200 text-slate-700 hover:bg-gray-100'}`}`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        {aiConfig.provider !== 'google' && (
                          <>
                            <div>
                              <label className="block text-sm mb-2 opacity-80">Base URL</label>
                              <input value={aiConfig.baseUrl} onChange={e => setAiConfig({...aiConfig, baseUrl: e.target.value})} placeholder={aiConfig.provider === 'openai' ? 'https://api.openai.com/v1' : aiConfig.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'http://localhost:11434/v1'} className={`w-full p-3 rounded-xl outline-none border ${isDark ? 'bg-[#1e293b] border-white/10' : 'bg-gray-50 border-gray-200'}`} />
                            </div>
                            <div>
                              <label className="block text-sm mb-2 opacity-80">API Key（Ollama 可留空）</label>
                              <input value={aiConfig.apiKey} onChange={e => setAiConfig({...aiConfig, apiKey: e.target.value})} type="password" placeholder={aiConfig.provider === 'ollama' ? '可留空' : 'sk-...'} className={`w-full p-3 rounded-xl outline-none border ${isDark ? 'bg-[#1e293b] border-white/10' : 'bg-gray-50 border-gray-200'}`} />
                            </div>
                          </>
                        )}
                       <div>
                           <label className="block text-sm mb-2 opacity-80">模型</label>
                           {aiConfig.provider === 'ollama' ? (
                             <input
                               value={aiConfig.model}
                               onChange={e => setAiConfig({...aiConfig, model: e.target.value})}
                               placeholder="llama3 或本地已拉取的模型名"
                               className={`w-full p-3 rounded-xl outline-none border ${isDark ? 'bg-[#1e293b] border-white/10 text-slate-200' : 'bg-gray-50 border-gray-200 text-slate-700'}`}
                             />
                           ) : (
                             <div className={`p-3 rounded-xl border ${isDark ? 'bg-[#1e293b] border-white/10 text-slate-200' : 'bg-gray-50 border-gray-200 text-slate-700'}`}>
                               {aiConfig.model}
                             </div>
                           )}
                       </div>
                       <div>
                          <label className="block text-sm mb-2 opacity-80">创造力 (Temperature): {aiConfig.temperature}</label>
                          <input type="range" min="0" max="1" step="0.1" value={aiConfig.temperature} onChange={e => setAiConfig({...aiConfig, temperature: parseFloat(e.target.value)})} className={`w-full accent-${accent}-500`} />
                       </div>
                          <div className="flex items-center gap-2">
                         <button onClick={() => {
                           (async () => {
                             let result = '连接成功';
                             try {
                               if (aiConfig.provider === 'google') {
                                 const response = await ai.models.generateContent({
                                   model: aiConfig.model,
                                   contents: 'ping',
                                   config: { temperature: 0 }
                                 });
                                 if (!response.text) result = '连接失败：无响应';
                               } else {
                                 const base = getAiBaseUrl() || 'https://api.openai.com/v1';
                                 const resp = await fetch(`${base}/chat/completions`, {
                                   method: 'POST',
                                   headers: {
                                     'Content-Type': 'application/json',
                                     ...(aiConfig.apiKey ? { Authorization: `Bearer ${aiConfig.apiKey}` } : {})
                                   },
                                   body: JSON.stringify({
                                     model: aiConfig.model,
                                     messages: [{ role: 'user', content: 'ping' }]
                                   })
                                 });
                                 if (!resp.ok) {
                                   const txt = await resp.text();
                                   result = `连接失败：${resp.status} ${txt}`;
                                 }
                               }
                             } catch (err: any) {
                               result = `连接失败：${err?.message || err}`;
                             }
                             showToast(result, result.includes('失败') ? 'error' : 'success');
                           })();
                         }} className={`px-4 py-2 rounded text-white text-sm ${colors.bg}`}>测试连接</button>
                       </div>
                    </div>
                  </section>
                 )}
               </div>
             </div>
             <div className="p-4 border-t border-white/5 flex justify-end">
                <button onClick={() => setModals(m => ({...m, settings: false}))} className={`px-6 py-2 rounded-lg text-white font-medium shadow-lg ${colors.shadow} ${colors.bg} hover:opacity-90`}>
                   确认
                </button>
             </div>
          </div>
        </div>
      )}

      {modals.readme && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm animate-fade-in p-4">
          <div className={`w-[800px] max-w-[90vw] rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh]
            ${isDark ? 'bg-[#0f1218] border-white/10 text-slate-100' : 'bg-white border-gray-200 text-slate-800'}
          `}>
            <div className="p-5 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className={colors.text} />
                <h2 className="text-xl font-bold">NovaDB README</h2>
              </div>
              <button onClick={() => setModals(m => ({...m, readme: false}))} className="hover:text-red-400"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold opacity-70 uppercase tracking-wider">快速开始</h3>
                <ul className="space-y-1 text-sm leading-relaxed">
                  <li>1) 右键空白处 → 新建连接，填写主机/端口/账号/密码。</li>
                  <li>2) 展开数据库，点击表/视图即可加载 schema，并在 SQL 编辑器预填查询。</li>
                  <li>3) 输入 SQL 或使用 AI 生成，点击“运行”查看结果。</li>
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold opacity-70 uppercase tracking-wider">AI & 模型</h3>
                <ul className="space-y-1 text-sm leading-relaxed">
                  <li>• 支持 Gemini / OpenAI / DeepSeek / Ollama（OpenAI 兼容）。</li>
                  <li>• AI 生成前会自动刷新当前库的表结构；不存在的表会提示，不执行。</li>
                  <li>• 生成的 SQL 会校验表名，再写入编辑器并执行。</li>
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold opacity-70 uppercase tracking-wider">数据库操作</h3>
                <ul className="space-y-1 text-sm leading-relaxed">
                  <li>• 左侧仅负责滚动浏览库/表/视图，右侧工作区固定。</li>
                  <li>• 右键表：设计表结构 / 生成模拟数据（生成 INSERT 语句写入编辑器）。</li>
                  <li>• 右键数据库：新建表 / 生成 ER 图。</li>
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold opacity-70 uppercase tracking-wider">常见问题</h3>
                <ul className="space-y-1 text-sm leading-relaxed">
                  <li>• 空白界面：确保用最新打包版本，离线资源已改相对路径。</li>
                  <li>• AI 提示无效：确认设置里已填 API Key 或切换其他模型。</li>
                  <li>• 表不存在提示：先展开库或刷新结构，确保 schema 已加载。</li>
                </ul>
              </section>
            </div>
            <div className="p-4 border-t flex justify-end">
              <button onClick={() => setModals(m => ({...m, readme: false}))} className={`px-5 py-2 rounded-lg text-white font-medium ${colors.bg} hover:opacity-90`}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table Editor Modals */}
      {modals.newTable && (
        <TableEditorModal
          visible={modals.newTable}
          mode="create"
          title="新建表"
          tableName={newTableForm.name}
          columns={newTableForm.columns}
          extraInfo={`目标数据库: ${findDatabaseById(newTableTargetDbId)?.db.name || '未选择'}`}
          onChangeName={(name) => setNewTableForm(f => ({...f, name}))}
          onChangeColumns={(cols) => setNewTableForm(f => ({...f, columns: cols}))}
          onCancel={() => setModals(m => ({...m, newTable:false}))}
          onSave={handleCreateTable}
        />
      )}

      {modals.designTable && (
        <TableEditorModal
          visible={modals.designTable}
          mode="design"
          title={`设计表: ${designTableData.name}`}
          tableName={designTableData.name}
          columns={designTableData.columns}
          extraInfo="保存后将更新本地结构"
          onChangeName={(name) => setDesignTableData(p => ({...p, name}))}
          onChangeColumns={(cols) => setDesignTableData(p => ({...p, columns: cols}))}
          onCancel={() => setModals(m => ({...m, designTable:false}))}
          onSave={() => { setMockSchema(prev => ({...prev, [designTableData.name]: designTableData.columns})); setModals(m => ({...m, designTable:false})); }}
        />
      )}

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className={`fixed z-[120] py-1 rounded-lg border shadow-xl w-48 text-sm animate-fade-in ${isDark ? 'bg-[#1e293b] border-white/10 text-slate-100' : 'bg-white border-gray-200 text-slate-800'}`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.type === 'root' && (
            <button
              className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2"
              onClick={() => {
                setEditingConnectionId(null);
                setConnectionForm({ name: '本地连接', type: 'mysql', host: 'localhost', port: DEFAULT_PORT.mysql, user: 'root', password: '' });
                setConnectionStep('select');
                setModals(m=>({...m, newConn:true}));
                setContextMenu(p=>({...p, visible:false}));
              }}
            ><Plus size={14}/> 新建连接</button>
          )}
          {contextMenu.type === 'connection' && (
            <>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {if (contextMenu.targetId) openEditConnection(contextMenu.targetId); setContextMenu(p=>({...p, visible:false}));}}><Settings size={14}/> 编辑连接</button>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {setModals(m=>({...m, newDb:true})); setContextMenu(p=>({...p, visible:false}));}}><Database size={14}/> 新建数据库</button>
            </>
          )}
          {contextMenu.type === 'database' && (
            <>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={async () => {
                if (contextMenu.targetId) {
                  const found = connections.flatMap(c => c.databases.map(d => ({...d, connId: c.id, key: getDbKey(d)}))).find(d => d.key === contextMenu.targetId);
                  if (found) await loadSchemaForConnection(found.connId, found.name);
                }
                setContextMenu(p=>({...p, visible:false}));
              }}><RefreshCcw size={14}/> 刷新库结构</button>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {
                openNewTableModal(contextMenu.targetId);
                setContextMenu(p=>({...p, visible:false}));
              }}><Table size={14}/> 新建表</button>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {setModals(m=>({...m, erDiagram:true})); setContextMenu(p=>({...p, visible:false}));}}><Network size={14}/> 生成 ER 图</button>
            </>
          )}
          {contextMenu.type === 'table' && (
            <>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {openDesignTable(contextMenu.targetId!); setContextMenu(p=>({...p, visible:false}));}}><Table size={14}/> 设计表结构</button>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {handleGenerateMockData(contextMenu.targetId!); setContextMenu(p=>({...p, visible:false}));}}><Wand2 size={14}/> 生成模拟数据</button>
              <div className="h-px bg-white/10 my-1"/>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {exportSchemaDoc('word'); setContextMenu(p=>({...p, visible:false}));}}><FileText size={14}/> 导出结构 (Word)</button>
            </>
          )}
          {contextMenu.type === 'view' && (
            <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => { 
              const sqlText = `SELECT * FROM ${contextMenu.targetId}`; 
              setQuery(sqlText); 
              runQuery(sqlText, activeDatabase || undefined); 
              setContextMenu(p=>({...p, visible:false}));
            }}><Eye size={14}/> 查看视图数据</button>
          )}
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-lg shadow-lg border flex items-center gap-2 transition-all
          ${isDark ? 'bg-[#0b1220] border-white/10 text-slate-100' : 'bg-white border-gray-200 text-slate-800'}
        `}>
          <div className={`w-2 h-2 rounded-full ${
            toast.type === 'success' ? 'bg-emerald-400' : toast.type === 'error' ? 'bg-rose-500' : 'bg-blue-400'
          }`} />
          <span className="text-sm">{toast.message}</span>
        </div>
      )}
    </div>
    </ConfigProvider>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
