document.addEventListener('DOMContentLoaded', () => {
  function isValidHttpUrl(value) {
    try {
      const parsedUrl = new URL(value);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  const TASK_TYPES = Object.freeze({
    once: {
      storageKey: 'onceTasks',
      listId: 'onceTaskList',
      searchText: '单次 once one-time'
    },
    open: {
      storageKey: 'openTasks',
      listId: 'taskList',
      searchText: '每天 open day'
    },
    hourly: {
      storageKey: 'hourlyTasks',
      listId: 'hourlyTaskList',
      searchText: '每小时 hourly hour'
    },
    bg: {
      storageKey: 'bgTasks',
      listId: 'bgTaskList',
      searchText: '后台 background minute'
    },
    refresh: {
      storageKey: 'refreshTasks',
      listId: 'refreshTaskList',
      searchText: '刷新 refresh minute'
    }
  });

  const TASK_TYPE_NAMES = Object.keys(TASK_TYPES);
  const TASK_STORAGE_KEYS = TASK_TYPE_NAMES.map(type => TASK_TYPES[type].storageKey);

  function createTaskId(type) {
    if (crypto.randomUUID) {
      return `${type}-${crypto.randomUUID()}`;
    }

    return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function withTaskId(type, task) {
    if (task.id) return task;

    return {
      ...task,
      id: createTaskId(type)
    };
  }

  function normalizeStoredTaskIds(storedTasks) {
    const normalizedTasks = {};
    let updated = false;

    TASK_TYPE_NAMES.forEach(type => {
      const storageKey = TASK_TYPES[type].storageKey;
      normalizedTasks[storageKey] = (storedTasks[storageKey] || []).map(task => {
        if (task.id) return task;
        updated = true;
        return withTaskId(type, task);
      });
    });

    return { normalizedTasks, updated };
  }

  const themeToggleButton = document.getElementById('themeToggle');
  const taskSearchInput = document.getElementById('taskSearch');
  const clearSearchButton = document.getElementById('clearSearchBtn');
  const noSearchResultsBanner = document.getElementById('noSearchResults');
  const exportTasksButton = document.getElementById('exportTasksBtn');
  const importTasksButton = document.getElementById('importTasksBtn');
  const importTasksFileInput = document.getElementById('importTasksFile');

  let currentSearchKeyword = '';
  let searchDebounceTimer = null;

  function parsePositiveInteger(value) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? NaN : parsed;
  }

  function parseLocalDateTime(dateText, timeText) {
    if (!dateText || !timeText) return NaN;
    const timestamp = new Date(`${dateText}T${timeText}:00`).getTime();
    return Number.isNaN(timestamp) ? NaN : timestamp;
  }

  function getTotalTaskCount(tasks) {
    return TASK_STORAGE_KEYS.reduce((total, key) => total + (tasks[key]?.length || 0), 0);
  }

  function rescheduleAllAndReload(callback) {
    chrome.runtime.sendMessage({ type: 'rescheduleAll' }, () => {
      loadAllTaskLists();
      if (callback) callback();
    });
  }

  function applyTheme(theme) {
    document.body.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') {
      document.body.classList.add('theme-light');
    } else if (theme === 'dark') {
      document.body.classList.add('theme-dark');
    }

    if (theme === 'light') {
      themeToggleButton.textContent = '☀️';
    } else if (theme === 'dark') {
      themeToggleButton.textContent = '🌙';
    } else {
      themeToggleButton.textContent = 'AUTO';
    }
  }

  function loadTheme() {
    chrome.storage.local.get(['themeMode'], res => {
      const theme = res.themeMode || 'system';
      applyTheme(theme);
    });
  }

  function cycleTheme() {
    const isLight = document.body.classList.contains('theme-light');
    const isDark = document.body.classList.contains('theme-dark');
    let nextTheme = 'system';

    if (!isLight && !isDark) {
      nextTheme = 'light';
    } else if (isLight) {
      nextTheme = 'dark';
    }

    chrome.storage.local.set({ themeMode: nextTheme }, () => {
      applyTheme(nextTheme);
    });
  }

  loadTheme();
  themeToggleButton.addEventListener('click', cycleTheme);

  function downloadJsonFile(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function isValidInterval(value) {
    return Number.isInteger(value) && value > 0;
  }

  function normalizeImportedTasks(rawData) {
    const source = rawData && rawData.tasks ? rawData.tasks : rawData;
    const now = Date.now();

    const onceTasks = Array.isArray(source?.onceTasks)
      ? source.onceTasks.filter(task => isValidHttpUrl(task?.url) && Number.isFinite(task?.nextTime)).map(task => ({
          id: task.id || createTaskId('once'),
          url: task.url,
          nextTime: task.nextTime
        }))
      : [];

    const openTasks = Array.isArray(source?.openTasks)
      ? source.openTasks.filter(task => isValidHttpUrl(task?.url) && isValidInterval(task?.interval) && typeof task?.openTime === 'string').map(task => ({
          id: task.id || createTaskId('open'),
          url: task.url,
          interval: task.interval,
          openTime: task.openTime,
          nextTime: Number.isFinite(task.nextTime) ? task.nextTime : now + task.interval * 24 * 60 * 60 * 1000
        }))
      : [];

    const hourlyTasks = Array.isArray(source?.hourlyTasks)
      ? source.hourlyTasks.filter(task => isValidHttpUrl(task?.url) && isValidInterval(task?.interval)).map(task => ({
          id: task.id || createTaskId('hourly'),
          url: task.url,
          interval: task.interval,
          nextTime: Number.isFinite(task.nextTime) ? task.nextTime : now + task.interval * 60 * 60 * 1000
        }))
      : [];

    const bgTasks = Array.isArray(source?.bgTasks)
      ? source.bgTasks.filter(task => isValidHttpUrl(task?.url) && isValidInterval(task?.interval)).map(task => ({
          id: task.id || createTaskId('bg'),
          url: task.url,
          interval: task.interval,
          nextTime: Number.isFinite(task.nextTime) ? task.nextTime : now + task.interval * 60 * 1000
        }))
      : [];

    const refreshTasks = Array.isArray(source?.refreshTasks)
      ? source.refreshTasks.filter(task => typeof task?.url === 'string' && task.url.trim() && isValidInterval(task?.interval)).map(task => ({
          id: task.id || createTaskId('refresh'),
          url: task.url,
          interval: task.interval,
          nextTime: Number.isFinite(task.nextTime) ? task.nextTime : now + task.interval * 60 * 1000
        }))
      : [];

    return { onceTasks, openTasks, hourlyTasks, bgTasks, refreshTasks };
  }

  function mergeTaskLists(existingTasks, importedTasks, keyBuilder) {
    const map = new Map();
    (existingTasks || []).forEach(task => {
      map.set(keyBuilder(task), task);
    });
    (importedTasks || []).forEach(task => {
      map.set(keyBuilder(task), task);
    });
    return Array.from(map.values());
  }

  function mergeImportedIntoCurrent(normalizedTasks, callback) {
    chrome.storage.local.get(TASK_STORAGE_KEYS, current => {
      const merged = {
        onceTasks: mergeTaskLists(current.onceTasks, normalizedTasks.onceTasks, task => `${task.url}|${task.nextTime}`),
        openTasks: mergeTaskLists(current.openTasks, normalizedTasks.openTasks, task => `${task.url}|${task.interval}|${task.openTime}`),
        hourlyTasks: mergeTaskLists(current.hourlyTasks, normalizedTasks.hourlyTasks, task => `${task.url}|${task.interval}`),
        bgTasks: mergeTaskLists(current.bgTasks, normalizedTasks.bgTasks, task => `${task.url}|${task.interval}`),
        refreshTasks: mergeTaskLists(current.refreshTasks, normalizedTasks.refreshTasks, task => `${task.url}|${task.interval}`)
      };
      chrome.storage.local.set(merged, callback);
    });
  }

  exportTasksButton.addEventListener('click', () => {
    chrome.storage.local.get(TASK_STORAGE_KEYS, res => {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        tasks: {
          onceTasks: res.onceTasks || [],
          openTasks: res.openTasks || [],
          hourlyTasks: res.hourlyTasks || [],
          bgTasks: res.bgTasks || [],
          refreshTasks: res.refreshTasks || []
        }
      };
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadJsonFile(`web-timer-tasks-${timestamp}.json`, payload);
      showTemporaryButtonText(exportTasksButton, '已导出', 1000);
    });
  });

  importTasksButton.addEventListener('click', () => {
    importTasksFileInput.click();
  });

  importTasksFileInput.addEventListener('change', event => {
    const [file] = event.target.files || [];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const normalizedTasks = normalizeImportedTasks(parsed);
        const importedTaskCount = getTotalTaskCount(normalizedTasks);

        if (importedTaskCount === 0) {
          alert('导入文件中没有找到有效任务');
          return;
        }

        const mergeMode = window.confirm(`已读取 ${importedTaskCount} 个有效任务。\n导入模式：点击“确定”与现有任务合并；点击“取消”进入覆盖导入。`);

        if (mergeMode) {
          mergeImportedIntoCurrent(normalizedTasks, () => {
            rescheduleAllAndReload(() => {
              showTemporaryButtonText(importTasksButton, '已导入', 1200);
            });
          });
        } else {
          const confirmOverwrite = window.confirm('覆盖导入将替换现有全部任务，确定继续吗？');
          if (!confirmOverwrite) {
            importTasksFileInput.value = '';
            return;
          }

          chrome.storage.local.set(normalizedTasks, () => {
            rescheduleAllAndReload(() => {
              showTemporaryButtonText(importTasksButton, '已导入', 1200);
            });
          });
        }
      } catch (error) {
        alert('导入失败：JSON 文件格式无效');
      } finally {
        importTasksFileInput.value = '';
      }
    };

    reader.onerror = () => {
      alert('导入失败：无法读取文件');
      importTasksFileInput.value = '';
    };

    reader.readAsText(file, 'utf-8');
  });

  function formatDateLocal(timestamp) {
    const date = new Date(timestamp);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatTimeLocal(timestamp) {
    const date = new Date(timestamp);
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${min}`;
  }

  function updateClearSearchButtonState() {
    clearSearchButton.disabled = !taskSearchInput.value.trim();
  }

  function clearSearchAndReload(shouldFocusInput = true) {
    taskSearchInput.value = '';
    currentSearchKeyword = '';
    updateClearSearchButtonState();
    loadAllTaskLists();
    if (shouldFocusInput) {
      taskSearchInput.focus();
    }
  }

  function taskMatchesSearch(task, type, keyword) {
    if (!keyword) return true;

    const typeText = TASK_TYPES[type]?.searchText || '';

    const haystack = [
      task.url || '',
      String(task.interval || ''),
      typeText,
      task.openTime || '',
      new Date(task.nextTime || 0).toLocaleString()
    ].join(' ').toLowerCase();

    return haystack.includes(keyword);
  }

  function getTaskDescription(task, type) {
    const timeLabel = type === 'open' && task.openTime ? `（${task.openTime}）` : '';

    if (type === 'once') return '单次打开网页';
    if (type === 'open') return `每${task.interval}天打开一次${timeLabel}`;
    if (type === 'hourly') return `每${task.interval}小时打开一次`;
    if (type === 'bg') return `每${task.interval}分钟后台访问`;
    return `每${task.interval}分钟刷新标签页`;
  }

  function getNextTimeLabel(type) {
    return type === 'once' || type === 'open' || type === 'hourly' ? '下次打开' : '下一次';
  }

  function appendTextElement(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function createEditorLabel(text) {
    const label = document.createElement('div');
    label.className = 'task-edit-label';
    label.textContent = text;
    return label;
  }

  function createEditorRow() {
    const row = document.createElement('div');
    row.className = 'task-edit-row';
    return row;
  }

  function createNumberInput(className, value) {
    const input = document.createElement('input');
    input.className = className;
    input.type = 'number';
    input.min = '1';
    input.value = String(value || '');
    return input;
  }

  function createTypedInput(className, type, value) {
    const input = document.createElement('input');
    input.className = className;
    input.type = type;
    input.value = value || '';
    return input;
  }

  function createTaskButton(className, text, type, index, title) {
    const button = document.createElement('button');
    button.className = className;
    button.dataset.type = type;
    button.dataset.index = String(index);
    button.dataset.taskId = '';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.textContent = text;
    return button;
  }

  function appendUnit(row, text) {
    const unit = document.createElement('span');
    unit.className = 'interval-unit';
    unit.textContent = text;
    row.appendChild(unit);
  }

  function appendOnceEditor(editorBlock, task, type, index) {
    editorBlock.appendChild(createEditorLabel('修改打开时间'));
    const timeRow = createEditorRow();
    timeRow.appendChild(createTypedInput('once-date-input input-date', 'date', formatDateLocal(task.nextTime)));
    timeRow.appendChild(createTypedInput('once-time-input input-time', 'time', formatTimeLocal(task.nextTime)));
    timeRow.appendChild(createTaskButton('save-once-btn', '💾 保存', type, index, '保存修改'));
    editorBlock.appendChild(timeRow);
  }

  function appendOpenEditor(editorBlock, task, type, index) {
    editorBlock.appendChild(createEditorLabel('修改间隔'));
    const intervalRow = createEditorRow();
    intervalRow.appendChild(createNumberInput('open-interval-input input-interval', task.interval));
    appendUnit(intervalRow, '天');
    editorBlock.appendChild(intervalRow);

    editorBlock.appendChild(createEditorLabel('修改下次打开时间'));
    const timeRow = createEditorRow();
    timeRow.appendChild(createTypedInput('open-date-input input-date', 'date', formatDateLocal(task.nextTime)));
    timeRow.appendChild(createTypedInput('open-time-input input-time', 'time', task.openTime || ''));
    timeRow.appendChild(createTaskButton('save-open-btn', '💾 保存', type, index, '保存修改'));
    editorBlock.appendChild(timeRow);
  }

  function appendHourlyEditor(editorBlock, task, type, index) {
    editorBlock.appendChild(createEditorLabel('修改间隔'));
    const intervalRow = createEditorRow();
    intervalRow.appendChild(createNumberInput('hourly-interval-input input-hour', task.interval));
    appendUnit(intervalRow, '小时');
    editorBlock.appendChild(intervalRow);

    editorBlock.appendChild(createEditorLabel('修改下次打开时间'));
    const timeRow = createEditorRow();
    timeRow.appendChild(createTypedInput('hourly-date-input input-date', 'date', formatDateLocal(task.nextTime)));
    timeRow.appendChild(createTypedInput('hourly-time-input input-time', 'time', formatTimeLocal(task.nextTime)));
    timeRow.appendChild(createTaskButton('save-hourly-btn', '💾 保存', type, index, '保存修改'));
    editorBlock.appendChild(timeRow);
  }

  function appendMinuteEditor(editorBlock, task, type, index) {
    editorBlock.appendChild(createEditorLabel('修改间隔'));
    const intervalRow = createEditorRow();
    intervalRow.appendChild(createNumberInput('minute-interval-input input-minute', task.interval));
    appendUnit(intervalRow, '分钟');
    intervalRow.appendChild(createTaskButton('save-minute-btn', '💾 保存', type, index, '保存修改'));
    editorBlock.appendChild(intervalRow);
  }

  function createTaskLink(task) {
    const wrapper = document.createElement('span');
    wrapper.className = 'task-url';
    wrapper.appendChild(document.createTextNode('🔗'));

    const link = document.createElement('a');
    link.className = 'task-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = task.url || '';
    link.textContent = task.url || '';

    if (isValidHttpUrl(task.url)) {
      link.href = task.url;
    } else {
      link.removeAttribute('href');
      link.title = `${task.url || ''}（不是可直接打开的 http/https 链接）`;
    }

    wrapper.appendChild(link);
    return wrapper;
  }

  function createTaskElement(task, index, type) {
    const div = document.createElement('div');
    div.className = 'task';

    appendTextElement(div, 'span', 'task-desc', `📌 ${getTaskDescription(task, type)}`);
    appendTextElement(div, 'span', 'task-next-time', `⏰ ${getNextTimeLabel(type)}：${new Date(task.nextTime).toLocaleString()}`);
    div.appendChild(createTaskLink(task));

    const editorBlock = document.createElement('div');
    editorBlock.className = 'task-editor-block';
    if (type === 'once') {
      appendOnceEditor(editorBlock, task, type, index);
    } else if (type === 'open') {
      appendOpenEditor(editorBlock, task, type, index);
    } else if (type === 'hourly') {
      appendHourlyEditor(editorBlock, task, type, index);
    } else if (type === 'bg' || type === 'refresh') {
      appendMinuteEditor(editorBlock, task, type, index);
    }
    div.appendChild(editorBlock);

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    actions.appendChild(createTaskButton('toggle-editor-btn', '✏️ 修改', type, index, '展开/收起修改设置'));
    actions.appendChild(createTaskButton('remove-task-btn', '🗑️ 删除', type, index, '删除'));
    actions.appendChild(createTaskButton('run-now-btn', '▶️ 执行', type, index, '立即执行'));
    div.appendChild(actions);

    div.querySelectorAll('button[data-type]').forEach(button => {
      button.dataset.taskId = task.id || '';
    });

    return div;
  }

  // 渲染指定类型的任务列表并为按钮绑定事件
  function renderTasks(tasks, containerId, type) {
    const container = document.getElementById(containerId);
    container.replaceChildren();

    if (!tasks || tasks.length === 0) {
      return 0;
    }

    let matchedCount = 0;
    tasks.forEach((task, i) => {
      if (!taskMatchesSearch(task, type, currentSearchKeyword)) {
        return;
      }

      matchedCount += 1;
      container.appendChild(createTaskElement(task, i, type));
    });

    return matchedCount;
  }

  function showTemporaryButtonText(button, text, durationMs) {
    const originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
    window.setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, durationMs);
  }

  function handleTaskListClick(event) {
    const button = event.target.closest('button');
    if (!button) return;

    const type = button.dataset.type;
    const index = parseInt(button.dataset.index, 10);
    if (!type || Number.isNaN(index)) return;

    if (button.classList.contains('toggle-editor-btn')) {
      const taskCard = button.closest('.task');
      const editorBlock = taskCard ? taskCard.querySelector('.task-editor-block') : null;
      if (!editorBlock) return;

      const willExpand = !editorBlock.classList.contains('expanded');

      document.querySelectorAll('.task-editor-block.expanded').forEach(block => {
        if (block !== editorBlock) {
          block.classList.remove('expanded');
        }
      });
      document.querySelectorAll('.toggle-editor-btn').forEach(toggleBtn => {
        if (toggleBtn !== button) {
          toggleBtn.textContent = '✏️ 修改';
        }
      });

      editorBlock.classList.toggle('expanded', willExpand);
      button.textContent = willExpand ? '🙈 收起' : '✏️ 修改';
      return;
    }

    if (button.classList.contains('remove-task-btn')) {
      removeTask(type, index);
      return;
    }

    if (button.classList.contains('run-now-btn')) {
      runNow(type, index, button);
      return;
    }

    if (button.classList.contains('save-once-btn')) {
      const container = button.closest('.task');
      const dateInput = container ? container.querySelector('.once-date-input') : null;
      const timeInput = container ? container.querySelector('.once-time-input') : null;
      const nextDate = dateInput ? dateInput.value : '';
      const nextTimeText = timeInput ? timeInput.value : '';

      if (!nextDate) {
        alert('请选择打开日期');
        return;
      }
      if (!nextTimeText) {
        alert('请选择打开时间');
        return;
      }

      const nextTime = parseLocalDateTime(nextDate, nextTimeText);
      if (Number.isNaN(nextTime)) {
        alert('请输入有效的打开日期时间');
        return;
      }
      if (nextTime <= Date.now()) {
        alert('单次任务的打开时间必须晚于当前时间');
        return;
      }

      chrome.storage.local.get(['onceTasks'], res => {
        const onceTasks = res.onceTasks || [];
        const task = onceTasks[index];
        if (!task) return;

        task.nextTime = nextTime;
        onceTasks[index] = task;
        chrome.storage.local.set({ onceTasks }, () => {
          showTemporaryButtonText(button, '✅', 1000);
          window.setTimeout(() => rescheduleAllAndReload(), 250);
        });
      });
      return;
    }

    if (button.classList.contains('save-open-btn')) {
      const container = button.closest('.task');
      const dateInput = container ? container.querySelector('.open-date-input') : null;
      const timeInput = container ? container.querySelector('.open-time-input') : null;
      const intervalInput = container ? container.querySelector('.open-interval-input') : null;
      const openDate = dateInput ? dateInput.value : '';
      const openTime = timeInput ? timeInput.value : '';
      const intervalValue = intervalInput ? parsePositiveInteger(intervalInput.value) : NaN;
      if (!openDate) {
        alert('请选择打开日期');
        return;
      }
      if (!openTime) {
        alert('请选择打开时间');
        return;
      }
      if (Number.isNaN(intervalValue)) {
        alert('请输入有效的间隔天数');
        return;
      }

      chrome.storage.local.get(['openTasks'], res => {
        const openTasks = res.openTasks || [];
        const task = openTasks[index];
        if (!task) return;

        const nextTime = parseLocalDateTime(openDate, openTime);
        if (Number.isNaN(nextTime)) {
          alert('请输入有效的打开日期');
          return;
        }

        task.interval = intervalValue;
        task.openTime = openTime;
        task.nextTime = nextTime;
        openTasks[index] = task;
        chrome.storage.local.set({ openTasks }, () => {
          showTemporaryButtonText(button, '✅', 1000);
          window.setTimeout(() => rescheduleAllAndReload(), 250);
        });
      });
      return;
    }

    if (button.classList.contains('save-hourly-btn')) {
      const container = button.closest('.task');
      const intervalInput = container ? container.querySelector('.hourly-interval-input') : null;
      const dateInput = container ? container.querySelector('.hourly-date-input') : null;
      const timeInput = container ? container.querySelector('.hourly-time-input') : null;
      const intervalValue = intervalInput ? parsePositiveInteger(intervalInput.value) : NaN;
      const nextDate = dateInput ? dateInput.value : '';
      const nextTimeText = timeInput ? timeInput.value : '';

      if (Number.isNaN(intervalValue)) {
        alert('请输入有效的间隔小时数');
        return;
      }
      if (!nextDate) {
        alert('请选择下次执行日期');
        return;
      }
      if (!nextTimeText) {
        alert('请选择下次执行时间');
        return;
      }

      const nextTime = parseLocalDateTime(nextDate, nextTimeText);
      if (Number.isNaN(nextTime)) {
        alert('请输入有效的下次执行日期时间');
        return;
      }

      const storageKey = type + 'Tasks';
      chrome.storage.local.get([storageKey], res => {
        const tasks = res[storageKey] || [];
        const task = tasks[index];
        if (!task) return;

        task.interval = intervalValue;
        task.nextTime = nextTime;
        tasks[index] = task;
        chrome.storage.local.set({ [storageKey]: tasks }, () => {
          showTemporaryButtonText(button, '✅', 1000);
          window.setTimeout(() => rescheduleAllAndReload(), 250);
        });
      });
      return;
    }

    if (button.classList.contains('save-minute-btn')) {
      const container = button.closest('.task');
      const intervalInput = container ? container.querySelector('.minute-interval-input') : null;
      const intervalValue = intervalInput ? parsePositiveInteger(intervalInput.value) : NaN;
      if (Number.isNaN(intervalValue)) {
        alert('请输入有效的间隔分钟');
        return;
      }

      const storageKey = type + 'Tasks';
      chrome.storage.local.get([storageKey], res => {
        const tasks = res[storageKey] || [];
        const task = tasks[index];
        if (!task) return;

        task.interval = intervalValue;
        task.nextTime = Date.now() + intervalValue * 60 * 1000;
        tasks[index] = task;
        chrome.storage.local.set({ [storageKey]: tasks }, () => {
          showTemporaryButtonText(button, '✅', 1000);
          window.setTimeout(() => rescheduleAllAndReload(), 250);
        });
      });
    }
  }

  // 从存储中删除任务并重新渲染列表
  function removeTask(type, index) {
    chrome.storage.local.get([type + 'Tasks'], res => {
      const tasks = res[type + 'Tasks'] || [];
      if (index >= 0 && index < tasks.length) {
        tasks.splice(index, 1);
        chrome.storage.local.set({ [type + 'Tasks']: tasks }, () => {
          rescheduleAllAndReload();
        });
      } else {
        console.error('删除任务时索引无效:', type, index);
      }
    });
  }

  // 发送消息到 background.js 以立即执行任务
  function runNow(type, index, button) {
    console.log(`请求立即执行任务: ${type} - 索引 ${index}`);
    const originalText = button.textContent;
    button.textContent = '执行中...';
    button.disabled = true;

    chrome.runtime.sendMessage({ type: 'runNow', taskType: type, taskId: button.dataset.taskId || '', index }, response => {
      if (chrome.runtime.lastError) {
        button.textContent = '执行失败';
        window.setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1200);
        alert(`执行失败：${chrome.runtime.lastError.message}`);
        return;
      }

      if (response?.ok === false) {
        button.textContent = '执行失败';
        window.setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1200);
        alert(response.message || '执行失败');
        return;
      }

      button.textContent = response?.message || '已执行';
      window.setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
        if (type === 'once') {
          loadAllTaskLists();
        }
      }, 1200);
    });
  }

  TASK_TYPE_NAMES.forEach(type => {
    const container = document.getElementById(TASK_TYPES[type].listId);
    container.addEventListener('click', handleTaskListClick);
  });

  function updateFoldSectionsBySearch(matchCounts) {
    const hasKeyword = Boolean(currentSearchKeyword);
    const sections = document.querySelectorAll('.fold-section[data-task-type]');

    sections.forEach(section => {
      const sectionType = section.dataset.taskType;
      const summaryTitle = section.querySelector('.fold-summary h2');
      const baseTitle = summaryTitle ? (summaryTitle.dataset.baseTitle || summaryTitle.textContent.replace(/\s*\(\d+\)\s*$/, '')) : '';

      if (summaryTitle && !summaryTitle.dataset.baseTitle) {
        summaryTitle.dataset.baseTitle = baseTitle;
      }

      if (!hasKeyword) {
        section.open = false;
        if (summaryTitle) {
          summaryTitle.textContent = baseTitle;
        }
        return;
      }

      const count = matchCounts[sectionType] || 0;
      section.open = count > 0;
      if (summaryTitle) {
        summaryTitle.textContent = `${baseTitle} (${count})`;
      }
    });
  }

  function updateNoSearchResultsBanner(matchCounts) {
    const hasKeyword = Boolean(currentSearchKeyword);
    const totalMatches = Object.values(matchCounts).reduce((sum, count) => sum + count, 0);
    const shouldShow = hasKeyword && totalMatches === 0;

    if (shouldShow) {
      noSearchResultsBanner.hidden = false;
      noSearchResultsBanner.textContent = `未找到匹配任务：${taskSearchInput.value.trim()}`;
    } else {
      noSearchResultsBanner.hidden = true;
      noSearchResultsBanner.textContent = '未找到匹配任务';
    }
  }

  // 重新加载所有任务列表的函数
  function loadAllTaskLists() {
    chrome.storage.local.get(TASK_STORAGE_KEYS, res => {
      const { normalizedTasks, updated } = normalizeStoredTaskIds(res);
      const renderNormalizedTasks = () => {
        const matchCounts = {};

        TASK_TYPE_NAMES.forEach(type => {
          const config = TASK_TYPES[type];
          matchCounts[type] = renderTasks(normalizedTasks[config.storageKey] || [], config.listId, type);
        });

        updateFoldSectionsBySearch(matchCounts);
        updateNoSearchResultsBanner(matchCounts);
      };

      if (updated) {
        chrome.storage.local.set(normalizedTasks, renderNormalizedTasks);
        return;
      }

      renderNormalizedTasks();
    });
  }

  taskSearchInput.addEventListener('input', () => {
    currentSearchKeyword = taskSearchInput.value.trim().toLowerCase();
    updateClearSearchButtonState();
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(() => {
      loadAllTaskLists();
    }, 150);
  });

  clearSearchButton.addEventListener('click', () => {
    clearSearchAndReload(true);
  });

  noSearchResultsBanner.addEventListener('click', () => {
    clearSearchAndReload(true);
  });

  noSearchResultsBanner.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      clearSearchAndReload(true);
    }
  });

  function setDefaultOnceDateTime() {
    const dateInput = document.getElementById('once-date');
    const timeInput = document.getElementById('once-time');
    if (!dateInput || !timeInput) return;

    const nextHour = new Date(Date.now() + 60 * 60 * 1000);
    dateInput.value = formatDateLocal(nextHour.getTime());
    timeInput.value = formatTimeLocal(nextHour.getTime());
  }

  // 为“添加单次打开任务”按钮绑定事件
  document.getElementById('addOnceTask').addEventListener('click', () => {
    const urlInput = document.getElementById('once-url');
    const dateInput = document.getElementById('once-date');
    const timeInput = document.getElementById('once-time');
    const url = urlInput.value.trim();
    const openDate = dateInput.value;
    const openTime = timeInput.value;

    if (!isValidHttpUrl(url)) {
      alert('请输入有效的网址（以 http:// 或 https:// 开头）');
      return;
    }
    if (!openDate) {
      alert('请选择打开日期');
      return;
    }
    if (!openTime) {
      alert('请选择打开时间');
      return;
    }

    const nextTime = parseLocalDateTime(openDate, openTime);
    if (Number.isNaN(nextTime)) {
      alert('请输入有效的打开日期时间');
      return;
    }
    if (nextTime <= Date.now()) {
      alert('单次任务的打开时间必须晚于当前时间');
      return;
    }

    chrome.storage.local.get(['onceTasks'], res => {
      const onceTasks = res.onceTasks || [];
      onceTasks.push({ id: createTaskId('once'), url, nextTime });
      chrome.storage.local.set({ onceTasks }, () => {
        urlInput.value = '';
        setDefaultOnceDateTime();
        rescheduleAllAndReload();
      });
    });
  });

  // 为“添加任务”按钮绑定事件
  document.getElementById('addTask').addEventListener('click', () => {
    const urlInput = document.getElementById('url');
    const intervalInput = document.getElementById('interval');
    const url = urlInput.value.trim();
    const interval = parsePositiveInteger(intervalInput.value);

    if (!isValidHttpUrl(url)) {
        alert('请输入有效的网址（以 http:// 或 https:// 开头）');
        return;
    }
    if (Number.isNaN(interval)) {
        alert('请输入有效的正整数间隔天数');
        return;
    }
    const now = new Date();
    const openTime = now.toTimeString().slice(0, 5);
    const nextTime = now.getTime() + interval * 24 * 60 * 60 * 1000;
    chrome.storage.local.get(['openTasks'], res => {
      const openTasks = res.openTasks || [];
      openTasks.push({ id: createTaskId('open'), url, interval, nextTime, openTime });
      chrome.storage.local.set({ openTasks }, () => {
        urlInput.value = ''; // 清空输入框
        intervalInput.value = ''; // 清空输入框
        rescheduleAllAndReload();
      });
    });
  });

  // 为“添加每N小时打开任务”按钮绑定事件
  document.getElementById('addHourlyTask').addEventListener('click', () => {
    const urlInput = document.getElementById('hourly-url');
    const intervalInput = document.getElementById('hourly-interval');
    const url = urlInput.value.trim();
    const interval = parsePositiveInteger(intervalInput.value);

    if (!isValidHttpUrl(url)) {
      alert('请输入有效的网址（以 http:// 或 https:// 开头）');
      return;
    }
    if (Number.isNaN(interval)) {
      alert('请输入有效的正整数间隔小时数');
      return;
    }

    const nextTime = Date.now() + interval * 60 * 60 * 1000;
    chrome.storage.local.get(['hourlyTasks'], res => {
      const hourlyTasks = res.hourlyTasks || [];
      hourlyTasks.push({ id: createTaskId('hourly'), url, interval, nextTime });
      chrome.storage.local.set({ hourlyTasks }, () => {
        urlInput.value = '';
        intervalInput.value = '';
        rescheduleAllAndReload();
      });
    });
  });

  // 为“添加后台访问任务”按钮绑定事件
  document.getElementById('addBgTask').addEventListener('click', () => {
    const urlInput = document.getElementById('bg-url');
    const intervalInput = document.getElementById('bg-interval');
    const url = urlInput.value.trim();
    const interval = parsePositiveInteger(intervalInput.value);

    if (!isValidHttpUrl(url)) {
        alert('请输入有效的网址（以 http:// 或 https:// 开头）');
        return;
    }
    if (Number.isNaN(interval)) {
        alert('请输入有效的正整数间隔分钟');
        return;
    }

    const nextTime = Date.now() + interval * 60 * 1000;
    chrome.storage.local.get(['bgTasks'], res => {
      const bgTasks = res.bgTasks || [];
      bgTasks.push({ id: createTaskId('bg'), url, interval, nextTime });
      chrome.storage.local.set({ bgTasks }, () => {
        urlInput.value = '';
        intervalInput.value = '';
        rescheduleAllAndReload();
      });
    });
  });

  // 为“添加刷新任务”按钮绑定事件
  document.getElementById('addRefreshTask').addEventListener('click', () => {
    const urlInput = document.getElementById('refresh-url');
    const intervalInput = document.getElementById('refresh-interval');
    const url = urlInput.value.trim();
    const interval = parsePositiveInteger(intervalInput.value);

    if (!url) { // 刷新任务的 URL 可以是任何字符串，不强制 http/https
        alert('请输入有效的网址前缀');
        return;
    }
    if (Number.isNaN(interval)) {
        alert('请输入有效的正整数间隔分钟');
        return;
    }

    const nextTime = Date.now() + interval * 60 * 1000;
    chrome.storage.local.get(['refreshTasks'], res => {
      const refreshTasks = res.refreshTasks || [];
      refreshTasks.push({ id: createTaskId('refresh'), url, interval, nextTime });
      chrome.storage.local.set({ refreshTasks }, () => {
        urlInput.value = '';
        intervalInput.value = '';
        rescheduleAllAndReload();
      });
    });
  });

  // 初始加载所有任务列表
  updateClearSearchButtonState();
  setDefaultOnceDateTime();
  loadAllTaskLists();
});
