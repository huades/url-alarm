# URL Alarm

A lightweight Chrome extension for scheduling URL tasks. It can open pages once at a specific time, open pages repeatedly, visit URLs in the background, and refresh matching tabs.

[Chinese README](README.md)

---

## Features

- **One-time URL opening**: choose a date and time, open the page once, then automatically remove the task.
- **Every N days**: open a URL every N days at a selected time.
- **Every N hours**: open a URL at an hourly interval.
- **Background visits**: open a minimized popup window for a URL and close it automatically.
- **Scheduled tab refresh**: refresh tabs whose URL starts with a configured prefix.
- **Editable tasks**: update URLs, URL prefixes, intervals, and next execution times from the popup.
- **Task search**: filter tasks by URL, type, interval, or next execution time.
- **Theme switcher**: light, dark, or system theme.
- **Run now**: trigger a task immediately.
- **Import/export**: back up and restore scheduled tasks as JSON.

---

## Installation

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

---

## Usage

### 1. One-Time URL Opening

- Enter a URL.
- Choose the date and time.
- Click **Add**.
- The extension opens the page at the selected time and removes the task afterwards.

### 2. Open Every N Days

- Enter a URL and day interval.
- Click **Add**.
- You can later edit the interval, date, and time in the task list.

### 3. Open Every N Hours

- Enter a URL and hour interval.
- Click **Add**.
- You can later edit the interval and next execution time.

### 4. Background Visit

- Enter a URL and minute interval.
- Click **Add**.
- The extension opens a minimized popup window and closes it after about 10 seconds.

### 5. Refresh Matching Tabs

- Enter a URL prefix and minute interval.
- Click **Add**.
- Open tabs whose URL starts with that prefix will be refreshed.

### 6. Run Now

- Click **Run** on a task card.
- One-time tasks are executed and removed.
- Repeating tasks are executed and rescheduled.

### 7. Search

- Type in the search field at the top of the popup.
- Matching task sections expand automatically.
- Click `x` to clear the search.

---

## Behavior Notes

- `onceTasks`: run once at a selected date/time, then delete themselves.
- `openTasks`: run every N days at a selected time.
- `hourlyTasks`: run every N hours.
- `bgTasks`: open a minimized popup and close it automatically.
- `refreshTasks`: reload tabs whose URL starts with the configured prefix.

Tasks use stable ids internally. Alarm names follow this format:

```text
task:<type>:<id>
```

Older saved tasks without ids are migrated automatically.

---

## Project Structure

```text
background.js   # Scheduling and task execution service worker
popup.html      # Popup markup
popup.css       # Popup styles
popup.js        # Popup UI logic and storage operations
manifest.json   # Chrome extension manifest
icon16.png      # Extension icon
icon48.png      # Extension icon
icon128.png     # Extension icon
```

---

## Development

There is no build step.

Useful checks:

```bash
node --check background.js
node --check popup.js
```

Do not commit exported personal task backups. Files matching `web-timer-tasks-*.json` are ignored.

---

## License

MIT
