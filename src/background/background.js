const TASK_TYPES = Object.freeze({
  once: { storageKey: 'onceTasks' },
  open: { storageKey: 'openTasks' },
  hourly: { storageKey: 'hourlyTasks' },
  bg: { storageKey: 'bgTasks' },
  refresh: { storageKey: 'refreshTasks' }
});

const TASK_TYPE_NAMES = Object.keys(TASK_TYPES);
const TASK_ALARM_PREFIX = 'task';

chrome.runtime.onInstalled.addListener(() => {
  console.log('插件安装或更新');
});

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setStorage(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

function getAllAlarms() {
  return new Promise(resolve => chrome.alarms.getAll(resolve));
}

function clearAlarm(name) {
  return new Promise(resolve => chrome.alarms.clear(name, resolve));
}

function createAlarm(name, alarmInfo) {
  return new Promise(resolve => {
    chrome.alarms.create(name, alarmInfo);
    resolve();
  });
}

function createTaskId(type) {
  if (crypto.randomUUID) {
    return `${type}-${crypto.randomUUID()}`;
  }

  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getTaskConfig(type) {
  return TASK_TYPES[type] || null;
}

function getStorageKey(type) {
  return getTaskConfig(type)?.storageKey || `${type}Tasks`;
}

function getTaskAlarmName(type, taskId) {
  return `${TASK_ALARM_PREFIX}:${type}:${taskId}`;
}

function isManagedTaskAlarmName(name) {
  return name.startsWith(`${TASK_ALARM_PREFIX}:`) || /^(once|open|hourly|bg|refresh)-\d+$/.test(name);
}

function parseAlarmName(name) {
  if (name.startsWith(`${TASK_ALARM_PREFIX}:`)) {
    const [, type, ...idParts] = name.split(':');
    return { type, taskId: idParts.join(':'), legacyIndex: null };
  }

  const legacyMatch = /^(once|open|hourly|bg|refresh)-(\d+)$/.exec(name);
  if (legacyMatch) {
    return { type: legacyMatch[1], taskId: null, legacyIndex: parseInt(legacyMatch[2], 10) };
  }

  return null;
}

function ensureTaskIds(type, tasks) {
  let updated = false;
  const normalizedTasks = tasks.map(task => {
    if (task.id) return task;

    updated = true;
    return {
      ...task,
      id: createTaskId(type)
    };
  });

  return { tasks: normalizedTasks, updated };
}

function getIntervalMs(type, task) {
  if (type === 'open') {
    return task.interval * 24 * 60 * 60 * 1000;
  }

  if (type === 'hourly') {
    return task.interval * 60 * 60 * 1000;
  }

  return task.interval * 60 * 1000;
}

async function clearTaskAlarms() {
  const alarms = await getAllAlarms();
  const taskAlarms = alarms.filter(alarm => isManagedTaskAlarmName(alarm.name));
  await Promise.all(taskAlarms.map(alarm => clearAlarm(alarm.name)));
}

async function rescheduleAllTasks(callback) {
  try {
    await clearTaskAlarms();
    await Promise.all(TASK_TYPE_NAMES.map(type => rescheduleTasks(type)));
    if (callback) callback();
  } catch (error) {
    console.error('重新调度任务失败:', error);
    if (callback) callback(error);
  }
}

async function rescheduleTasks(type) {
  const storageKey = getStorageKey(type);
  const res = await getStorage([storageKey]);
  const storedTasks = Array.isArray(res[storageKey]) ? res[storageKey] : [];
  const normalized = ensureTaskIds(type, storedTasks);
  const tasks = normalized.tasks;
  const now = Date.now();
  let updated = normalized.updated;

  await Promise.all(tasks.map(task => {
    if (type === 'open' && task.openTime && task.nextTime && task.nextTime <= now) {
      task.nextTime = toNextOpenTime(task.openTime, task.interval);
      updated = true;
    }

    if (!Number.isFinite(task.nextTime)) {
      return Promise.resolve();
    }

    return createAlarm(getTaskAlarmName(type, task.id), { when: task.nextTime });
  }));

  if (updated) {
    await setStorage({ [storageKey]: tasks });
  }
}

function toNextOpenTime(openTime, intervalDays) {
  const [hourStr, minuteStr] = openTime.split(':');
  const hours = parseInt(hourStr, 10);
  const minutes = parseInt(minuteStr, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return Date.now();

  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(hours, minutes, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + Math.max(1, intervalDays));
  }

  return candidate.getTime();
}

function executeTask(type, task) {
  console.log(`[定时] 执行 ${type} 任务:`, task.url);

  if (type === 'once' || type === 'open' || type === 'hourly') {
    chrome.tabs.create({ url: task.url });
    return;
  }

  if (type === 'bg') {
    chrome.windows.create({
      url: task.url,
      type: 'popup',
      state: 'minimized',
      focused: false
    }, win => {
      setTimeout(() => {
        chrome.windows.remove(win.id, () => {
          console.log(`[后台访问] 已关闭窗口 ${win.id}`);
        });
      }, 10000); // 10 秒后自动关闭窗口
    });
    return;
  }

  if (type === 'refresh') {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (tab.url && tab.url.startsWith(task.url)) {
          chrome.tabs.reload(tab.id);
        }
      });
    });
  }
}

