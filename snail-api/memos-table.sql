-- 快速备忘（记一笔）跨设备同步 —— Supabase 表结构
-- 在 Supabase SQL Editor 中执行一次即可。与 tasks / recur_templates 表并列。
-- 字段对应 src/06-cloud-auth.js 的 memoToRow() / rowToMemo()。

create table if not exists public.memos (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  content       text not null default '',
  pinned        boolean not null default false,
  archived      boolean not null default false,
  -- 备忘创建时间，沿用前端的毫秒时间戳（Date.now()），用于排序与展示
  created_at_ms bigint not null,
  -- 最后修改时间，冲突合并以此判定 last-write-wins
  updated_at    timestamptz not null default now()
);

create index if not exists memos_user_id_idx on public.memos (user_id);

-- 行级安全：用户只能读写自己的备忘
alter table public.memos enable row level security;

drop policy if exists "memos_select_own" on public.memos;
create policy "memos_select_own" on public.memos
  for select using (auth.uid() = user_id);

drop policy if exists "memos_insert_own" on public.memos;
create policy "memos_insert_own" on public.memos
  for insert with check (auth.uid() = user_id);

drop policy if exists "memos_update_own" on public.memos;
create policy "memos_update_own" on public.memos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "memos_delete_own" on public.memos;
create policy "memos_delete_own" on public.memos
  for delete using (auth.uid() = user_id);

-- 开启 Realtime（与 tasks 表一致，供 handleMemoRealtimeChange 订阅）
alter publication supabase_realtime add table public.memos;
