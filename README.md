# SQLSense 桌面版

跨平台的数据库管理与 AI 助手，支持 MySQL / PostgreSQL / SQL Server 等，内置 Electron 封装，可生成 SQL、执行查询、生成插入语句等。

![界面预览](public/static/introduction.png)

## 功能亮点
- **连接管理**：保存多数据库连接，本地持久化。
- **结构浏览**：树状视图展开库表，右键新建表 / 设计表结构 / 生成模拟数据（INSERT SQL）。
- **AI 助手**：基于当前已加载的真实 schema 生成 SQL，校验表存在后执行；支持 Gemini / OpenAI / DeepSeek / Ollama。
- **桌面封装**：macOS / Windows（需对应平台打包），前端使用 Vite + React。
- **图表支持**：AI 可返回 ECharts 配置或只返回 SQL，应用会尝试执行并自动生成图表。

## 开发快跑
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
- macOS: `dist/mac-arm64/SQLSense.app`，安装包 `dist/SQLSense-<version>-arm64.dmg`
- Windows: 需在 Windows 环境或 CI 打包。

## AI 配置
- 在设置面板选择模型提供者（Gemini / OpenAI / DeepSeek / Ollama）。
- 填写 Base URL（OpenAI: `https://api.openai.com/v1`; DeepSeek: `https://api.deepseek.com/v1`; Ollama: `http://localhost:11434/v1`）、API Key、模型名。
- 配置会本地持久化（与连接、主题一致）。

## 常见问题
- **空白界面 / 404**：确保使用最新打包版本；`base: './'` 已设置，若仍空白可打开 DevTools 查看资源路径。
- **AI 报错缺 Key**：在设置中填写对应 API Key 或切换其他模型。
- **提示表不存在**：先展开/刷新目标数据库，确保 schema 已加载再生成 SQL。
- **模拟数据生成**：右键表 -> 生成模拟数据，SQL 编辑器会填入 INSERT 语句，可直接运行。

## 目录结构（关键部分）
- `index.tsx`：主界面与逻辑（连接、AI、查询、弹窗等）
- `electron/`：桌面主进程、预加载、数据库访问逻辑
- `vite.config.ts`：构建配置（base 设为相对路径）
- `dist/`：构建/打包输出
