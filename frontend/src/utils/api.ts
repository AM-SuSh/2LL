/**
 * Dev: 留空使用 Vite 代理 `/api` → 后端
 * Prod: 在 `.env.production` 设置 `VITE_API_BASE_URL=https://your-api.example.com`
 */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}
