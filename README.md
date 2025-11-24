# NovaDB AI 桌面版

跨平台数据库管理与 AI 助手，支持 MySQL / PostgreSQL / SQL Server 等，内置 Electron 封装，可生成 SQL、执行查询、生成插入语句等。

## 功能亮点
- 连接管理：保存多数据库连接，本地持久化。
- 结构浏览：展开库/表/视图，右键新建表/设计表结构/生成模拟数据（生成 INSERT 语句）。
- AI 助手：基于当前加载的真实 schema 生成 SQL，校验表存在后执行；支持 Gemini / OpenAI / DeepSeek / Ollama。
- 桌面封装：macOS/Windows（需对应平台打包），前端使用 Vite+React。

## 快速开始（开发）
```bash
npm install
# 开发模式
npm run dev -- --host 127.0.0.1 --port 4173
# 桌面调试
ELECTRON_START_URL=http://127.0.0.1:4173 npx electron electron/main.cjs
```

## 打包桌面应用
```bash
# 生成生产包
npm run build
# 生成桌面安装包（当前平台）
npm run desktop:build
```
产物位置：
- macOS: `dist/mac-arm64/NovaDB.app`，安装包 `dist/NovaDB-<version>-arm64.dmg`
- Windows: 需在 Windows 环境或 CI 打包。

## AI 配置
- 设置面板中选择模型提供者（Gemini / OpenAI / DeepSeek / Ollama）。
- 填写 Base URL（OpenAI: https://api.openai.com/v1；DeepSeek: https://api.deepseek.com/v1；Ollama: http://localhost:11434/v1）、API Key、模型名。
- 配置会本地持久化（与连接、主题一致）。

## 常见问题
- 空白界面 / 404：确保使用最新打包版本，`base: './'` 已设置；若仍空白，打开 DevTools 查看资源路径。
- AI 报错缺 Key：在设置中填入对应 API Key 或切换其他模型。
- 提示表不存在：先展开/刷新目标数据库，确保 schema 已加载再生成 SQL。
- 模拟数据生成：右键表 -> 生成模拟数据，SQL 编辑器将填入 INSERT 语句，可直接运行。

## 目录结构（关键部分）
- `index.tsx`：主界面与逻辑（连接、AI、查询、弹窗等）
- `electron/`：桌面主进程、预加载、DB 访问逻辑
- `vite.config.ts`：构建配置（base 设置为相对路径）
- `dist/`：构建/打包输出
