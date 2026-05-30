function initSupabase() {
  if (sb) return true;
  if (!window.supabase || !window.supabase.createClient) return false;
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return true;
  } catch(e) {
    console.warn('[Cloud] init failed:', e);
    return false;
  }
}

/* ---- 字段映射 ---- */
function taskToRow(t) {
  return {
    id: isUuid(t.id) ? t.id : uid(),
    user_id: cloudUser ? cloudUser.id : null,
    task_desc: t.desc || '',
    cat: t.cat || 'C',
    priority: t.priority || 'normal',
    task_date: t.date || todayStr(),
    deadline: t.deadline || null,
    start_time: t.startTime || null,
    dur_plan: t.durPlan || 60,
    dur_actual: t.durActual ?? null,
    segments: Array.isArray(t.segments) ? t.segments : [],
    notes: t.notes || '',
    favorited: !!t.favoriteId,
    recur_id: (t.recurId && isUuid(t.recurId)) ? t.recurId : null,
    is_recur: !!t.isRecur,
    rollover_count: t.rolloverCount || 0,
    reminder_enabled: t.reminderEnabled !== false,
    reminder_override: (t.reminderOverride != null) ? t.reminderOverride : null,
    updated_at: new Date().toISOString()
  };
}
function rowToTask(row) {
  return {
    id: row.id,
    desc: row.task_desc || '',
    cat: row.cat || 'C',
    priority: row.priority || 'normal',
    date: row.task_date,
    startTime: row.start_time || null,
    deadline: row.deadline || null,
    durPlan: row.dur_plan || 60,
    durActual: row.dur_actual ?? null,
    segments: Array.isArray(row.segments) ? row.segments : [],
    timerStart: null,
    timerPaused: 0,
    timerState: deriveTimerState({ durActual: row.dur_actual ?? null, segments: Array.isArray(row.segments) ? row.segments : [] }),
    rollover: false,
    recurId: row.recur_id || null,
    isRecur: !!row.is_recur,
    priorityManualOverride: false,
    deadlineUrgencyApplied: false,
    notes: row.notes || '',
    favoriteId: row.favorited ? row.id : null,
    rolloverCount: row.rollover_count || 0,
    reminderEnabled: row.reminder_enabled !== false,
    reminderOverride: row.reminder_override ?? null,
    originalDate: null,
    decomposed: false,
    sortOrder: null,
    _updatedAt: row.updated_at || null
  };
}
function tplToRow(tpl) {
  const freq = tpl.days && tpl.days.length === 7 ? 'daily' : 'weekly';
  return {
    id: isUuid(tpl.id) ? tpl.id : uid(),
    user_id: cloudUser ? cloudUser.id : null,
    template_desc: tpl.desc || '',
    cat: tpl.cat || 'C',
    freq,
    weekdays: Array.isArray(tpl.days) ? tpl.days : [],
    dur: tpl.durPlan || 60
  };
}
function rowToTpl(row) {
  return {
    id: row.id,
    desc: row.template_desc || '',
    cat: row.cat || 'C',
    priority: 'normal',
    durPlan: row.dur || 60,
    startTime: null,
    days: Array.isArray(row.weekdays) ? row.weekdays : (row.freq === 'daily' ? [0,1,2,3,4,5,6] : [1]),
    notes: '',
    createdAt: row.created_at ? row.created_at.slice(0,10) : todayStr()
  };
}

/* ---- 同步状态指示器 ---- */
function updateSyncIndicator() {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  dot.className = 'sync-dot ' + syncStatus;
  const titles = {
    idle: '点击同步',
    syncing: '同步中…',
    synced: '已同步',
    offline: '离线，待恢复后自动同步',
    error: '同步失败，点击重试'
  };
  dot.title = titles[syncStatus] || '同步';
}

