<p align="center">
  <img src="icons/icon-128.png" width="96" height="96" alt="" />
</p>

<h1 align="center">Sidebar for Linear</h1>

<p align="center">
  Linear in the Firefox sidebar.<br />
  A team's issues and projects, and any issue by its ID with its description,
  next to the page you're working on.
</p>

## Features

- **Issues**: the team's open issues (not done or canceled), most recently
  updated first, with their status, ID and assignee
- **My issues**: the open ones assigned to you
- **Projects**: the team's projects with status, progress, lead and target
  date; finished ones one click away. A project opens to its open issues
- **Search** by ID (`DOS-123`, `dos 123`, or just `123` for the selected
  team), by pasting a linear.app link, or by words in the title
- **Issue details** in the sidebar: status, priority, assignee, project,
  labels and the description (headings, checklists, code, tables, Linear's
  collapsible sections). Issue links inside a description open in the sidebar
  too
- **Open in Linear**: the **↗** button, or Ctrl+click / middle-click on any
  row or link, opens it in a tab; **🔗** copies the issue's link
- **Address bar**: type `lin DOS-123` to open an issue, or `lin` and a few
  words to pick from matching titles
- Toggle with `Alt+Shift+L` or the toolbar button; follows Firefox's
  **light and dark** theme

## Getting started

1. Load the add-on (see [Development setup](#development-setup)).
2. Open the sidebar with `Alt+Shift+L`.
3. In Linear, open **Settings → Security & access** and create a **personal
   API key** (read access is enough). Paste it in the sidebar and click
   **Connect**, then allow access to api.linear.app when Firefox asks.
4. Pick a team at the top. The sidebar remembers it and your last tab.

**⏏** disconnects: it removes the key from Firefox. Revoke it in Linear too if
you don't need it anymore.

## Privacy and permissions

The add-on collects no data. It only talks to api.linear.app, with your API
key, which stays in this Firefox profile's add-on storage.

| Permission | Why |
| --- | --- |
| Access to api.linear.app | To read your teams, projects and issues |
| Storage | To remember the API key, the team and the last tab |

## Development setup

Requires Node.js 24 and Firefox 142 or newer.

```bash
npm install
npm run lint      # Mozilla's add-on linter (warnings fail too)
npm run package   # zip in web-ext-artifacts/
npm start         # throwaway Firefox profile with the add-on loaded
```

To try it in your own Firefox: `about:debugging#/runtime/this-firefox` →
**Load Temporary Add-on…** → pick `manifest.json`. Temporary add-ons are
removed when Firefox restarts.

### How it works

| File | Role |
| --- | --- |
| `src/linear.js` | The GraphQL queries and the API client (`Authorization: <key>` to api.linear.app) |
| `src/sidebar.*` | The sidebar: team picker, lists, search and issue details |
| `src/markdown.js` | Renders issue descriptions by building DOM nodes, never HTML strings, so issue content can't run script |
| `src/background.js` | Toolbar button and the `lin` address-bar keyword |
| `src/common.js` | Helpers shared by the sidebar and the background |

## License

[MIT](LICENSE)

Sidebar for Linear is an independent project. It is not affiliated with,
endorsed by or sponsored by Linear Orbit, Inc.
