# Repository Notes

This repository is a Manifest V3 Chrome extension for scheduling URL tasks.

## Main Files
- `manifest.json`: Chrome extension manifest.
- `src/background/background.js`: Service worker. Schedules `chrome.alarms`, executes tasks, and migrates old tasks to stable ids.
- `src/popup/popup.html`: Popup markup.
- `src/popup/popup.css`: Popup styles.
- `src/popup/popup.js`: Popup UI, storage CRUD, import/export, search, and task editing.

## Task Types
Task lists are stored in `chrome.storage.local` with these keys:

- `onceTasks`: open a URL once at a selected date/time, then remove the task.
- `openTasks`: open a URL every N days at a selected time.
- `hourlyTasks`: open a URL every N hours.
- `bgTasks`: open a minimized popup window for background access, then close it.
- `refreshTasks`: refresh tabs whose URL starts with the configured prefix.

Tasks should have a stable `id`. Existing older tasks without `id` are migrated by both `background.js` and `popup.js`.

## Scheduling
Alarms use stable names:

```text
task:<type>:<id>
```

Older alarm names such as `open-0` are still recognized and cleared during rescheduling.

## Development
There is no build step. Load the folder directly in Chrome via "Load unpacked".

Useful local checks:

```bash
node --check src/background/background.js
node --check src/popup/popup.js
```

Do not commit exported personal task backups. Files matching `web-timer-tasks-*.json` are ignored.
