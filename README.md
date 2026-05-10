# 双栏中英 Markdown 编辑器

左栏中文、右栏英文的 Web 端 md编辑器，支持一键 LLM 翻译填充，以及导出PDF。

## 结构

- `frontend/` — React + TypeScript + Vite + Monaco
- `backend/` — FastAPI 翻译接口（OpenAI 兼容 API）

## 快速开始

### 后端

```bash
cd backend
conda create -n 2ll python=3.9
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
- **LLM 翻译填充**：将中文栏内容翻译后写入英文栏（调试中）
- **预览页面**：双语 PDF 文件预览
- **导出 PDF**：基于预览区域生成 PDF 文件
- **同步滚动**：对齐中英文两栏同步滚动

## 优化计划
-[ ] 样式优化
-[ ] 支持未编辑完文件保存到本地
-[ ] 支持导入本地文件继续编辑
-[ ] 支持预览页的图片正常显示
-[ ] 优化图片插入逻辑
-[ ] 支持公式等内容插入