/* ---- 推送：把当前 state 整体 upsert 到云端 ---- */
async function pushAllToCloud() {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  if (!navigator.onLine) { syncStatus = 'offline'; updateSyncIndicator(); return; }

  syncStatus = 'syncing'; updateSyncIndicator();

  try {
    // 活跃任务 + 已完成归档都同步。state.done 仅当日 UX，跨日重置，归档由 state.archive 承载。
    const rows = state.tasks
      .filter(t => isUuid(t.id))
      .map(taskToRow);
    if (rows.length > 0) {
      const { error } = await sb.from('tasks').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }
    // 归档任务（dur_actual 已写入；deleted_at 不在 taskToRow 中，upsert 不会动它，保持 null）
    const archiveRows = (state.archive || [])
      .filter(t => isUuid(t.id))
      .map(taskToRow);
    if (archiveRows.length > 0) {
      const { error: eArc } = await sb.from('tasks').upsert(archiveRows, { onConflict: 'id' });
      if (eArc) console.warn('[Cloud] archive upsert:', eArc);
    }
    // 循环模板
    const tplRows = state.recurTemplates
      .filter(tpl => isUuid(tpl.id))
      .map(tplToRow);
    if (tplRows.length > 0) {
      const { error: e2 } = await sb.from('recur_templates').upsert(tplRows, { onConflict: 'id' });
      if (e2) console.warn('[Cloud] tpl upsert:', e2);
    }
    syncStatus = 'synced';
  } catch(e) {
    console.warn('[Cloud] push failed:', e);
    syncStatus = 'error';
  }
  updateSyncIndicator();
}

function scheduleCloudSync() {
  if (authStatus !== 'cloud') return;
  if (!navigator.onLine) { syncStatus = 'offline'; updateSyncIndicator(); return; }
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(pushAllToCloud, 600);
}

/* ---- 拉取：合并云端任务到本地 ---- */
async function syncFromCloud() {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  syncStatus = 'syncing'; updateSyncIndicator();
  try {
    // 活跃任务：未删除且未完成（dur_actual is null）
    const { data: rows, error } = await sb
      .from('tasks')
      .select('*')
      .eq('user_id', cloudUser.id)
      .is('deleted_at', null)
      .is('dur_actual', null);
    if (error) throw error;

    // 已完成归档：未删除且 dur_actual 已写入
    const { data: archiveRows } = await sb
      .from('tasks')
      .select('*')
      .eq('user_id', cloudUser.id)
      .is('deleted_at', null)
      .not('dur_actual', 'is', null);

    const { data: tplRows } = await sb
      .from('recur_templates')
      .select('*')
      .eq('user_id', cloudUser.id);

    mergeCloudTasks(rows || []);
    mergeCloudArchive(archiveRows || []);
    mergeCloudTemplates(tplRows || []);
    saveState({ skipCloudSync: true });
    render();
    syncStatus = 'synced';
  } catch(e) {
    console.warn('[Cloud] pull failed:', e);
    syncStatus = 'error';
  }
  updateSyncIndicator();
}

// 计时状态（segments）现在是跨设备同步的真相源：云端较新时整体覆盖本地。
// 冲突由 mergeCloudTasks 的 cloudUpd>localUpd 决定；本地计时动作已 stampLocalEdit，
// 其 _updatedAt 比自己旧的云端回声更新，不会被覆盖，因而能正确做 last-write-wins。
function applyCloudToLocal(local, cloudT) {
  Object.assign(local, cloudT);
}

function mergeCloudTasks(rows) {
  const localById = {};
  state.tasks.forEach(t => { localById[t.id] = { arr: 'tasks', task: t }; });

  rows.forEach(row => {
    const cloudT = rowToTask(row);
    const found = localById[row.id];
    if (!found) {
      // 新任务，直接加入
      state.tasks.push(cloudT);
    } else {
      const local = found.task;
      const cloudUpd = new Date(row.updated_at || 0).getTime();
      const localUpd = new Date(local._updatedAt || 0).getTime();
      if (cloudUpd > localUpd) {
        applyCloudToLocal(local, cloudT);
      }
    }
  });
  // 云端已删除的任务（不在 rows 里）保留在本地，不强行删除，避免误删用户当前正在编辑的任务
}

function mergeCloudArchive(rows) {
  if (!state.archive) state.archive = [];
  const localById = {};
  state.archive.forEach(t => { localById[t.id] = t; });
  rows.forEach(row => {
    const cloudT = rowToTask(row);       // dur_actual 已写入 → timerState:'done'
    const local = localById[row.id];
    if (!local) {
      state.archive.push(cloudT);
      localById[cloudT.id] = cloudT;
    } else {
      const cloudUpd = new Date(row.updated_at || 0).getTime();
      const localUpd = new Date(local._updatedAt || 0).getTime();
      if (cloudUpd > localUpd) Object.assign(local, cloudT);
    }
    // 已完成任务不应再留在活跃列表
    state.tasks = state.tasks.filter(t => t.id !== row.id);
  });
}

