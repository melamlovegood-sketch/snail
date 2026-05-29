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
let chatHistory = []; // [{role:'user'|'assistant', content:'...'}] —— 内存中，不持久化
let chatLoading = false;
let morningPlan = null;   // { advice, order, noKey?, loading? } —— 当日内存态
let lastOperation = null; // { snapshot, summary, ts } —— 上次自然语言操作的撤销快照
let checkInMode = false;  // 助手 tab 是否进入"今日复盘"模式
let focusPins = [];       // 今日专注的任务 id 列表（最多 3 个）
let focusHintSeen = false; // 是否已展示过首次引导（一次性）
let doneCollapsed = {};   // 各分组已完成任务折叠状态 { [groupKey]: true/false }
let aiEditingId = null;   // AI 配置当前正在编辑的 profile id；null 表示「新增配置」

/* ============== Supabase 云同步 ============== */
const SUPABASE_URL = 'https://ckwcobbuserktcjrmgly.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrd2NvYmJ1c2Vya3RjanJtZ2x5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Nzg5NDMsImV4cCI6MjA5NTQ1NDk0M30.WgN1IPGWX6R8-pA0Mp7kbMb7lRqVbZ3LrdWl6va-Grk';
let sb = null;  // Supabase client（重命名避免和 SDK 全局 window.supabase 冲突）
let cloudUser = null;          // { id, email }
let authStatus = 'unauth';     // 'unauth' | 'guest' | 'cloud'
let syncStatus = 'idle';       // 'idle' | 'synced' | 'syncing' | 'error' | 'offline'
let syncDebounceTimer = null;
let aiSyncDebounceTimer = null;  // AI 配置云同步去抖
let realtimeChannel = null;

/* ---------------- 工具函数 ---------------- */
