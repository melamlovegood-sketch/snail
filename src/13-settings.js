function renderSettings() {
  const main = document.getElementById('main');
  const _icalR1 = parseInt(localStorage.getItem('ical_reminder_1') || '15', 10);
  const _icalR2 = parseInt(localStorage.getItem('ical_reminder_2') || '0', 10);
  const icalUrl = (cloudUser && cloudUser.icalToken)
    ? `https://snail-api.friday0.top/ical/${cloudUser.icalToken}?r1=${_icalR1}&r2=${_icalR2}`
    : '';
  main.innerHTML = `
    <div class="section-title">账号</div>
    <div class="settings-section">
      ${authStatus === 'cloud' ? `
        <div class="settings-row">
          <div>
            <div class="label">当前账号</div>
            <div class="desc">${escapeHtml(state.cloudUserEmail || '—')}</div>
          </div>
          <span class="sync-dot ${syncStatus}" style="cursor:default"></span>
        </div>
        <div class="settings-row">
          <div>
            <div class="label">手动同步</div>
            <div class="desc">把本地任务推到云端并拉取最新</div>
          </div>
          <button class="btn-secondary" onclick="manualSync()">立即同步</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="label">退出登录</div>
            <div class="desc">退出后回到登录页，本地数据保留</div>
          </div>
          <button class="btn-secondary" onclick="logoutCloud()" style="color:var(--pri-urgent-important)">退出</button>
        </div>
      ` : `
        <div class="settings-row">
          <div>
            <div class="label">未登录 — 数据仅存本地</div>
            <div class="desc">登录后可在多设备间自动同步</div>
          </div>
          <button class="btn-primary" onclick="showAuthOverlay()">立即登录</button>
        </div>
      `}
    </div>

    ${authStatus === 'cloud' && cloudUser && cloudUser.icalToken ? `
    <div class="section-title">日历订阅</div>
    <div class="settings-section">
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:10px">
        <div>
          <div class="label">订阅链接</div>
          <div class="desc">将带截止日期的任务同步到苹果日历、Google 日历等</div>
        </div>
        <div style="background:var(--bg-alt,#f5f5f5);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;word-break:break-all;color:var(--text-soft);font-family:monospace,sans-serif">${icalUrl}</div>
        <div style="display:flex;gap:8px">
          <button class="btn-secondary" id="copy-ical-link" style="flex:1">复制链接</button>
          <a href="${icalUrl.replace('https://', 'webcal://')}" class="btn-primary" style="flex:1;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center">添加到苹果日历</a>
        </div>
        <div style="font-size:11px;color:var(--text-faint,#aaa)">苹果日历 → 添加日历 → 订阅日历，粘贴此链接</div>
      </div>
    </div>
    <div class="section-title">提醒时间</div>
    <div class="settings-section">
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div class="label">第一次提醒</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalAddR1(1)">+1分钟</button>
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalAddR1(15)">+15分钟</button>
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalAddR1(60)">+1小时</button>
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalAddR1(1440)">+1天</button>
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalResetR1()">重置</button>
        </div>
        <div style="font-size:13px;color:var(--accent,#4f7cff)">${formatReminderLabel(_icalR1)}</div>
      </div>
      <div style="height:1px;background:var(--border);margin:2px 0"></div>
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="label" style="margin-bottom:0">第二次提醒</div>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
            <span style="font-size:12px;color:var(--text-soft)">${_icalR2 > 0 ? '已开启' : '已关闭'}</span>
            <input type="checkbox" onchange="icalToggleR2(this.checked)" ${_icalR2 > 0 ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent,#4f7cff)">
          </label>
        </div>
        ${_icalR2 > 0 ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalAddR2(1)">+1分钟</button>
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalAddR2(15)">+15分钟</button>
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalAddR2(60)">+1小时</button>
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalAddR2(1440)">+1天</button>
          <button class="btn-secondary" style="font-size:13px;padding:6px 10px" onclick="icalResetR2()">重置</button>
        </div>
        <div style="font-size:13px;color:var(--accent,#4f7cff)">${formatReminderLabel(_icalR2)}</div>
        ` : ''}
      </div>
    </div>
    ` : ''}

    <div class="section-title">外观</div>
    <div class="settings-section">
      <div class="settings-row">
        <div>
          <div class="label">主题</div>
          <div class="desc">深色/浅色/跟随系统</div>
        </div>
        <div class="seg-control">
          <button data-th="light" class="${state.theme==='light'?'active':''}">浅色</button>
          <button data-th="dark" class="${state.theme==='dark'?'active':''}">深色</button>
          <button data-th="auto" class="${state.theme==='auto'?'active':''}">跟随</button>
        </div>
      </div>
    </div>

    <div class="section-title">提醒</div>
    <div class="settings-section">
      <div class="settings-row">
        <div>
          <div class="label">拖延预警阈值</div>
          <div class="desc">任务滚入超过 N 天时显示橙色警告标签</div>
        </div>
        <div class="seg-control">
          <button data-roll="1" class="${(state.rolloverWarnThreshold||2)===1?'active':''}">1天</button>
          <button data-roll="2" class="${(state.rolloverWarnThreshold||2)===2?'active':''}">2天</button>
          <button data-roll="3" class="${(state.rolloverWarnThreshold||2)===3?'active':''}">3天</button>
        </div>
      </div>
    </div>

    <div class="section-title">AI 模型配置</div>
    <div class="settings-section">
      <div id="ai-profile-list" style="display:flex;flex-direction:column;gap:8px"></div>
      <button class="btn-secondary" id="ai-add-profile" style="align-self:flex-start;margin:10px 0 2px">+ 新增配置</button>
      <div class="settings-row" id="ai-edit-panel" style="display:none; flex-direction:column; align-items:stretch; gap:12px; border-top:1px solid var(--border); padding-top:14px; margin-top:4px">
        <div id="ai-edit-title" class="label" style="font-weight:600"></div>
        <div>
          <div class="label" style="margin-bottom:6px">配置名称</div>
          <input type="text" id="ai-name" placeholder="如 我的千问 / 公司中转站" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-family:PingFang SC,sans-serif;font-size:14px;box-sizing:border-box">
        </div>
        <div>
          <div class="label" style="margin-bottom:6px">供应商</div>
          <select id="ai-provider" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-family:PingFang SC,sans-serif;font-size:14px">
            <option value="qwen">千问（阿里云）</option>
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="custom">自定义 / 中转站</option>
          </select>
        </div>
        <div id="ai-baseurl-row" style="display:none">
          <div class="label" style="margin-bottom:6px">接口地址（baseURL）</div>
          <input type="text" id="ai-baseurl" placeholder="https://your-relay.com/v1" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-family:PingFang SC,sans-serif;font-size:14px;box-sizing:border-box">
          <div class="desc" style="margin-top:4px">中转站的 OpenAI 兼容接口地址，通常以 /v1 结尾</div>
        </div>
        <div>
          <div class="label" style="margin-bottom:6px">API Key</div>
          <div style="position:relative">
            <input type="password" id="ai-apikey" placeholder="sk-…" style="width:100%;padding:9px 36px 9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-family:PingFang SC,sans-serif;font-size:14px;box-sizing:border-box">
            <button id="ai-apikey-toggle" type="button" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-soft);font-size:13px;padding:4px;line-height:1">显示</button>
          </div>
        </div>
        <div>
          <div class="label" style="margin-bottom:6px">模型（文字）</div>
          <input type="text" id="ai-model" list="ai-model-list" placeholder="如 qwen-plus" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-family:PingFang SC,sans-serif;font-size:14px;box-sizing:border-box">
          <datalist id="ai-model-list"></datalist>
        </div>
        <div>
          <div class="label" style="margin-bottom:6px">视觉模型（图片解析）</div>
          <input type="text" id="ai-vision-model" list="ai-vision-list" placeholder="如 qwen-vl-plus" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-family:PingFang SC,sans-serif;font-size:14px;box-sizing:border-box">
          <datalist id="ai-vision-list"></datalist>
          <div class="desc" style="margin-top:4px">截图解析任务时使用，必须填支持多模态（识图）的模型</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
          <button class="btn-secondary" id="cancel-ai-edit" style="display:none">取消</button>
          <button class="btn-primary" id="save-ai-config">保存</button>
        </div>
      </div>
    </div>

    <div class="section-title">数据</div>
    <div class="settings-section">
      <div class="settings-row">
        <div><div class="label">导出备份</div><div class="desc">下载所有数据为 JSON 文件</div></div>
        <button class="btn-secondary" id="export-data">导出</button>
      </div>
      <div class="settings-row">
        <div><div class="label">导入恢复</div><div class="desc">从 JSON 文件恢复数据（覆盖当前）</div></div>
        <button class="btn-secondary" id="import-data">导入</button>
      </div>
      <div class="settings-row">
        <div><div class="label">清空所有数据</div><div class="desc">不可恢复，请谨慎</div></div>
        <button class="btn-secondary" id="clear-data" style="color:var(--pri-urgent-important)">清空</button>
      </div>
    </div>

    <div class="section-title">收藏任务</div>
    <div class="settings-section">
      <div id="fav-list" style="padding: 8px 0">
        ${state.favorites.length === 0 ? '<div class="settings-row text-soft">还没有收藏</div>' :
          state.favorites.map(f => `
            <div class="fav-row">
              <div>
                <div class="fav-desc">${escapeHtml(f.desc)}</div>
                <div class="fav-meta">${f.cat} · ${fmtDur(f.durPlan)} · ${f.priority}</div>
              </div>
              <button class="icon-btn" onclick="deleteFav('${f.id}')" title="删除">✕</button>
            </div>
          `).join('')}
      </div>
    </div>

    <div class="section-title">意见反馈</div>
    <div class="settings-section">
      <div class="settings-row">
        <div>
          <div class="label">有问题或建议？</div>
          <div class="desc">欢迎告诉我们，帮助 Snail 越来越好</div>
        </div>
        <a href="mailto:Melamlovegood@gmail.com,wenbozeng18@gmail.com?subject=Snail%20%E5%8F%8D%E9%A6%88" class="btn-feedback">发邮件给我们</a>
      </div>
    </div>

    <div class="section-title">常见问题</div>
    <div class="settings-section">
      <div style="padding:4px 0">
        <div class="faq-item">
          <div class="faq-q"><span>图片上传后显示「未识别任务」怎么办？</span><span class="faq-arrow">▶</span></div>
          <div class="faq-a">图片解析使用你在设置页配置的「视觉模型」，该模型必须支持多模态（识图），如千问的 qwen-vl-plus、OpenAI 的 gpt-4o 等。请确认已正确填写视觉模型并填入对应的 API Key。如果没有千问 Key，可前往 <a href="https://bailian.console.aliyun.com" target="_blank">bailian.console.aliyun.com</a> 注册获取。</div>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span>AI 调用失败，提示「未提供 API Key」？</span><span class="faq-arrow">▶</span></div>
          <div class="faq-a">请在设置页的「AI 模型配置」中填入你的 API Key 并保存。Key 仅存储在本地，不会上传到服务器。</div>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span>支持哪些 AI 服务？在哪里获取 Key？</span><span class="faq-arrow">▶</span></div>
          <div class="faq-a">目前支持以下官方供应商，点击链接注册获取 Key：<br>· 千问（推荐）：<a href="https://bailian.console.aliyun.com" target="_blank">bailian.console.aliyun.com</a><br>· DeepSeek：<a href="https://platform.deepseek.com" target="_blank">platform.deepseek.com</a><br>· OpenAI：<a href="https://platform.openai.com" target="_blank">platform.openai.com</a><br>· Claude：<a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a><br>· Gemini：<a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a><br><br>此外还支持「自定义 / 中转站」：选择该供应商后填入中转站的接口地址（baseURL）、API Key 和模型名即可，按 OpenAI 兼容格式调用。</div>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span>数据会丢失吗？</span><span class="faq-arrow">▶</span></div>
          <div class="faq-a">登录账号后数据自动云同步，换设备也能访问。未登录时数据仅保存在本地浏览器，清除缓存会丢失，建议注册登录。</div>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span>任务推迟太多次怎么办？</span><span class="faq-arrow">▶</span></div>
          <div class="faq-a">当一个任务被推迟 3 次后，系统会触发「承认现实」弹窗，帮你重新审视这个任务。你可以选择拆解它、继续推迟，或者删除。</div>
        </div>
      </div>
    </div>

    <div class="section-title">关于</div>
    <div class="settings-section">
      <div class="settings-row">
        <div>
          <div class="label">重新查看新手引导</div>
          <div class="desc">从头了解 Snail 的核心功能</div>
        </div>
        <button class="btn-secondary" onclick="window.startOnboarding && window.startOnboarding()">查看</button>
      </div>
    </div>

    <div class="text-xs text-faint" style="text-align:center; padding:24px 0 12px 0">
      Snail · 个人时间管理
    </div>
  `;

  const _copyIcal = main.querySelector('#copy-ical-link');
  if (_copyIcal) {
    _copyIcal.onclick = () => {
      navigator.clipboard.writeText(icalUrl).then(() => toast('链接已复制')).catch(() => toast('复制失败，请手动复制'));
    };
  }

  main.querySelectorAll('.seg-control button[data-th]').forEach(b => {
    b.onclick = () => {
      state.theme = b.dataset.th;
      saveState();
      applyTheme();
      renderSettings();
    };
  });
  main.querySelectorAll('.seg-control button[data-roll]').forEach(b => {
    b.onclick = () => {
      state.rolloverWarnThreshold = parseInt(b.dataset.roll, 10) || 2;
      saveState();
      renderSettings();
    };
  });
  // AI 模型配置
  const _PROVIDER_MODELS = {
    qwen:     ['qwen-plus', 'qwen-max', 'qwen-vl-plus'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    openai:   ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    claude:   ['claude-3-5-haiku-20241022', 'claude-3-7-sonnet-20250219'],
    gemini:   ['gemini-2.0-flash', 'gemini-2.5-pro-preview-05-06'],
    custom:   [],
  };
  // 各供应商旗下支持多模态（识图）的模型，作为视觉模型输入框的建议项
  const _PROVIDER_VISION_MODELS = {
    qwen:     ['qwen-vl-plus', 'qwen-vl-max'],
    deepseek: [],
    openai:   ['gpt-4o', 'gpt-4o-mini'],
    claude:   ['claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-20250219'],
    gemini:   ['gemini-2.0-flash', 'gemini-2.5-pro-preview-05-06'],
    custom:   [],
  };
  const _provSel = main.querySelector('#ai-provider');
  const _nameInput = main.querySelector('#ai-name');
  const _modelInput = main.querySelector('#ai-model');
  const _modelList = main.querySelector('#ai-model-list');
  const _visionInput = main.querySelector('#ai-vision-model');
  const _visionList = main.querySelector('#ai-vision-list');
  const _baseurlRow = main.querySelector('#ai-baseurl-row');
  const _baseurlInput = main.querySelector('#ai-baseurl');
  const _apikeyInput = main.querySelector('#ai-apikey');
  const _apikeyToggle = main.querySelector('#ai-apikey-toggle');
  const _editTitle = main.querySelector('#ai-edit-title');
  const _cancelBtn = main.querySelector('#cancel-ai-edit');
  const _listEl = main.querySelector('#ai-profile-list');
  const _editPanel = main.querySelector('#ai-edit-panel');

  function _showEditPanel() { _editPanel.style.display = ''; }
  function _hideEditPanel() { _editPanel.style.display = 'none'; }

  function _fillDatalist(el, models) {
    el.innerHTML = (models || []).map(m => `<option value="${m}"></option>`).join('');
  }
  function _syncProviderUI(provider) {
    _fillDatalist(_modelList, _PROVIDER_MODELS[provider] || []);
    _fillDatalist(_visionList, _PROVIDER_VISION_MODELS[provider] || []);
    _baseurlRow.style.display = provider === 'custom' ? '' : 'none';
  }
  // 把一套配置填进编辑表单（prof 为空则按新增的默认值）
  function _loadForm(prof) {
    const c = { ...AI_CONFIG_DEFAULTS, name: '', ...(prof || {}) };
    if (!prof) { c.provider = 'qwen'; c.apiKey = ''; c.baseURL = ''; c.model = ''; c.visionModel = ''; }
    _nameInput.value = c.name || '';
    _provSel.value = c.provider || 'qwen';
    _apikeyInput.value = c.apiKey || '';
    _baseurlInput.value = c.baseURL || '';
    _modelInput.value = c.model || '';
    _visionInput.value = c.visionModel || '';
    _apikeyInput.type = 'password';
    _apikeyToggle.textContent = '显示';
    _syncProviderUI(_provSel.value);
  }
  function _renderEditState() {
    if (aiEditingId) {
      const p = loadAiProfiles().profiles.find(x => x.id === aiEditingId);
      _editTitle.textContent = '编辑配置' + (p && p.name ? '：' + p.name : '');
    } else {
      _editTitle.textContent = '新增配置';
    }
    // 面板默认隐藏，可折叠，因此始终提供「取消」按钮以关闭面板
    _cancelBtn.style.display = '';
  }
  function _renderProfileList() {
    const { active, profiles } = loadAiProfiles();
    if (!profiles.length) {
      _listEl.innerHTML = '<div class="settings-row text-soft" style="padding:4px 0">还没有配置，请在下方新增。</div>';
      return;
    }
    _listEl.innerHTML = profiles.map(p => {
      const isActive = p.id === active;
      const summary = (AI_PROVIDER_LABELS[p.provider] || p.provider || '') + ' · ' + (p.model || '—');
      const dot = isActive
        ? '<span style="flex:none;width:16px;height:16px;border-radius:50%;border:5px solid var(--accent);box-sizing:border-box"></span>'
        : '<span style="flex:none;width:16px;height:16px;border-radius:50%;border:2px solid var(--border);box-sizing:border-box"></span>';
      return `<div class="ai-prof-row" data-id="${p.id}" style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};border-radius:8px;cursor:pointer;${isActive ? 'background:var(--accent-soft)' : ''}">
        ${dot}
        <div style="flex:1;min-width:0">
          <div class="label" style="font-weight:600">${escapeHtml(p.name || '未命名配置')}${isActive ? ' <span style="color:var(--accent);font-weight:400;font-size:12px">· 使用中</span>' : ''}</div>
          <div class="desc" style="margin-top:2px">${escapeHtml(summary)}</div>
        </div>
        <button type="button" class="icon-btn ai-prof-edit" data-id="${p.id}" title="编辑">✎</button>
        <button type="button" class="icon-btn ai-prof-del" data-id="${p.id}" title="删除">✕</button>
      </div>`;
    }).join('');
    _listEl.querySelectorAll('.ai-prof-row').forEach(row => {
      row.onclick = () => {
        const id = row.dataset.id;
        const d = loadAiProfiles();
        if (d.active === id) return;
        d.active = id;
        saveAiProfiles(d);
        const pr = d.profiles.find(x => x.id === id);
        toast('已切换为「' + (pr && pr.name || '配置') + '」');
        _renderProfileList();
      };
    });
    _listEl.querySelectorAll('.ai-prof-edit').forEach(b => {
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); _startEdit(b.dataset.id); };
    });
    _listEl.querySelectorAll('.ai-prof-del').forEach(b => {
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); _deleteProfile(b.dataset.id); };
    });
  }
  function _startNew() {
    aiEditingId = null;
    _loadForm(null);
    _renderEditState();
    _showEditPanel();
    _editTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function _startEdit(id) {
    const p = loadAiProfiles().profiles.find(x => x.id === id);
    if (!p) return;
    aiEditingId = id;
    _loadForm(p);
    _renderEditState();
    _showEditPanel();
    _editTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function _deleteProfile(id) {
    const d = loadAiProfiles();
    const p = d.profiles.find(x => x.id === id);
    if (!confirm('确认删除配置「' + (p && p.name || '') + '」？')) return;
    d.profiles = d.profiles.filter(x => x.id !== id);
    if (d.active === id) d.active = (d.profiles[0] && d.profiles[0].id) || '';
    saveAiProfiles(d);
    if (aiEditingId === id) _startNew();
    _renderProfileList();
    toast('已删除');
  }

  _provSel.onchange = () => {
    const p = _provSel.value;
    _syncProviderUI(p);
    // 切换到已知供应商时，给未填写的模型/视觉模型一个默认建议值
    if (p !== 'custom') {
      if (!_modelInput.value) _modelInput.value = (_PROVIDER_MODELS[p] || [])[0] || '';
      if (!_visionInput.value) _visionInput.value = (_PROVIDER_VISION_MODELS[p] || [])[0] || '';
    }
  };
  _apikeyToggle.onclick = () => {
    const show = _apikeyInput.type === 'password';
    _apikeyInput.type = show ? 'text' : 'password';
    _apikeyToggle.textContent = show ? '隐藏' : '显示';
  };
  main.querySelector('#ai-add-profile').onclick = () => _startNew();
  _cancelBtn.onclick = () => _hideEditPanel();
  main.querySelector('#save-ai-config').onclick = () => {
    const provider = _provSel.value;
    if (provider === 'custom' && !_baseurlInput.value.trim()) {
      toast('请填写中转站的接口地址');
      return;
    }
    if (!_modelInput.value.trim()) {
      toast('请填写模型名称');
      return;
    }
    const entry = {
      name: _nameInput.value.trim() || (AI_PROVIDER_LABELS[provider] || '配置'),
      provider,
      apiKey: _apikeyInput.value.trim(),
      baseURL: _baseurlInput.value.trim(),
      model: _modelInput.value.trim(),
      visionModel: _visionInput.value.trim(),
    };
    const d = loadAiProfiles();
    if (aiEditingId && d.profiles.some(x => x.id === aiEditingId)) {
      d.profiles = d.profiles.map(x => x.id === aiEditingId ? { ...x, ...entry } : x);
    } else {
      const id = uid();
      d.profiles.push({ id, ...entry });
      aiEditingId = id;
    }
    if (!d.active || !d.profiles.some(x => x.id === d.active)) d.active = aiEditingId;
    saveAiProfiles(d);
    _renderProfileList();
    _renderEditState();
    _hideEditPanel();
    toast('已保存');
  };

  // 初始化：仅渲染配置列表，编辑面板默认折叠隐藏，
  // 只有点击「✎ 编辑」或「+ 新增配置」时才展开
  (function _initAiSettings() {
    const { active, profiles } = loadAiProfiles();
    if (profiles.length) {
      aiEditingId = (profiles.find(x => x.id === active) || profiles[0]).id;
      _loadForm(profiles.find(x => x.id === aiEditingId));
    } else {
      aiEditingId = null;
      _loadForm(null);
    }
    _renderProfileList();
    _renderEditState();
    _hideEditPanel();
  })();
  main.querySelector('#export-data').onclick = exportData;
  main.querySelector('#import-data').onclick = () => document.getElementById('json-input').click();
  main.querySelector('#clear-data').onclick = async () => {
    if (confirm('确认清空所有数据？此操作不可恢复。')) {
      // 先清云端，再清本地，避免同步时从云端恢复
      if (authStatus === 'cloud' && sb && cloudUser) {
        try {
          await sb.from('recur_templates').delete().eq('user_id', cloudUser.id);
          await sb.from('tasks').delete().eq('user_id', cloudUser.id);
        } catch(e) {
          console.warn('[Cloud] clear cloud data failed:', e);
        }
      }
      localStorage.removeItem('chronos_state');
      state = loadState();
      render();
      toast('已清空');
    }
  };
  // FAQ 手风琴
  main.querySelectorAll('.faq-q').forEach(q => {
    q.onclick = () => q.closest('.faq-item').classList.toggle('open');
  });
}