function mergeCloudTemplates(rows) {
  const localIds = new Set(state.recurTemplates.map(t => t.id));
  const deletedIds = new Set(state.deletedRecurIds || []);
  rows.forEach(row => {
    // 跳过本地已明确删除的模板，避免云端复活
    if (deletedIds.has(row.id)) return;
    if (!localIds.has(row.id)) {
      state.recurTemplates.push(rowToTpl(row));
    }
  });
}

/* ---- 完成单个任务 → 云端归档（带 dur_actual，deleted_at 保持 null） ---- */
async function cloudArchiveTask(t) {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  if (!isUuid(t.id)) return;
  if (!navigator.onLine) { syncStatus = 'offline'; updateSyncIndicator(); return; }
  try {
    await sb.from('tasks').upsert(taskToRow(t), { onConflict: 'id' });
  } catch(e) {
    console.warn('[Cloud] archive task failed:', e);
  }
}

/* ---- 取消完成 → 云端恢复为活跃任务（清除 dur_actual 与 deleted_at） ---- */
async function cloudUnarchiveTask(t) {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  if (!isUuid(t.id)) return;
  if (!navigator.onLine) { syncStatus = 'offline'; updateSyncIndicator(); return; }
  try {
    await sb.from('tasks').upsert(
      { ...taskToRow(t), dur_actual: null, deleted_at: null },
      { onConflict: 'id' }
    );
  } catch(e) {
    console.warn('[Cloud] unarchive task failed:', e);
  }
}

/* ---- 软删除单个任务到云端 ---- */
async function cloudSoftDelete(taskId) {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  if (!isUuid(taskId)) return;
  if (!navigator.onLine) { syncStatus = 'offline'; updateSyncIndicator(); return; }
  try {
    await sb.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', taskId);
  } catch(e) {
    console.warn('[Cloud] soft delete failed:', e);
  }
}

/* ---- 删除循环模板到云端 ---- */
async function cloudDeleteRecurTemplate(tplId) {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  if (!isUuid(tplId)) return;
  if (!navigator.onLine) { syncStatus = 'offline'; updateSyncIndicator(); return; }
  try {
    await sb.from('recur_templates').delete().eq('id', tplId).eq('user_id', cloudUser.id);
  } catch(e) {
    console.warn('[Cloud] recur template delete failed:', e);
  }
}

/* ---- Realtime 订阅 ---- */
async function bootRealtime() {
  if (!sb || !cloudUser) return;
  await teardownRealtime();
  realtimeChannel = sb
    .channel('tasks-sync-' + cloudUser.id)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'tasks',
      filter: `user_id=eq.${cloudUser.id}`
    }, handleRealtimeChange)
    .subscribe();
}
async function teardownRealtime() {
  if (realtimeChannel && sb) {
    try { await sb.removeChannel(realtimeChannel); } catch(_) {}
    realtimeChannel = null;
  }
}
function handleRealtimeChange(payload) {
  if (!payload) return;
  const ev = payload.eventType;
  if (ev === 'INSERT' || ev === 'UPDATE') {
    const row = payload.new;
    if (!row) return;
    if (!state.archive) state.archive = [];
    if (row.deleted_at) {
      // 已删除：从所有列表移除
      state.tasks = state.tasks.filter(t => t.id !== row.id);
      state.done = state.done.filter(t => t.id !== row.id);
      state.archive = state.archive.filter(t => t.id !== row.id);
    } else if (row.dur_actual != null) {
      // 已完成：归档，并移出活跃列表
      const cloudT = rowToTask(row);
      state.tasks = state.tasks.filter(t => t.id !== row.id);
      const ai = state.archive.findIndex(t => t.id === row.id);
      if (ai >= 0) Object.assign(state.archive[ai], cloudT);
      else state.archive.push(cloudT);
    } else {
      // 活跃任务：从归档移回、upsert 到活跃列表
      const cloudT = rowToTask(row);
      state.archive = state.archive.filter(t => t.id !== row.id);
      const existing = findTask(row.id);
      if (existing) {
        // 仅当云端行更新时才覆盖，避免旧的实时回声清掉本地刚操作的计时（last-write-wins）
        const cloudUpd = new Date(row.updated_at || 0).getTime();
        const localUpd = new Date(existing._updatedAt || 0).getTime();
        if (cloudUpd >= localUpd) applyCloudToLocal(existing, cloudT);
      } else {
        state.tasks.push(cloudT);
      }
    }
    saveState({ skipCloudSync: true });
    render();
  } else if (ev === 'DELETE') {
    const id = payload.old && payload.old.id;
    if (id) {
      state.tasks = state.tasks.filter(t => t.id !== id);
      state.done = state.done.filter(t => t.id !== id);
      if (state.archive) state.archive = state.archive.filter(t => t.id !== id);
      saveState({ skipCloudSync: true });
      render();
    }
  }
}

