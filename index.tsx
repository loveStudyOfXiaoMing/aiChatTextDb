import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
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
  Loader2
} from 'lucide-react';

// --- 类型定义 ---

type DbType = 'mysql' | 'postgres' | 'oracle' | 'sqlserver';
type AccentColor = 'blue' | 'violet' | 'emerald' | 'rose' | 'orange';
type ViewMode = 'database' | 'chat';
type AiProvider = 'google' | 'openai' | 'deepseek' | 'ollama';

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
  const [activeTab, setActiveTab] = useState<'results' | 'insight'>('results');
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 });
  const [editorCollapsed, setEditorCollapsed] = useState(false);

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

  const ai = useMemo(() => {
    if (aiConfig.provider !== 'google') return null;
    const key = aiConfig.apiKey || process.env.API_KEY;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }, [aiConfig.provider, aiConfig.apiKey]);
  const colors = ACCENTS[accent];
  const isDesktop = typeof window !== 'undefined' && !!window.desktopAPI;

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
      if (conn?.expanded) {
        setActiveDatabase(null);
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
            return { 
              ...c, 
              databases: res.databases.map(d => ({
                ...d,
                expanded: d.expanded ?? false,
                tablesExpanded: d.tablesExpanded ?? false,
                viewsExpanded: d.viewsExpanded ?? false,
                loaded: d.loaded ?? false
              }))
            };
          }
          const incoming = res.databases[0];
          const updatedDbs = c.databases.map(d => d.name === incoming.name ? {
            ...d,
            ...incoming,
            expanded: true,
            tablesExpanded: true,
            viewsExpanded: true,
            loaded: true
          } : d);
          // 如果没有找到，则追加
          if (!updatedDbs.find(d => d.name === incoming.name)) {
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
      alert(`加载库结构失败: ${(error as any)?.message || error}`);
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
        alert(`连接失败: ${e.message || e}`);
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
      alert('请选择数据库');
      return;
    }
    const { db, conn } = target;
    if (!newTableForm.name.trim()) {
      alert('请输入表名');
      return;
    }
    const cols = newTableForm.columns.filter(c => c.name.trim());
    if (cols.length === 0) {
      alert('请至少添加一列');
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
      setConnections(prev => prev.map(c => c.id === conn.id ? {
        ...c,
        databases: c.databases.map(d => d.id === db.id ? { ...d, tables: Array.from(new Set([...(d.tables || []), newTableForm.name])), loaded: true, expanded: true, tablesExpanded: true } : d)
      } : c));
      setMockSchema(prev => ({...prev, [newTableForm.name]: newTableForm.columns}));
      setMockData(prev => ({...prev, [newTableForm.name]: []}));
      setNewTableForm({ name: '', columns: [{ name: 'id', type: 'BIGINT', length: undefined, decimal: undefined, notNull: true, virtual: false, isKey: true, comment: '' }] });
      setModals(m => ({...m, newTable: false}));
    } catch (e: any) {
      alert(`创建失败: ${e.message || e}`);
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
      alert('连接信息不完整，请编辑后再重试。');
      return null;
    }

    setConnections(prev => prev.map(c => c.id === target.id ? { ...c, status: 'connecting', lastError: undefined } : c));
    try {
      const created = await window.desktopAPI.connect({ ...cfg, port: cfg.port || DEFAULT_PORT[cfg.type], name: cfg.name || target.name });
      setConnections(prev => prev.map(c => c.id === target.id ? { ...c, runtimeId: created.id, name: created.name || target.name, host: created.host || target.host, status: 'connected' } : c));
      return created.id;
    } catch (e: any) {
      setConnections(prev => prev.map(c => c.id === target.id ? { ...c, status: 'error', lastError: e?.message || '连接失败' } : c));
      alert(`连接失败: ${e?.message || e}`);
      return null;
    }
  };

  const findDatabaseById = (dbId: string | null) => {
    if (!dbId) return null;
    for (const conn of connections) {
      const db = conn.databases.find(d => d.id === dbId);
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
    if (aiConfig.provider === 'google' && !ai) {
      alert('请在设置中填写 Gemini API Key，或切换到其他模型提供者。');
      return;
    }
    setIsDbAiThinking(true);
    try {
      // Ensure schema is fresh (MCP/IPC fetch)
      if (isDesktop && activeConnectionId) {
        const targetDb = activeDatabase || connections.find(c => c.id === activeConnectionId)?.databases[0]?.name;
        if (targetDb) {
          await loadSchemaForConnection(activeConnectionId, targetDb);
          setActiveDatabase(targetDb);
        }
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
          alert(res.error);
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
            alert(parsed.error);
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
          alert(msg);
          return;
        }
        setQuery(sql);
        setInsight(explanation);
        setTimeout(runQuery, 500);
      }
    } catch (e: any) {
      alert(`生成失败: ${e?.message || e}`);
      setQuery("-- 生成失败，请重试");
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
             if (d.id !== id) return d;
             if (type === 'db') return { ...d, expanded: !d.expanded };
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
      alert('请填写主机和用户名');
      return;
    }
    setIsTestingConn(true);
    try {
      if (isDesktop && window.desktopAPI) {
        const temp = await window.desktopAPI.connect({ ...cfg, name: cfg.name || '连接测试' });
        if (window.desktopAPI.close) {
          await window.desktopAPI.close({ connId: temp.id });
        }
        alert('连接成功');
      } else {
        alert('连接测试仅在桌面端可用');
      }
    } catch (e: any) {
      alert(`连接失败: ${e?.message || e}`);
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
    setIsDbAiThinking(true);
    try {
      const cols = mockSchema[tableName] || [];
      const schemaStr = JSON.stringify(cols);
      const prompt = `根据表 ${tableName} 的列定义 ${schemaStr} 生成 3 条插入 SQL 语句，使用 INSERT INTO ${tableName} (...) VALUES (...) 的形式，结果只返回 SQL，多条用分号分隔。`;
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
    } catch (e: any) {
      alert(`生成模拟数据失败: ${e?.message || e}`);
    } finally {
      setIsDbAiThinking(false);
    }
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
    
    // Arrange in a circle
    const centerX = 450;
    const centerY = 350;
    const radius = 250;
    
    tables.forEach((table, index) => {
      const angle = (index / tables.length) * 2 * Math.PI - (Math.PI / 2);
      tablePositions[table] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
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
                   x1: p1.x + 128, // center of card width (w-64 => 256px)
                   y1: p1.y + 80,  // approx center of card height
                   x2: p2.x + 128, 
                   y2: p2.y + 80,
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
              
              {conn.expanded && conn.databases.map(db => (
                <div key={db.id} className="ml-4 border-l border-white/10 pl-2 mt-1">
                   <div 
                   className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer select-none transition-colors text-sm
                      ${isDark ? 'hover:bg-[#1e293b] text-slate-400' : 'hover:bg-gray-200 text-slate-600'}
                   `}
                      onClick={() => {
                        toggleNode('db', db.id);
                        if (isDesktop && !db.loaded) {
                          loadSchemaForConnection(conn.id, db.name);
                        }
                        setActiveDatabase(db.name);
                      }}
                      onContextMenu={(e) => {e.preventDefault(); e.stopPropagation(); setContextMenu({x:e.clientX, y:e.clientY, visible:true, type:'database', targetId:db.id})}}
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
                          onClick={() => toggleNode('db-tables', db.id)}
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
                          onClick={() => toggleNode('db-views', db.id)}
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
              ))}
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
                    placeholder="输入自然语言查询..." 
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
                 <span>{isDbAiThinking ? '生成中' : '生成'}</span>
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
                           <div className={`p-3 rounded-xl border ${isDark ? 'bg-[#1e293b] border-white/10 text-slate-200' : 'bg-gray-50 border-gray-200 text-slate-700'}`}>
                             {aiConfig.model}
                           </div>
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
                             alert(result);
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

      {/* Design Table Modal (Navicat-style) */}
      {modals.designTable && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm animate-fade-in">
          <div className={`w-[90vw] h-[80vh] rounded-xl border shadow-2xl overflow-hidden flex flex-col
            ${isDark ? 'bg-[#0f1218] border-white/10' : 'bg-white border-gray-200'}
          `}>
             {/* Top Header */}
             <div className={`px-4 py-3 border-b flex justify-between items-center ${isDark ? 'bg-[#151921] border-white/5' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-center gap-3">
                   <Table size={18} className={colors.text}/> 
                   <span className="font-bold">设计表: {designTableData.name}</span>
                </div>
                <div className="flex gap-2">
                   <button onClick={() => { 
                      setMockSchema(prev => ({...prev, [designTableData.name]: designTableData.columns}));
                      setModals(m => ({...m, designTable: false}));
                    }} className={`flex items-center gap-2 px-4 py-1.5 rounded text-white text-sm ${colors.bg} hover:opacity-90`}>
                      <Save size={14}/> 保存设计
                   </button>
                   <button onClick={() => setModals(m => ({...m, designTable: false}))} className="p-1.5 hover:bg-white/10 rounded"><X size={18}/></button>
                </div>
             </div>

             {/* Tab Bar */}
             <div className={`flex items-center px-2 border-b select-none overflow-x-auto ${isDark ? 'bg-[#0f1218] border-white/5' : 'bg-white border-gray-200'}`}>
                {['字段', '索引', '外键', '触发器', '检查', '选项', '注释', 'SQL 预览'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveDesignTab(tab)}
                    className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap
                      ${activeDesignTab === tab 
                        ? `${colors.border} ${isDark ? 'bg-white/5 text-white' : 'bg-blue-50 text-blue-600'}` 
                        : 'border-transparent opacity-60 hover:opacity-100 hover:bg-white/5'
                      }
                    `}
                  >
                    {tab}
                  </button>
                ))}
             </div>

             {/* Tab Content */}
             <div className="flex-1 overflow-hidden flex flex-col relative">
                {activeDesignTab === '字段' && (
                  <>
                     {/* Toolbar */}
                     <div className={`p-2 border-b flex gap-2 ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
                        <button className="px-3 py-1 text-xs rounded border border-dashed border-gray-500 hover:border-blue-500" onClick={() => setDesignTableData(p => ({...p, columns: [...p.columns, {name: 'new_col', type: 'VARCHAR', length: 255, notNull: false, virtual: false, isKey: false, comment: ''}]}))}>+ 添加字段</button>
                     </div>

                     {/* Grid Header */}
                     <div className="flex-1 overflow-auto">
                        <table className="w-full text-left border-collapse text-sm">
                           <thead className={`sticky top-0 z-10 ${isDark ? 'bg-[#1e293b]' : 'bg-gray-100'}`}>
                              <tr>
                                 {['名', '类型', '长度', '小数点', '不是 Null', '虚拟', '键', '注释'].map(h => (
                                    <th key={h} className="p-2 border-b border-r border-white/10 font-medium text-xs opacity-70 whitespace-nowrap">{h}</th>
                                 ))}
                                 <th className="p-2 border-b border-white/10"></th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-white/5">
                              {designTableData.columns.map((col, idx) => (
                                 <tr key={idx} className={`group ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                                    {/* Name */}
                                    <td className="p-1 border-r border-white/5"><input className="w-full bg-transparent px-2 py-1 outline-none" value={col.name} onChange={e => {const n = [...designTableData.columns]; n[idx].name = e.target.value; setDesignTableData({...designTableData, columns: n})}} /></td>
                                    {/* Type */}
                                    <td className="p-1 border-r border-white/5">
                                       <select className={`w-full bg-transparent px-1 py-1 outline-none ${isDark?'text-white':'text-black'}`} value={col.type} onChange={e => {const n = [...designTableData.columns]; n[idx].type = e.target.value; setDesignTableData({...designTableData, columns: n})}}>
                                          {['INTEGER', 'BIGINT', 'VARCHAR', 'TEXT', 'DATE', 'DATETIME', 'DECIMAL', 'BOOLEAN'].map(t => <option key={t} value={t}>{t}</option>)}
                                       </select>
                                    </td>
                                    {/* Length */}
                                    <td className="p-1 border-r border-white/5"><input className="w-16 bg-transparent px-2 py-1 outline-none" type="number" value={col.length || ''} onChange={e => {const n = [...designTableData.columns]; n[idx].length = parseInt(e.target.value); setDesignTableData({...designTableData, columns: n})}} /></td>
                                    {/* Decimal */}
                                    <td className="p-1 border-r border-white/5"><input className="w-16 bg-transparent px-2 py-1 outline-none" type="number" value={col.decimal || ''} onChange={e => {const n = [...designTableData.columns]; n[idx].decimal = parseInt(e.target.value); setDesignTableData({...designTableData, columns: n})}} /></td>
                                    {/* Not Null */}
                                    <td className="p-1 border-r border-white/5 text-center"><input type="checkbox" checked={col.notNull} onChange={e => {const n = [...designTableData.columns]; n[idx].notNull = e.target.checked; setDesignTableData({...designTableData, columns: n})}} className={`accent-${accent}-500`}/></td>
                                    {/* Virtual */}
                                    <td className="p-1 border-r border-white/5 text-center"><input type="checkbox" checked={col.virtual} onChange={e => {const n = [...designTableData.columns]; n[idx].virtual = e.target.checked; setDesignTableData({...designTableData, columns: n})}} className={`accent-${accent}-500`}/></td>
                                    {/* Key */}
                                    <td className="p-1 border-r border-white/5 text-center">{col.isKey && <Key size={12} className="text-amber-500 inline"/>} <input type="checkbox" checked={col.isKey} onChange={e => {const n = [...designTableData.columns]; n[idx].isKey = e.target.checked; setDesignTableData({...designTableData, columns: n})}} className={`accent-${accent}-500 ml-1`}/></td>
                                    {/* Comment */}
                                    <td className="p-1 border-r border-white/5"><input className="w-full bg-transparent px-2 py-1 outline-none" value={col.comment || ''} onChange={e => {const n = [...designTableData.columns]; n[idx].comment = e.target.value; setDesignTableData({...designTableData, columns: n})}} /></td>
                                    
                                    <td className="p-1 text-center"><button onClick={() => setDesignTableData(p => ({...p, columns: p.columns.filter((_, i) => i !== idx)}))} className="opacity-0 group-hover:opacity-50 hover:opacity-100 hover:text-red-400"><Trash2 size={14}/></button></td>
                                 </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                  </>
                )}
                {activeDesignTab !== '字段' && (
                   <div className="flex items-center justify-center flex-1 text-slate-500 flex-col gap-2">
                      <Settings size={32} className="opacity-20"/>
                      <p>Coming Soon: {activeDesignTab} Editor</p>
                   </div>
                )}
             </div>
          </div>
        </div>
      )}

      {/* ER Diagram Modal (Simple Visualization) */}
      {modals.erDiagram && (
         <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm animate-fade-in">
            <div className="w-[95vw] h-[90vh] bg-[#1e1e1e] rounded-xl overflow-hidden flex flex-col relative shadow-2xl border border-white/10">
               <div className="absolute top-4 right-4 z-50">
                  <button onClick={() => setModals(m => ({...m, erDiagram: false}))} className="p-2 bg-black/50 rounded-full hover:bg-white/20 text-white"><X size={24}/></button>
               </div>
               <div className="p-4 border-b border-white/10 bg-[#1e1e1e] z-10 flex items-center gap-2 text-white">
                  <Network className={colors.text}/> 
                  <span className="font-bold">ER Diagram Visualization</span>
               </div>
               <div className="flex-1 overflow-auto p-0 relative custom-scrollbar bg-[#1a1a1a]">
                  {/* SVG Layer for lines */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{minWidth: '1200px', minHeight: '1200px'}}>
                     <defs>
                        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                           <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
                        </marker>
                     </defs>
                     {erData.lines.map((line, i) => (
                        <g key={i}>
                           <path 
                             d={`M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`} 
                             stroke="#475569" 
                             strokeWidth="2" 
                             fill="none" 
                             markerEnd="url(#arrowhead)"
                             strokeDasharray="5,5"
                           />
                           <circle cx={line.x1} cy={line.y1} r="3" fill="#64748b"/>
                        </g>
                     ))}
                  </svg>
                  
                  <div className="w-full h-full relative" style={{minWidth: '1200px', minHeight: '1200px'}}>
                     {Object.keys(erData.tablePositions).map((tableName) => {
                        const pos = erData.tablePositions[tableName];
                        return (
                           <div 
                             key={tableName} 
                             className={`w-64 rounded-lg border shadow-2xl bg-[#2d2d2d] border-white/5 absolute group hover:border-blue-500/50 transition-all z-10`}
                             style={{ left: pos.x, top: pos.y }}
                           >
                              <div className={`p-2 border-b border-white/5 font-bold text-center bg-gradient-to-r from-transparent via-white/5 to-transparent text-white flex justify-between items-center`}>
                                 <span className="px-2">{tableName}</span>
                                 <div className="flex gap-1 px-2">
                                    <div className="w-2 h-2 rounded-full bg-red-500"/>
                                    <div className="w-2 h-2 rounded-full bg-yellow-500"/>
                                 </div>
                              </div>
                              <div className="p-2 bg-[#252525]">
                                 {mockSchema[tableName].map((col, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-xs p-1.5 border-b border-white/5 last:border-0 hover:bg-white/5">
                                       <span className={`flex items-center gap-1 ${col.isKey ? 'text-amber-400 font-bold' : 'text-slate-300'}`}>
                                          {col.isKey && <Key size={10}/>}
                                          {col.name}
                                       </span>
                                       <span className="text-slate-500 font-mono">{col.type}</span>
                                    </div>
                                 ))}
                              </div>
                           </div>
                        );
                     })}
                  </div>
               </div>
            </div>
         </div>
      )}

      {/* Context Menu */}
      {contextMenu.visible && (
        <div className={`fixed z-50 py-1 rounded-lg border shadow-xl w-48 text-sm animate-fade-in ${isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-gray-200'}`} style={{left: contextMenu.x, top: contextMenu.y}} onClick={e => e.stopPropagation()}>
           {contextMenu.type === 'root' && <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {
             setEditingConnectionId(null);
             setConnectionForm({ name: '本地连接', type: 'mysql', host: 'localhost', port: DEFAULT_PORT.mysql, user: 'root', password: '' });
             setConnectionStep('select');
             setModals(m=>({...m, newConn:true}));
             setContextMenu(p=>({...p, visible:false}));
           }}><Plus size={14}/> 新建连接</button>}
           {contextMenu.type === 'connection' && (
             <>
               <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {if (contextMenu.targetId) openEditConnection(contextMenu.targetId); setContextMenu(p=>({...p, visible:false}))}}><Settings size={14}/> 编辑连接</button>
               <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {setModals(m=>({...m, newDb:true})); setContextMenu(p=>({...p, visible:false}))}}><Database size={14}/> 新建数据库</button>
             </>
           )}
           {contextMenu.type === 'database' && (
             <>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={async () => {
                if (contextMenu.targetId) {
                  const found = connections.flatMap(c => c.databases.map(d => ({...d, connId: c.id}))).find(d => d.id === contextMenu.targetId);
                  if (found) await loadSchemaForConnection(found.connId, found.name);
                }
                setContextMenu(p=>({...p, visible:false}));
              }}><RefreshCcw size={14}/> 刷新库结构</button>
              <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {
                setNewTableTargetDbId(contextMenu.targetId);
                setNewTableForm({ name: '', columns: [{ name: 'id', type: 'BIGINT', length: undefined, decimal: undefined, notNull: true, virtual: false, isKey: true, comment: '' }] });
                setModals(m=>({...m, newTable:true}));
                setContextMenu(p=>({...p, visible:false}));
              }}><Table size={14}/> 新建表</button>
               <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {setModals(m=>({...m, erDiagram:true})); setContextMenu(p=>({...p, visible:false}))}}><Network size={14}/> 生成 ER 图</button>
             </>
           )}
           {contextMenu.type === 'table' && (
              <>
                <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {openDesignTable(contextMenu.targetId!); setContextMenu(p=>({...p, visible:false}))}}><Table size={14}/> 设计表结构</button>
                <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {handleGenerateMockData(contextMenu.targetId!); setContextMenu(p=>({...p, visible:false}))}}><Wand2 size={14}/> 生成模拟数据</button>
                <div className="h-px bg-white/10 my-1"/>
                <button className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2" onClick={() => {exportSchemaDoc('word'); setContextMenu(p=>({...p, visible:false}))}}><FileText size={14}/> 导出结构 (Word)</button>
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
      
      {/* Simple Modals for New Table/Conn/etc (Simplified styles) */}
      {modals.newConn && (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm">
            <div className={`p-0 rounded-2xl border w-[560px] max-h-[82vh] overflow-hidden shadow-2xl ${isDark ? 'bg-[#0b1220] border-white/10' : 'bg-white border-gray-200'}`}>
               <div className="p-4 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 text-white flex items-center justify-between">
                 <div>
                   <div className="text-xs opacity-90">{connectionStep === 'select' ? '选择数据库类型' : '填写连接信息'}</div>
                   <h3 className="font-bold text-lg mt-0.5">{editingConnectionId ? '编辑连接' : '新建连接'}</h3>
                 </div>
                 <div className="text-xs bg-white/20 px-3 py-1 rounded-full backdrop-blur-sm">桌面端直连数据库</div>
               </div>
               <div className="p-6 space-y-4">

               {connectionStep === 'select' && (
                 <div className="grid grid-cols-2 gap-3">
                   {DB_OPTIONS.map(opt => (
                     <button
                       key={opt.type}
                       onClick={() => {
                         setConnectionForm(f => ({...f, type: opt.type, port: DEFAULT_PORT[opt.type], name: `${opt.name} 连接`}));
                         setConnectionStep('form');
                       }}
                       className={`p-3 rounded-xl border transition hover:scale-[1.01] text-left ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}
                     >
                       <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${opt.color} text-white flex items-center justify-center mb-2 shadow-lg`}>
                         {opt.icon}
                       </div>
                       <div className="font-semibold text-sm">{opt.name}</div>
                       <div className="text-xs opacity-70">{opt.hint}</div>
                     </button>
                   ))}
                 </div>
               )}

               {connectionStep === 'form' && (
                 <div className="space-y-4">
                   <div className="flex items-center justify-between">
                     <div className="text-sm opacity-70">类型：{connectionForm.type.toUpperCase()}</div>
                     {!editingConnectionId && <button className="text-xs opacity-60 hover:opacity-100" onClick={() => setConnectionStep('select')}>重新选择</button>}
                   </div>
                   <div className="grid grid-cols-2 gap-3">
                     <div className="col-span-2 space-y-1">
                       <label className="text-xs opacity-70">连接名称</label>
                       <input 
                         className={`w-full p-3 rounded-lg border outline-none shadow-inner ${isDark ? 'bg-black/20 border-white/10' : 'bg-gray-50 border-gray-200'}`} 
                         placeholder="例如：生产库 / 开发库" 
                         value={connectionForm.name}
                         onChange={e => setConnectionForm(f => ({...f, name: e.target.value}))}
                       />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs opacity-70">主机 / IP</label>
                       <input 
                         className={`w-full p-3 rounded-lg border outline-none shadow-inner ${isDark ? 'bg-black/20 border-white/10' : 'bg-gray-50 border-gray-200'}`} 
                         placeholder="localhost 或 192.168.x.x" 
                         value={connectionForm.host}
                         onChange={e => setConnectionForm(f => ({...f, host: e.target.value}))}
                       />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs opacity-70">端口</label>
                       <input 
                         className={`w-full p-3 rounded-lg border outline-none shadow-inner ${isDark ? 'bg-black/20 border-white/10' : 'bg-gray-50 border-gray-200'}`} 
                         placeholder={`${DEFAULT_PORT[connectionForm.type]}`} 
                         value={connectionForm.port ?? ''} 
                         onChange={e => setConnectionForm(f => ({...f, port: Number(e.target.value)}))}
                       />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs opacity-70">用户名</label>
                       <input 
                         className={`w-full p-3 rounded-lg border outline-none shadow-inner ${isDark ? 'bg-black/20 border-white/10' : 'bg-gray-50 border-gray-200'}`} 
                         placeholder="如 root" 
                         value={connectionForm.user}
                         onChange={e => setConnectionForm(f => ({...f, user: e.target.value}))}
                       />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs opacity-70">密码</label>
                       <input 
                         className={`w-full p-3 rounded-lg border outline-none shadow-inner ${isDark ? 'bg-black/20 border-white/10' : 'bg-gray-50 border-gray-200'}`} 
                         placeholder="数据库密码" 
                         type="password"
                         value={connectionForm.password}
                         onChange={e => setConnectionForm(f => ({...f, password: e.target.value}))}
                       />
                     </div>
                   </div>
                   <div className="text-xs opacity-70 flex items-center justify-between">
                     <span>无需填写数据库名，保存后会自动列出。</span>
                     <span className="flex items-center gap-2">{editingConnectionId ? '保存后自动重连' : '创建后自动连通'}</span>
                   </div>
                   <div className="flex items-center gap-2 justify-between">
                     <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${isDark ? 'bg-white/5 text-slate-300' : 'bg-blue-50 text-slate-700'}`}>
                       <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"/>
                       <span>填写完成后可先测试，不会保存连接。</span>
                     </div>
                     <button onClick={handleTestConnection} disabled={isTestingConn} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${isTestingConn ? 'opacity-50 cursor-not-allowed' : `${colors.bg} text-white shadow`}`}>
                       <Loader2 size={14} className={isTestingConn ? 'animate-spin' : 'hidden'} />
                       {!isTestingConn && <Play size={14} />}
                       测试连接
                     </button>
                   </div>
                 </div>
                )}
               <div className="flex justify-end gap-2 mt-4">
                  <button onClick={()=>{setModals(m=>({...m, newConn:false})); setConnectionStep('select'); setEditingConnectionId(null);}} className="px-3 py-2 text-sm opacity-70 hover:opacity-100">取消</button>
                  {connectionStep === 'form' && <button onClick={handleSaveConnection} className={`px-4 py-2 text-sm text-white rounded-lg shadow ${colors.bg}`}>{editingConnectionId ? '保存并重连' : '创建并连接'}</button>}
               </div>
             </div>
            </div>
         </div>
      )}

      {modals.newTable && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className={`p-6 rounded-xl border w-[520px] max-h-[80vh] ${isDark ? 'bg-[#0f172a] border-white/10' : 'bg-white'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">新建表</h3>
              <button onClick={()=>setModals(m=>({...m, newTable:false}))} className="opacity-60 hover:opacity-100"><X size={18}/></button>
            </div>
            <div className="space-y-3">
              <div className="p-3 rounded-lg border text-sm flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${colors.color || colors.bg} text-white flex items-center justify-center`}>
                  <Table size={18}/>
                </div>
                <div>
                  <div className="font-semibold">目标数据库: {findDatabaseById(newTableTargetDbId)?.db.name || '未选择'}</div>
                  <div className="text-xs opacity-70">将创建在已选数据库下</div>
                </div>
              </div>
              <input
                className={`w-full p-2 rounded border outline-none ${isDark ? 'bg-black/20 border-white/10' : 'bg-gray-50'}`}
                placeholder="表名"
                value={newTableForm.name}
                onChange={e => setNewTableForm(f => ({...f, name: e.target.value}))}
              />
              <div className="flex items-center justify-between text-xs opacity-70">
                <span>字段定义</span>
                <button className="text-blue-400 hover:underline" onClick={() => setNewTableForm(f => ({...f, columns: [...f.columns, { name: 'new_col', type: 'VARCHAR', length: 255, decimal: undefined, notNull: false, virtual: false, isKey: false, comment: '' }]}))}>+ 添加字段</button>
              </div>
              <div className={`max-h-64 overflow-auto border rounded-lg ${isDark ? 'border-white/10 bg-[#0b1220]' : 'border-gray-200 bg-gray-50'}`}>
                {newTableForm.columns.map((col, idx) => (
                  <div key={idx} className={`grid grid-cols-8 gap-2 p-2 text-xs items-center border-b ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
                    <input className="px-2 py-1 rounded bg-white/5 border border-white/10" placeholder="列名" value={col.name} onChange={e => {const n=[...newTableForm.columns]; n[idx].name=e.target.value; setNewTableForm(f=>({...f, columns:n}))}} />
                    <select className="px-2 py-1 rounded bg-white/5 border border-white/10" value={col.type} onChange={e => {const n=[...newTableForm.columns]; n[idx].type=e.target.value; setNewTableForm(f=>({...f, columns:n}))}}>
                      {['BIGINT','INTEGER','VARCHAR','TEXT','DATE','DATETIME','DECIMAL','BOOLEAN'].map(t=> <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input className="px-2 py-1 rounded bg-white/5 border border-white/10" placeholder="长度" type="number" value={col.length ?? ''} onChange={e => {const n=[...newTableForm.columns]; n[idx].length= e.target.value ? Number(e.target.value) : undefined; setNewTableForm(f=>({...f, columns:n}))}} />
                    <input className="px-2 py-1 rounded bg-white/5 border border-white/10" placeholder="小数" type="number" value={col.decimal ?? ''} onChange={e => {const n=[...newTableForm.columns]; n[idx].decimal= e.target.value ? Number(e.target.value) : undefined; setNewTableForm(f=>({...f, columns:n}))}} />
                    <input className="px-2 py-1 rounded bg-white/5 border border-white/10" placeholder="注释" value={col.comment} onChange={e => {const n=[...newTableForm.columns]; n[idx].comment=e.target.value; setNewTableForm(f=>({...f, columns:n}))}} />
                    <label className="flex items-center gap-1 justify-center"><input type="checkbox" checked={col.notNull} onChange={e => {const n=[...newTableForm.columns]; n[idx].notNull=e.target.checked; setNewTableForm(f=>({...f, columns:n}))}} />非空</label>
                    <label className="flex items-center gap-1 justify-center"><input type="checkbox" checked={col.isKey} onChange={e => {const n=[...newTableForm.columns]; n[idx].isKey=e.target.checked; setNewTableForm(f=>({...f, columns:n}))}} />主键</label>
                    <button className="text-red-400 text-xs hover:underline" onClick={()=>setNewTableForm(f=>({...f, columns: f.columns.filter((_,i)=>i!==idx)}))}>删除</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={()=>setModals(m=>({...m, newTable:false}))} className="px-3 py-1.5 text-sm opacity-60">取消</button>
              <button onClick={handleCreateTable} className={`px-3 py-1.5 text-sm text-white rounded ${colors.bg}`}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