function findTaskIndex(tasks, taskId, legacyIndex) {
  if (taskId) {
    return tasks.findIndex(task => task.id === taskId);
  }

  return Number.isInteger(legacyIndex) ? legacyIndex : -1;
}

async function handleAlarm(alarm) {
  const parsedAlarm = parseAlarmName(alarm.name);
  if (!parsedAlarm || !getTaskConfig(parsedAlarm.type)) return;

  const type = parsedAlarm.type;
  const storageKey = getStorageKey(type);
  const res = await getStorage([storageKey]);
  const normalized = ensureTaskIds(type, Array.isArray(res[storageKey]) ? res[storageKey] : []);
  const tasks = normalized.tasks;
  const taskIndex = findTaskIndex(tasks, parsedAlarm.taskId, parsedAlarm.legacyIndex);
  const task = tasks[taskIndex];

  if (normalized.updated) {
    await setStorage({ [storageKey]: tasks });
  }

  if (!task || Date.now() < task.nextTime) return;

  executeTask(type, task);

  if (type === 'once') {
    tasks.splice(taskIndex, 1);
    await setStorage({ [storageKey]: tasks });
    await rescheduleAllTasks();
    return;
  }

  if (type === 'open' && task.openTime) {
    task.nextTime = toNextOpenTime(task.openTime, task.interval);
  } else {
    task.nextTime = Date.now() + getIntervalMs(type, task);
  }

  tasks[taskIndex] = task;
  await setStorage({ [storageKey]: tasks });
  await createAlarm(getTaskAlarmName(type, task.id), { when: task.nextTime });
}

// 处理定时任务
chrome.alarms.onAlarm.addListener(alarm => {
  handleAlarm(alarm).catch(error => {
    console.error('处理定时任务失败:', error);
  });
});

async function runTaskNow(type, taskRef) {
  const storageKey = getStorageKey(type);
  const res = await getStorage([storageKey]);
  const normalized = ensureTaskIds(type, Array.isArray(res[storageKey]) ? res[storageKey] : []);
  const tasks = normalized.tasks;
  const taskIndex = taskRef.taskId
    ? tasks.findIndex(task => task.id === taskRef.taskId)
    : taskRef.index;
  const task = tasks[taskIndex];

  if (normalized.updated) {
    await setStorage({ [storageKey]: tasks });
  }

  if (!task) {
    return { ok: false, message: '任务不存在' };
  }

  executeTask(type, task);

  if (type === 'once') {
    tasks.splice(taskIndex, 1);
    await setStorage({ [storageKey]: tasks });
    await rescheduleAllTasks();
    return { ok: true, message: '已执行并移除' };
  }

  if (type === 'open' && task.openTime) {
    task.nextTime = toNextOpenTime(task.openTime, task.interval);
  } else {
    task.nextTime = Date.now() + getIntervalMs(type, task);
  }

  tasks[taskIndex] = task;
  await setStorage({ [storageKey]: tasks });
  await createAlarm(getTaskAlarmName(type, task.id), { when: task.nextTime });
  return { ok: true, message: '已执行' };
}

// 立即执行任务 / 重新调度任务
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ping') {
    sendResponse({ ok: true, message: 'background-ready' });
    return false;
  }

  if (msg.type === 'rescheduleAll') {
    rescheduleAllTasks(error => {
      sendResponse(error
        ? { ok: false, message: '重新调度任务失败' }
        : { ok: true, message: '已重新调度任务' });
    });
    return true;
  }

  if (msg.type !== 'runNow') return false;

  const type = msg.taskType;
  const taskId = typeof msg.taskId === 'string' ? msg.taskId : '';
  const index = Number.isInteger(msg.index) ? msg.index : -1;

  if (!getTaskConfig(type) || (!taskId && index < 0)) {
    sendResponse({ ok: false, message: '任务类型或索引无效' });
    return false;
  }

  runTaskNow(type, { taskId, index })
    .then(sendResponse)
    .catch(error => {
      console.error('立即执行任务失败:', error);
      sendResponse({ ok: false, message: '执行失败' });
    });

  return true;
});

// Register all event listeners before starting asynchronous initialization.
rescheduleAllTasks().catch(error => {
  console.error('初始化定时任务失败:', error);
});