/* ---- 认证 ---- */
async function bootAuth() {
  if (!initSupabase()) {
    // SDK 没加载成功 → 直接进入 guest 模式
    authStatus = 'guest';
    return;
  }
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session && data.session.user) {
      await enterCloudMode(data.session.user);
      return;
    }
  } catch(_) {}

  // 没有 session：看用户之前选择
  if (state.cloudPreference === 'guest') {
    authStatus = 'guest';
  } else {
    authStatus = 'unauth';
  }
}

async function loginWithEmail(email, password) {
  if (!sb) return { error: 'SDK 未加载' };
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  if (data && data.user) await enterCloudMode(data.user);
  return { ok: true };
}

async function registerWithEmail(email, password) {
  if (!sb) return { error: 'SDK 未加载' };
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return { error: error.message };
  if (data && data.user) {
    if (data.session) await enterCloudMode(data.user);
    else return { ok: true, needsConfirm: true };
  }
  return { ok: true };
}

async function enterCloudMode(user) {
  cloudUser = { id: user.id, email: user.email };
  authStatus = 'cloud';
  state.cloudUserEmail = user.email || '';
  state.cloudPreference = 'cloud';
  saveState({ skipCloudSync: true });
  hideAuthOverlay();
  syncStatus = 'syncing'; updateSyncIndicator();
  await checkMigration();
  await syncFromCloud();
  await syncAiProfilesFromCloud();
  await syncChatHistoryFromCloud();
  await bootRealtime();
  render();
  fetchIcalToken();
}

async function fetchIcalToken() {
  if (!sb || !cloudUser) return;
  try {
    const { data, error } = await sb
      .from('profiles')
      .upsert({ id: cloudUser.id }, { onConflict: 'id' })
      .select('ical_token')
      .single();
    if (error) { console.warn('[ical] profile upsert failed:', error); return; }
    if (data && data.ical_token) {
      cloudUser.icalToken = data.ical_token;
      if (currentTab === 'settings') renderSettings();
    }
  } catch (e) {
    console.warn('[ical] fetchIcalToken failed:', e);
  }
}

/* ---- AI 配置云同步（存于 profiles.ai_profiles，含 API Key 全量同步） ---- */
function scheduleAiCloudSync() {
  if (authStatus !== 'cloud') return;
  if (!navigator.onLine) return;
  clearTimeout(aiSyncDebounceTimer);
  aiSyncDebounceTimer = setTimeout(pushAiProfilesToCloud, 600);
}

async function pushAiProfilesToCloud() {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  if (!navigator.onLine) return;
  try {
    const data = loadAiProfiles();
    const { error } = await sb
      .from('profiles')
      .upsert({ id: cloudUser.id, ai_profiles: data }, { onConflict: 'id' });
    if (error) console.warn('[Cloud] push ai_profiles failed:', error);
  } catch(e) {
    console.warn('[Cloud] push ai_profiles failed:', e);
  }
}

