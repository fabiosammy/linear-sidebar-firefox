// Linear in the sidebar: a team's open issues, your issues and its projects,
// a search by issue ID or title, and an issue's details (description included)
// without leaving the page you're on.

const $ = (id) => document.getElementById(id);
const list = $("list");
const status = $("status");

let listToken = 0; // bumped on every view change so late answers are dropped
let teams = [];
let teamId = null;
let urlKey = null; // the workspace's part of linear.app URLs

const team = () => teams.find((t) => t.id === teamId);

function setStatus(message) {
  status.textContent = message;
}

// Turns API errors into something readable; `what` is e.g. "the issues".
function describeError(err, what) {
  if (err.message === NO_KEY) {
    showSetup("Linear didn't accept the saved API key. Paste a new one.");
    return "";
  }
  return `Couldn't load ${what}: ${err.message}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : "");

// --- Navigation -----------------------------------------------------------------
//
// Where the sidebar is, as a stack of places (storage.local "nav"), so closing
// it or switching to another sidebar and back reopens the same screen at the
// same scroll position. Back pops the stack. A place is one of:
//   { view: "issues" | "mine" | "projects" }    a tab
//   { view: "results", query }                   title search results
//   { view: "project", project: { id, name, url } }
//   { view: "issue", id }                        id = "DOS-123"
// Each place may carry `scroll`, the list's scroll position.

const TABS = ["issues", "mine", "projects", "results"];
const MAX_DEPTH = 20;

let stack = [{ view: "issues" }];
let pendingScroll = null; // scroll to restore once the place has content

const here = () => stack[stack.length - 1];
const saveNav = () => browser.storage.local.set({ nav: stack });

// Opens a place on top of the current one; `root` starts over from it (tabs).
function go(place, { root = false } = {}) {
  stack = root ? [place] : [...stack, place].slice(-MAX_DEPTH);
  saveNav();
  return render();
}

function back() {
  stack = stack.length > 1 ? stack.slice(0, -1) : [{ view: "issues" }];
  saveNav();
  return render();
}

// Remembers the scroll position, a moment after the user stops scrolling.
let scrollTimer = null;
list.addEventListener("scroll", () => {
  if (pendingScroll !== null) return; // still drawing; keep the saved one
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    here().scroll = list.scrollTop;
    saveNav();
  }, 200);
});

function restoreScroll() {
  if (pendingScroll === null) return;
  list.scrollTop = pendingScroll;
  pendingScroll = null;
}

// Draws the place on top of the stack.
function render() {
  const place = here();
  listToken++;
  clearTimeout(scrollTimer);
  pendingScroll = place.scroll ?? 0;
  list.replaceChildren();
  setStatus("");
  const tab = stack[0].view;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === tab));
  $("tabs").querySelector('[data-view="results"]').hidden = tab !== "results";
  if (tab === "results") $("search").value = stack[0].query;
  renderSortBar(place.view);
  switch (place.view) {
    case "mine":
      return showMine();
    case "projects":
      return showProjects();
    case "results":
      return showResults(place.query);
    case "project":
      return showProject(place.project);
    case "issue":
      return showIssue(place.id);
    default:
      return showIssues();
  }
}

// --- Sorting ----------------------------------------------------------------------
//
// One sort for issue lists (team, mine, search, project issues) and one for
// projects, remembered in storage.local "sorts".

const SORTS = { issues: ISSUE_SORTS, projects: PROJECT_SORTS };
const sorts = { issues: { field: "updatedAt", order: "Descending" }, projects: { field: "updatedAt", order: "Descending" } };
const sortKind = (view) => (view === "projects" ? "projects" : view === "issue" ? null : "issues");

function renderSortBar(view) {
  const kind = sortKind(view);
  $("sort-bar").hidden = !kind;
  if (!kind) return;
  const { field, order } = sorts[kind];
  $("sort").replaceChildren(
    ...SORTS[kind].map(([value, label]) => {
      const option = el("option", null, label);
      option.value = value;
      return option;
    }),
  );
  $("sort").value = field;
  $("sort-order").textContent = order === "Ascending" ? "↑" : "↓";
  $("sort-order").title = order === "Ascending" ? "Ascending (click for descending)" : "Descending (click for ascending)";
}

async function setSort(kind, sort) {
  sorts[kind] = sort;
  await browser.storage.local.set({ sorts });
  here().scroll = 0;
  render();
}

$("sort").addEventListener("change", () => {
  const kind = sortKind(here().view);
  const [field, , order] = SORTS[kind].find(([value]) => value === $("sort").value);
  setSort(kind, { field, order });
});

$("sort-order").addEventListener("click", () => {
  const kind = sortKind(here().view);
  const { field, order } = sorts[kind];
  setSort(kind, { field, order: order === "Ascending" ? "Descending" : "Ascending" });
});

// --- Lists ------------------------------------------------------------------------

// Fills the list one page at a time, with "Load more" while Linear has more.
// `fetchPage(after)` returns a connection ({ nodes, pageInfo }).
async function loadPaged({ fetchPage, render: draw, loadingText, emptyText, what, done }) {
  const token = listToken;
  let after = null;
  let count = 0;
  const more = el("button", "more", "Load more");

  async function nextPage() {
    more.remove();
    setStatus(loadingText);
    try {
      const page = await fetchPage(after);
      if (token !== listToken) return; // the user switched views meanwhile
      const nodes = draw(page.nodes);
      count += page.nodes.length;
      list.append(...nodes);
      after = page.pageInfo.endCursor;
      if (page.pageInfo.hasNextPage) list.append(more);
      else done?.();
      setStatus(count ? "" : emptyText);
    } catch (err) {
      if (token === listToken) setStatus(describeError(err, what));
    }
    if (token === listToken) restoreScroll();
  }

  more.addEventListener("click", nextPage);
  await nextPage();
}

// A row: a status marker, the title and a muted second line. Click runs
// `onClick`; Ctrl/⌘+click or middle-click opens `url` in a tab.
function itemButton({ marker, line1, line2, url }, onClick) {
  const button = el("button", "item");
  if (marker) button.appendChild(marker);
  const lines = el("div", "lines");
  lines.append(el("div", "line1", line1 || ""), el("div", "line2", line2 || ""));
  button.appendChild(lines);
  button.title = `${line1}\nCtrl+click or middle-click: open in Linear`;
  button.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey) openTab(url);
    else onClick();
  });
  button.addEventListener("auxclick", (event) => {
    if (event.button === 1) openTab(url);
  });
  return button;
}

function stateDot(state) {
  const dot = el("span", `dot ${state?.type ?? ""}`);
  if (state?.color) dot.style.setProperty("--dot", state.color);
  dot.title = state?.name ?? "";
  return dot;
}

function issueRow(issue) {
  return itemButton(
    {
      marker: stateDot(issue.state),
      line1: issue.title,
      line2: [issue.identifier, issue.state?.name, issue.assignee?.displayName].filter(Boolean).join(" · "),
      url: issue.url,
    },
    () => go({ view: "issue", id: issue.identifier }),
  );
}

function issueList({ filter, loadingText, emptyText, what = "the issues" }) {
  return loadPaged({
    fetchPage: (after) => gql("issues", { filter, after, sort: sortArg(sorts.issues) }).then((data) => data.issues),
    render: (issues) => issues.map(issueRow),
    what,
    loadingText,
    emptyText,
  });
}

function showIssues() {
  return issueList({
    filter: { team: { id: { eq: teamId } }, ...OPEN_STATES },
    loadingText: `Loading ${team()?.key} issues…`,
    emptyText: "No open issues in this team.",
  });
}

function showMine() {
  return issueList({
    filter: { team: { id: { eq: teamId } }, assignee: { isMe: { eq: true } }, ...OPEN_STATES },
    loadingText: "Loading your issues…",
    emptyText: "No open issues assigned to you in this team.",
  });
}

function showResults(query) {
  return issueList({
    filter: { team: { id: { eq: teamId } }, title: { containsIgnoreCase: query } },
    loadingText: `Searching for “${query}”…`,
    emptyText: `No ${team()?.key} issue titles contain “${query}”.`,
  });
}

const FINISHED = ["completed", "canceled"];

function projectRow(project) {
  const bar = el("span", "bar");
  bar.style.setProperty("--progress", project.progress ?? 0);
  if (project.status?.color) bar.style.setProperty("--dot", project.status.color);
  const line2 = [
    project.status?.name,
    `${Math.round((project.progress ?? 0) * 100)}%`,
    project.lead?.displayName,
    project.targetDate && `due ${formatDate(project.targetDate)}`,
  ];
  const { id, name, url } = project;
  return itemButton({ marker: bar, line1: name, line2: line2.filter(Boolean).join(" · "), url }, () =>
    go({ view: "project", project: { id, name, url } }),
  );
}

const fetchProjects = (after) =>
  gql("projects", { teamId, after, sort: sortArg(sorts.projects) }).then((data) => data.team.projects);

// Linear can't sort projects by progress, so this loads every page and sorts
// here (ties by name), handing loadPaged a single page with nothing after it.
async function allProjectsByProgress() {
  const nodes = [];
  let page = { pageInfo: { hasNextPage: true, endCursor: null } };
  while (page.pageInfo.hasNextPage) {
    page = await fetchProjects(page.pageInfo.endCursor);
    nodes.push(...page.nodes);
  }
  const sign = sorts.projects.order === "Ascending" ? 1 : -1;
  nodes.sort((a, b) => sign * ((a.progress ?? 0) - (b.progress ?? 0)) || a.name.localeCompare(b.name));
  return { nodes, pageInfo: { hasNextPage: false, endCursor: null } };
}

// Open projects first; finished ones behind a button once all are loaded.
function showProjects() {
  const finished = [];
  return loadPaged({
    fetchPage: sorts.projects.field === "progress" ? allProjectsByProgress : fetchProjects,
    render: (projects) => {
      finished.push(...projects.filter((p) => FINISHED.includes(p.status?.type)));
      return projects.filter((p) => !FINISHED.includes(p.status?.type)).map(projectRow);
    },
    done: () => {
      if (!finished.length) return;
      const button = el("button", "more", `Show finished projects (${finished.length})`);
      button.addEventListener("click", () => button.replaceWith(el("h3", "section-title", "Finished"), ...finished.map(projectRow)));
      list.append(button);
    },
    what: "the projects",
    loadingText: `Loading ${team()?.key} projects…`,
    emptyText: "This team has no projects.",
  });
}

// A header with Back, a name and buttons, on top of a project or an issue.
function head(name, buttons) {
  const node = el("div", "collection-head");
  const backButton = el("button", null, "←");
  backButton.title = "Back";
  backButton.addEventListener("click", back);
  node.append(backButton, el("div", "name", name), ...buttons);
  return node;
}

function iconButton(text, title, onClick) {
  const button = el("button", "icon", text);
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function showProject(project) {
  list.append(head(project.name, [iconButton("↗", "Open the project in Linear", () => openTab(project.url))]));
  return issueList({
    filter: { project: { id: { eq: project.id } }, ...OPEN_STATES },
    what: "the project's issues",
    loadingText: "Loading the project's issues…",
    emptyText: "No open issues in this project.",
  });
}

function chip(text, color) {
  const node = el("span", "chip");
  if (color !== undefined) {
    const swatch = el("span", "swatch");
    if (color) swatch.style.setProperty("--dot", color);
    node.append(swatch);
  }
  node.append(text);
  return node;
}

// An issue's details and description.
async function showIssue(identifier) {
  const token = listToken;
  setStatus(`Loading ${identifier}…`);
  try {
    const { issue } = await gql("issue", { id: identifier });
    if (token !== listToken) return;
    setStatus("");
    const copy = iconButton("🔗", "Copy the issue's link", async () => {
      await navigator.clipboard.writeText(issue.url);
      setStatus(`Copied the link to ${issue.identifier}.`);
    });
    list.append(head(issue.identifier, [copy, iconButton("↗", "Open in Linear", () => openTab(issue.url))]), issueDetails(issue));
  } catch (err) {
    if (token !== listToken) return;
    const missing = /not found|entity not found/i.test(err.message);
    list.append(head(identifier, []));
    setStatus(missing ? `There's no issue ${identifier}, or you can't see it.` : describeError(err, identifier));
  }
  restoreScroll();
}

function issueDetails(issue) {
  const node = el("article", "issue");
  const chips = el("div", "chips");
  chips.append(chip(issue.state.name, issue.state.color));
  if (issue.priorityLabel && issue.priorityLabel !== "No priority") chips.append(chip(issue.priorityLabel));
  chips.append(chip(issue.assignee ? `👤 ${issue.assignee.displayName}` : "Unassigned"));
  if (issue.project) {
    const { id, name, url } = issue.project;
    const project = chip(`▦ ${name}`);
    project.title = "Open the project's issues";
    project.style.cursor = "pointer";
    project.addEventListener("click", () => go({ view: "project", project: { id, name, url } }));
    chips.append(project);
  }
  for (const label of issue.labels.nodes) chips.append(chip(label.name, label.color));

  const when = [
    issue.team.name,
    issue.creator && `opened by ${issue.creator.displayName}`,
    `on ${formatDate(issue.createdAt)}`,
    `updated ${formatDate(issue.updatedAt)}`,
  ];
  const description = issue.description?.trim()
    ? renderMarkdown(issue.description)
    : el("div", "markdown empty", "No description.");
  node.append(el("h1", null, issue.title), chips, el("div", "when", when.filter(Boolean).join(" · ")), description);
  return node;
}

// --- Search -------------------------------------------------------------------

// "DOS-123", "dos 123", "123" (this team) or a linear.app link open the issue;
// any other text searches the team's issue titles, open and closed.
function search(text) {
  const query = text.trim();
  if (!query) return;
  const identifier =
    identifierFromUrl(query) ?? parseIdentifier(query) ?? (/^\d+$/.test(query) ? `${team()?.key}-${query}` : null);
  if (identifier) return go({ view: "issue", id: identifier });
  return go({ view: "results", query }, { root: true });
}

$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  search($("search").value);
});

// --- Links ----------------------------------------------------------------------

// Links never navigate the sidebar: Linear issue links open here (Ctrl/⌘ or
// middle-click: in a tab), everything else in a new tab.
function followLink(event) {
  const a = event.target.closest("a[href]");
  if (!a) return;
  event.preventDefault();
  const identifier = identifierFromUrl(a.href);
  const newTab = event.type === "auxclick" || event.ctrlKey || event.metaKey;
  if (identifier && !newTab && $("setup").hidden) go({ view: "issue", id: identifier });
  else openTab(a.href);
}
document.addEventListener("click", followLink);
document.addEventListener("auxclick", (event) => event.button === 1 && followLink(event));

// --- Setup and start --------------------------------------------------------------

const MAIN = ["top", "search-form", "tabs", "sort-bar", "list", "status"];

function showSetup(message = "") {
  listToken++;
  $("setup").hidden = false;
  for (const id of MAIN) $(id).hidden = true;
  $("setup-status").textContent = message;
  $("key").focus();
}

$("key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  // permissions.request must run directly inside the user's action.
  const granted = browser.permissions.request(HOST_ACCESS);
  const key = $("key").value.trim();
  $("save-key").disabled = true;
  try {
    if (!(await granted)) throw new Error("Firefox needs access to api.linear.app for the sidebar to work.");
    $("setup-status").textContent = "Checking the key…";
    const data = await gql("viewer", {}, key).catch((err) => {
      throw new Error(err.message === NO_KEY ? "Linear didn't accept this key." : err.message);
    });
    await browser.storage.local.set({ apiKey: key, urlKey: data.organization.urlKey });
    $("key").value = "";
    await start();
  } catch (err) {
    $("setup-status").textContent = err.message;
  } finally {
    $("save-key").disabled = false;
  }
});

$("disconnect").addEventListener("click", async () => {
  await browser.storage.local.remove(["apiKey", "urlKey"]);
  showSetup("Disconnected. The API key was removed from this browser; revoke it in Linear if you no longer need it.");
});

// A new team starts over on the same tab (search results become Issues).
$("team").addEventListener("change", async () => {
  teamId = $("team").value;
  await browser.storage.local.set({ teamId });
  const tab = stack[0].view;
  go({ view: ["mine", "projects"].includes(tab) ? tab : "issues" }, { root: true });
});

$("refresh").addEventListener("click", () => render());

$("open-team").addEventListener("click", () => openTab(`https://linear.app/${urlKey}/team/${team()?.key}/active`));

$("tabs").addEventListener("click", (event) => {
  const name = event.target.closest("button")?.dataset.view;
  if (!name) return;
  if (name !== "results") $("search").value = "";
  go(name === "results" ? { view: "results", query: stack[0].query ?? $("search").value.trim() } : { view: name }, {
    root: true,
  });
});

// A saved stack from an older version or a bad write falls back to Issues.
function validStack(saved) {
  if (!Array.isArray(saved) || !saved.length || !TABS.includes(saved[0]?.view)) return null;
  if (saved[0].view === "results" && !saved[0].query) return null;
  return saved;
}

async function start() {
  const stored = await browser.storage.local.get(["apiKey", "teamId", "nav", "sorts"]);
  if (!stored.apiKey || !(await browser.permissions.contains(HOST_ACCESS))) return showSetup();
  for (const kind of Object.keys(sorts)) {
    const saved = stored.sorts?.[kind];
    if (SORTS[kind].some(([field]) => field === saved?.field)) sorts[kind] = saved;
  }
  stack = validStack(stored.nav) ?? [{ view: "issues" }];
  $("setup").hidden = true;
  for (const id of MAIN) $(id).hidden = false;
  setStatus("Connecting to Linear…");
  try {
    const data = await gql("viewer");
    urlKey = data.organization.urlKey;
    teams = data.teams.nodes.sort((a, b) => a.name.localeCompare(b.name));
    await browser.storage.local.set({ urlKey });
  } catch (err) {
    return setStatus(describeError(err, "your teams"));
  }
  if (!teams.length) return setStatus("Your Linear account isn't in any team.");
  teamId = teams.some((t) => t.id === stored.teamId) ? stored.teamId : teams[0].id;
  $("team").replaceChildren(
    ...teams.map((t) => {
      const option = el("option", null, `${t.name} (${t.key})`);
      option.value = t.id;
      return option;
    }),
  );
  $("team").value = teamId;
  render();
}

start();
