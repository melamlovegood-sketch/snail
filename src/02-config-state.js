const QWEN_URL = 'https://snail-api.friday0.top/api/qwen';
const AI_CONFIG_DEFAULTS = { provider: 'qwen', apiKey: '', model: 'qwen-plus', baseURL: '', visionModel: 'qwen-vl-plus' };
const AI_PROVIDER_LABELS = { qwen: '千问', deepseek: 'DeepSeek', openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini', custom: '自定义 / 中转站' };

/**
 * AI 模型配置支持多套并存：
 * - 新存储键 'aiProfiles' = { active: <id>, profiles: [{ id, name, provider, apiKey, baseURL, model, visionModel }] }
 * - 旧键 'aiConfig'（单套配置）会在首次读取时自动迁移成一条 profile，迁移后仍保留旧键作备份。
 * - getAiConfig() 始终返回「当前选中」的那套配置，因此所有调用方无需改动。
 */
function loadAiProfiles() {
  try {
    const r = localStorage.getItem('aiProfiles');
    if (r) {
      const o = JSON.parse(r);
      if (o && Array.isArray(o.profiles)) return { active: o.active || (o.profiles[0] && o.profiles[0].id) || '', profiles: o.profiles };
    }
  } catch(_) {}
  // 从旧的单套 aiConfig 迁移
  try {
    const old = localStorage.getItem('aiConfig');
    if (old) {
      const c = JSON.parse(old) || {};
      const id = uid();
      const prof = { id, name: AI_PROVIDER_LABELS[c.provider] || '默认配置', ...AI_CONFIG_DEFAULTS, ...c };
      const data = { active: id, profiles: [prof] };
      saveAiProfiles(data);
      return data;
    }
  } catch(_) {}
  return { active: '', profiles: [] };
}
function saveAiProfiles(data) {
  try { localStorage.setItem('aiProfiles', JSON.stringify(data)); } catch(_) {}
  // 已登录则把 AI 配置一并同步到云端（含 API Key，全量同步）
  try { if (typeof scheduleAiCloudSync === 'function') scheduleAiCloudSync(); } catch(_) {}
}
function getAiConfig() {
  const { active, profiles } = loadAiProfiles();
  const p = profiles.find(x => x.id === active) || profiles[0];
  if (p) return { ...AI_CONFIG_DEFAULTS, ...p };
  return { ...AI_CONFIG_DEFAULTS };
}

/* ---------------- 全局状态 ---------------- */
const DEFAULT_STATE = {
  tasks: [],
  done: [],
  archive: [],          // 所有已完成任务的永久归档（跨日保留，同步云端）；done 仅当日 UX
  recurTemplates: [],
  recurDoneLog: {},
  favorites: [],
  lastDate: '',
  theme: 'auto',
  userApiKey: '',                 // 用户在设置页填写的覆盖项
  rolloverWarnThreshold: 2,       // 拖延预警阈值 1/2/3
  lastMorningPlanDate: '',        // 上次显示早间规划助手的日期
  cloudUserEmail: '',             // 云端登录用户的 email（仅展示用）
  cloudPreference: '',             // '' / 'guest' / 'cloud' —— 用户选择记忆
  syncQueue: [],                   // 离线队列（暂存待同步 task id）
  deletedRecurIds: []              // 本地已删除的循环模板 ID，防止同步时云端复活
};

let state;  // 初始化延后到 03-utils.js 末尾（loadState 定义之后；拆分多文件后函数提升不跨 <script>）
let currentTab = 'plans';
let activePopover = null;
let timerInterval = null;
let statView = 'day'; // day | week | month
let chartInstances = {};
const CHAT_HISTORY_KEY = 'chronos_chat_history';            // 旧版单对话键（仅用于一次性迁移）
const CHAT_CONVERSATIONS_KEY = 'chronos_chat_conversations'; // 新版多对话存储
const CHAT_HISTORY_LIMIT = 200; // 单个对话最多保留 N 条消息
const CHAT_CONV_LIMIT = 50;     // 最多保留 N 个对话（超出按最近更新裁剪）

function nowISO() { return new Date().toISOString(); }

// 新建一个对话对象
function makeConversation(messages) {
  return {
    id: uid(),
    title: '',
    messages: Array.isArray(messages) ? messages : [],
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
}

// 读取多对话存储；兼容旧版单对话数组，全新用户则建一个空对话
function loadChatConversations() {
  // 1) 新版多对话存储
  try {
    const raw = localStorage.getItem(CHAT_CONVERSATIONS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.conversations) && o.conversations.length > 0) {
        const conversations = o.conversations.filter(c => c && c.id && Array.isArray(c.messages));
        if (conversations.length > 0) {
          const activeId = (o.activeId && conversations.some(c => c.id === o.activeId))
            ? o.activeId : conversations[0].id;
          return { conversations, activeId, deletedIds: Array.isArray(o.deletedIds) ? o.deletedIds : [] };
        }
      }
    }
  } catch(_) {}
  // 2) 从旧版单对话迁移
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        const conv = makeConversation(arr);
        return { conversations: [conv], activeId: conv.id, deletedIds: [] };
      }
    }
  } catch(_) {}
  // 3) 全新用户：建一个空对话
  const conv = makeConversation([]);
  return { conversations: [conv], activeId: conv.id, deletedIds: [] };
}