// 登录后拉取云端 AI 配置，与本地按 profile id 合并（云端覆盖同 id）。
async function syncAiProfilesFromCloud() {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('ai_profiles')
      .eq('id', cloudUser.id)
      .single();
    if (error) { console.warn('[Cloud] pull ai_profiles failed:', error); return; }
    const cloud = data && data.ai_profiles;
    if (!cloud || !Array.isArray(cloud.profiles) || cloud.profiles.length === 0) {
      // 云端尚无 AI 配置：把本地的推上去（首次开启同步）
      if (loadAiProfiles().profiles.length > 0) await pushAiProfilesToCloud();
      return;
    }
    const local = loadAiProfiles();
    const byId = {};
    local.profiles.forEach(p => { byId[p.id] = p; });
    cloud.profiles.forEach(p => { if (p && p.id) byId[p.id] = p; }); // 云端覆盖同 id
    const merged = Object.values(byId);
    let active = cloud.active && merged.some(p => p.id === cloud.active) ? cloud.active
               : (local.active && merged.some(p => p.id === local.active) ? local.active
               : (merged[0] && merged[0].id) || '');
    saveAiProfiles({ active, profiles: merged });  // saveAiProfiles 会再推回云端，保证两端一致
    if (currentTab === 'settings') renderSettings();
  } catch(e) {
    console.warn('[Cloud] pull ai_profiles failed:', e);
  }
}

/* ---- 对话历史云同步（存于 profiles.chat_history） ---- */
function scheduleChatHistoryCloudSync() {
  if (authStatus !== 'cloud') return;
  if (!navigator.onLine) return;
  clearTimeout(chatSyncDebounceTimer);
  chatSyncDebounceTimer = setTimeout(pushChatHistoryToCloud, 1500);
}

async function pushChatHistoryToCloud() {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  if (!navigator.onLine) return;
  try {
    const payload = {
      version: 2,
      // 空对话不上云（节省免费存储空间）
      conversations: chatConversations.filter(convHasContent).map(c => ({
        id: c.id,
        title: c.title || '',
        createdAt: c.createdAt || null,
        updatedAt: c.updatedAt || null,
        messages: (c.messages || []).slice(-CHAT_HISTORY_LIMIT)
      })),
      activeId: activeConvId,
      deletedIds: (chatDeletedConvIds || []).slice(-200),
      savedAt: new Date().toISOString()
    };
    const { error } = await sb
      .from('profiles')
      .upsert({ id: cloudUser.id, chat_history: payload }, { onConflict: 'id' });
    if (error) console.warn('[Cloud] push chat_history failed:', error);
  } catch(e) {
    console.warn('[Cloud] push chat_history failed:', e);
  }
}

