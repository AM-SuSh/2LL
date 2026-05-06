# 双栏中英 Markdown 编辑器

左栏中文、右栏英文的 Web 编辑器，支持一键 LLM 翻译填充，以及导出 Markdown 与 PDF。

## 结构

- `frontend/` — React + TypeScript + Vite + Monaco
- `backend/` — FastAPI 翻译接口（OpenAI 兼容 API）

## 快速开始

### 后端

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # 按需填写 API Key
uvicorn app.main:app --reload --port 8000
```

环境变量说明见 [backend/.env.example](backend/.env.example)。未配置 Key 时使用 **mock** 模式（本地演示翻译占位）。

### 前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开输出的地址（默认 `http://localhost:5173`）。开发时 Vite 会将 `/api` 代理到 `http://127.0.0.1:8000`。

## 功能

- 双栏独立编辑，内容可自动保存到浏览器 `localStorage`
- **LLM 翻译填充**：将中文栏内容翻译后写入英文栏
- **导出 MD**：双语 Markdown 文件下载
- **导出 PDF**：基于预览区域生成 PDF（A4 大致分页）

## 生产构建

```bash
cd frontend && npm run build
```

将 `frontend/dist` 交由静态服务器托管；生产环境需将 API 基础地址配置为实际后端（见 `frontend/.env.production.example`）。