// 取当前激活对话（容错：丢失时回退第一个 / 新建）
function getActiveConversation() {
  let c = chatConversations.find(x => x.id === activeConvId);
  if (!c) {
    if (chatConversations.length === 0) chatConversations.push(makeConversation([]));
    c = chatConversations[0];
    activeConvId = c.id;
  }
  return c;
}

// 对话标题：用户未命名时取首条用户消息（截断）
function deriveConvTitle(conv) {
  if (conv && conv.title && conv.title.trim()) return conv.title.trim();
  const firstUser = (conv && conv.messages || []).find(m => m.role === 'user' && m.content && m.content.trim());
  if (firstUser) {
    const t = firstUser.content.trim().replace(/\s+/g, ' ');
    return t.length > 20 ? t.slice(0, 20) + '…' : t;
  }
  // 没有文字、但发过图片的对话
  if ((conv && conv.messages || []).some(m => m.role === 'user' && (m.image || m.hasImage))) return '图片对话';
  return '新对话';
}

// 对话是否有实际内容（任意一条消息含文字或图片）。空对话不入库、不进历史列表。
function convHasContent(conv) {
  return !!(conv && Array.isArray(conv.messages) && conv.messages.some(m =>
    m && ((typeof m.content === 'string' && m.content.trim()) || m.image || m.hasImage)
  ));
}

// 只含有实际内容的对话（用于历史列表与计数；当前的空白草稿对话不计入）
function contentConversations() {
  return (chatConversations || []).filter(convHasContent);
}

// 持久化整个多对话存储到 localStorage
function persistChatConversations() {
  try {
    // 丢弃没有任何内容的空对话；保留当前激活的草稿对话（仅在内存中，不落盘），
    // 这样新建的「新对话」不会污染历史列表，也不会被存到本地/云端。
    chatConversations = chatConversations.filter(c => convHasContent(c) || c.id === activeConvId);
    if (chatConversations.length > CHAT_CONV_LIMIT) {
      chatConversations.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      chatConversations = chatConversations.slice(0, CHAT_CONV_LIMIT);
    }
    localStorage.setItem(CHAT_CONVERSATIONS_KEY, JSON.stringify({
      conversations: chatConversations.filter(convHasContent), // 空草稿不入库
      activeId: activeConvId,
      deletedIds: (chatDeletedConvIds || []).slice(-200)
    }));
  } catch(_) {}
}