// 拉取并按对话合并：以 updatedAt 较新者为准，应用云端删除墓碑，反向也把本地变更推回。
async function syncChatHistoryFromCloud() {
  if (authStatus !== 'cloud' || !sb || !cloudUser) return;
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('chat_history')
      .eq('id', cloudUser.id)
      .single();
    if (error) { console.warn('[Cloud] pull chat_history failed:', error); return; }
    const cloud = data && data.chat_history;

    // 规范化云端数据：兼容旧版 { messages:[...] } 单对话格式
    let cloudConvs = [], cloudDeleted = [], cloudActive = null;
    if (cloud && Array.isArray(cloud.conversations)) {
      cloudConvs = cloud.conversations.filter(c => c && c.id && Array.isArray(c.messages));
      cloudDeleted = Array.isArray(cloud.deletedIds) ? cloud.deletedIds : [];
      cloudActive = cloud.activeId || null;
    } else if (cloud && Array.isArray(cloud.messages) && cloud.messages.length > 0) {
      cloudConvs = [{
        id: 'legacy-' + cloudUser.id,
        title: '',
        messages: cloud.messages,
        createdAt: cloud.savedAt || null,
        updatedAt: cloud.savedAt || null
      }];
    }

    // 云端无任何数据：把本地推上去（首次开启同步）
    const localHasContent = chatConversations.some(c => (c.messages || []).length > 0) || chatConversations.length > 1;
    if (cloudConvs.length === 0 && cloudDeleted.length === 0) {
      if (localHasContent) await pushChatHistoryToCloud();
      return;
    }

    let changed = false;

    // 1) 应用云端删除墓碑：本地移除这些对话并记录墓碑
    cloudDeleted.forEach(id => {
      if (!chatDeletedConvIds.includes(id)) { chatDeletedConvIds.push(id); changed = true; }
      const i = chatConversations.findIndex(c => c.id === id);
      if (i >= 0) { chatConversations.splice(i, 1); changed = true; }
    });

    // 2) 按 id 合并云端对话（updatedAt 较新者为准；本地已删的不复活）
    const localById = {};
    chatConversations.forEach(c => { localById[c.id] = c; });
    cloudConvs.forEach(cc => {
      if (chatDeletedConvIds.includes(cc.id)) return;
      const local = localById[cc.id];
      if (!local) {
        const conv = {
          id: cc.id,
          title: cc.title || '',
          messages: Array.isArray(cc.messages) ? cc.messages : [],
          createdAt: cc.createdAt || cc.updatedAt || nowISO(),
          updatedAt: cc.updatedAt || nowISO()
        };
        chatConversations.push(conv);
        localById[cc.id] = conv;
        changed = true;
      } else {
        const cu = new Date(cc.updatedAt || 0).getTime();
        const lu = new Date(local.updatedAt || 0).getTime();
        if (cu > lu) {
          local.title = cc.title || local.title;
          local.messages = Array.isArray(cc.messages) ? cc.messages : local.messages;
          local.updatedAt = cc.updatedAt || local.updatedAt;
          if (local.id === activeConvId) chatHistory = local.messages; // 重新绑定活动引用
          changed = true;
        }
      }
    });

    // 2.5) 若本地当前激活对话是空对话，而云端指定了有效的激活对话，则跟随云端
    //      （刚登录时让用户落在云端的最近对话，而非本地的空白对话）
    const curActive = chatConversations.find(c => c.id === activeConvId);
    if (cloudActive && (!curActive || (curActive.messages || []).length === 0)
        && chatConversations.some(c => c.id === cloudActive)) {
      activeConvId = cloudActive;
      chatHistory = getActiveConversation().messages;
      changed = true;
    }

    // 3) 兜底：至少保留一个对话，且 activeConvId 有效
    if (chatConversations.length === 0) {
      const conv = makeConversation([]);
      chatConversations.push(conv);
      activeConvId = conv.id;
      chatHistory = conv.messages;
      changed = true;
    }
    if (!chatConversations.some(c => c.id === activeConvId)) {
      chatConversations.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      activeConvId = chatConversations[0].id;
      chatHistory = getActiveConversation().messages;
      changed = true;
    }

    if (changed) {
      persistChatConversations();
      if (currentTab === 'assistant') renderAssistant();
      // 把合并后的结果（含本地新对话/删除墓碑）推回云端，保证两端最终一致
      await pushChatHistoryToCloud();
    }
  } catch(e) {
    console.warn('[Cloud] pull chat_history failed:', e);
  }
}

function enterGuestMode() {
  authStatus = 'guest';
  state.cloudPreference = 'guest';
  saveState({ skipCloudSync: true });
  hideAuthOverlay();
  render();
}

async function logoutCloud() {
  if (!sb) return;
  await teardownRealtime();
  await sb.auth.signOut();
  cloudUser = null;
  authStatus = 'unauth';
  state.cloudUserEmail = '';
  state.cloudPreference = '';
  saveState({ skipCloudSync: true });
  showAuthOverlay();
  render();
}

async function checkMigration() {
  if (!cloudUser) return;
  const localActive = state.tasks.length;
  if (localActive === 0) return;
  // 看云端是否有该用户的任务
  try {
    const { count } = await sb
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', cloudUser.id)
      .is('deleted_at', null)
      .is('dur_actual', null);
    if ((count || 0) === 0) {
      // 云端为空，问用户是否上传本地数据
      const yes = confirm(`检测到本地有 ${localActive} 个任务，是否上传到云端开启同步？\n\n选「确定」上传\n选「取消」清空本地，使用云端（空）数据`);
      if (yes) {
        // 给非 UUID 的旧任务重新分配 UUID
        state.tasks.forEach(t => { if (!isUuid(t.id)) t.id = uid(); });
        state.recurTemplates.forEach(tpl => { if (!isUuid(tpl.id)) tpl.id = uid(); });
        await pushAllToCloud();
      } else {
        state.tasks = [];
        state.recurTemplates = [];
        saveState({ skipCloudSync: true });
      }
    }
  } catch(e) {
    console.warn('[Cloud] migration check failed:', e);
  }
}

function showAuthOverlay() {
  const ov = document.getElementById('auth-overlay');
  if (ov) ov.classList.remove('hidden');
}
function hideAuthOverlay() {
  const ov = document.getElementById('auth-overlay');
  if (ov) ov.classList.add('hidden');
}

/* ---------------- 主题 ---------------- */
