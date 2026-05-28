# 🐌 Snail · 每日计划

> 不是每天都能完成所有事，但每一步都算数。

**线上体验 →** [friday0.top](https://friday0.top)

---

## 这是什么？

Snail 是一个温柔对待拖延的日程管理 PWA。

大多数待办 App 都在催你——红色的逾期标记、越积越多的未完成任务、随时准备删掉你"失败"记录的清空按钮。Snail 不这样。

这里没有删除，只有推迟。任务没做完？没关系，明天见。拖了好几次？没关系，我们承认现实，慢慢来。你的每一个小进展都会化作蜗牛里程，悄悄累积，不会消失。

---

## ✨ 功能亮点

### 🗂️ 任务管理
- **左滑推迟**：推到明天、后天、下周一，随你选
- **今天先到这里**：一键把剩余任务都推到明天，温柔收工
- **承认现实模式**：任务被推迟 3 次后触发，帮你正视它真正的优先级

### 🐌 蜗牛里程
- 完成任务就积累里程，不因推迟而清零
- Header 随里程变化呈现五种状态，记录你慢慢前行的样子

### 🏅 成就系统
- 10 个里程碑，从第一步到长途跋涉
- 不是排行榜，只是给自己的小纪念

### 🤖 AI 助手
- 支持文字描述 → 自动解析成任务
- 支持截图上传 → AI 从图片中提取任务（通义千问 VL）

### ☁️ 云同步
- 基于 Supabase，多设备数据实时同步

### 📱 PWA
- 可添加到主屏幕，离线也能用
- 移动端手势友好

---

## 🛠️ 技术栈

| 模块 | 技术 |
|------|------|
| 前端 | 纯 HTML/CSS/JS，单文件 PWA |
| AI 解析 | 通义千问（文字：qwen-plus / 图片：qwen-vl-plus）|
| 云同步 | Supabase |
| 部署 | Cloudflare Pages + Vercel Edge Function（解决 CORS）|

---

## 🚀 自己部署

```bash
git clone https://github.com/your-username/snail-daily
```

**1. 部署 Vercel Edge Function（千问 API 代理）**

把 `api/` 目录部署到 Vercel，在项目 Settings → Environment Variables 中添加：

```
QWEN_API_KEY = 你的通义千问 API Key
```

**2. 配置 Supabase**

在 [supabase.com](https://supabase.com) 新建项目，然后在 `index.html` 中填入你的：
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

**3. 部署前端**

把 `index.html` 托管到任意静态服务（Cloudflare Pages、Vercel、GitHub Pages 均可）。

---

## 🐢 设计理念

> 蜗牛不是因为懒才慢，只是它本来就是这个速度。

Snail 的核心不是「提高效率」，而是**接受自己本来的节奏**。

- 不惩罚推迟，只是记录
- 不强调完成率，只累积前进的距离
- 慢慢来，比较快

---

## 📄 License

MIT