// 把当前 chatHistory（=激活对话的消息）写回对话对象、持久化并触发云同步。
// 所有重新赋值 chatHistory 的地方，随后调用本函数即可保持存储一致。
function saveChatHistory() {
  // 原地裁剪，保持 chatHistory 与 conv.messages 的引用一致
  if (chatHistory.length > CHAT_HISTORY_LIMIT) {
    chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_LIMIT);
  }
  const conv = getActiveConversation();
  conv.messages = chatHistory;
  conv.updatedAt = nowISO();
  if (!conv.title || !conv.title.trim() || conv.title === '新对话') {
    const t = deriveConvTitle(conv);
    if (t && t !== '新对话') conv.title = t;
  }
  persistChatConversations();
  // 触发云同步（debounce）
  try { if (typeof scheduleChatHistoryCloudSync === 'function') scheduleChatHistoryCloudSync(); } catch(_) {}
}

// 开启一个新对话（不渲染）。若当前激活对话已是空对话则复用，避免堆积空壳。
function startNewConversationSilent(title) {
  const act = chatConversations.find(c => c.id === activeConvId);
  if (act && (!act.messages || act.messages.length === 0)) {
    if (title) act.title = title;
    chatHistory = act.messages;
    persistChatConversations();
    return act;
  }
  const conv = makeConversation([]);
  if (title) conv.title = title;
  chatConversations.unshift(conv);
  activeConvId = conv.id;
  chatHistory = conv.messages;
  persistChatConversations();
  return conv;
}

// 以下变量初始化延后到 03-utils.js（uid() 在那里才可用）
let chatConversations;   // 多对话数组 [{ id, title, messages, createdAt, updatedAt }]
let activeConvId;        // 当前激活对话 id
let chatDeletedConvIds;  // 已删除对话 id 墓碑（防止云端复活）
let chatHistory;         // 指向当前激活对话的 messages（活动引用）
let chatLoading = false;
let convDropdownOpen = false; // 历史对话下拉是否展开
let morningPlan = null;   // { advice, order, noKey?, loading? } —— 当日内存态
let lastOperation = null; // { snapshot, summary, ts } —— 上次自然语言操作的撤销快照
let checkInMode = false;  // 助手 tab 是否进入"今日复盘"模式
let focusPins = [];       // 今日专注的任务 id 列表（最多 3 个）
let focusHintSeen = false; // 是否已展示过首次引导（一次性）
let doneCollapsed = {};   // 各分组已完成任务折叠状态 { [groupKey]: true/false }
let aiEditingId = null;   // AI 配置当前正在编辑的 profile id；null 表示「新增配置」

/* ============== 应用版本 ============== */
// 设置页「关于」展示此版本号。约定：每次创建新 PR 时递增此值，并同步 package.json 的 version（见 CLAUDE.md）。
const APP_VERSION = '1.4.1';

/* ============== Supabase 云同步 ============== */
const SUPABASE_URL = 'https://ckwcobbuserktcjrmgly.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrd2NvYmJ1c2Vya3RjanJtZ2x5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Nzg5NDMsImV4cCI6MjA5NTQ1NDk0M30.WgN1IPGWX6R8-pA0Mp7kbMb7lRqVbZ3LrdWl6va-Grk';
let sb = null;  // Supabase client（重命名避免和 SDK 全局 window.supabase 冲突）
let cloudUser = null;          // { id, email }
let authStatus = 'unauth';     // 'unauth' | 'guest' | 'cloud'
let syncStatus = 'idle';       // 'idle' | 'synced' | 'syncing' | 'error' | 'offline'
let syncDebounceTimer = null;
let aiSyncDebounceTimer = null;  // AI 配置云同步去抖
let chatSyncDebounceTimer = null; // 对话历史云同步去抖
let snailSyncDebounceTimer = null; // 蜗牛旅程（里程+成就）云同步去抖
let realtimeChannel = null;

/* ---------------- 工具函数 ---------------- */
