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
    timerStart: null,
    timerPaused: 0,
    timerState: row.dur_actual != null ? 'done' : 'idle',
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
    // 只同步活跃任务和模板。state.done 是当日 UX，跨日重置，不进云端。
    const rows = state.tasks
      .filter(t => isUuid(t.id))
      .map(taskToRow);
    if (rows.length > 0) {
      const { error } = await sb.from('tasks').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
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
    const { data: rows, error } = await sb
      .from('tasks')
      .select('*')
      .eq('user_id', cloudUser.id)
      .is('deleted_at', null);
    if (error) throw error;

    const { data: tplRows } = await sb
      .from('recur_templates')
      .select('*')
      .eq('user_id', cloudUser.id);

    mergeCloudTasks(rows || []);
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
        Object.assign(local, cloudT);
      }
    }
  });
  // 云端已删除的任务（不在 rows 里）保留在本地，不强行删除，避免误删用户当前正在编辑的任务
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
    if (row.deleted_at) {
      state.tasks = state.tasks.filter(t => t.id !== row.id);
      state.done = state.done.filter(t => t.id !== row.id);
    } else {
      const cloudT = rowToTask(row);
      const existing = findTask(row.id);
      if (existing) Object.assign(existing, cloudT);
      else state.tasks.push(cloudT);
    }
    saveState({ skipCloudSync: true });
    render();
  } else if (ev === 'DELETE') {
    const id = payload.old && payload.old.id;
    if (id) {
      state.tasks = state.tasks.filter(t => t.id !== id);
      state.done = state.done.filter(t => t.id !== id);
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
      .is('deleted_at', null);
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
