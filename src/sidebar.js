// Linear in the sidebar: a team's open issues, your issues and its projects,
// a search by issue ID or title, and an issue's details (description included)
// without leaving the page you're on.

const $ = (id) => document.getElementById(id);
const list = $("list");
const status = $("status");

let view = "issues";
let listToken = 0; // bumped on every view change so late answers are dropped
let rerender = () => {}; // redraws the current view (Reload button)
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

// --- Views ------------------------------------------------------------------

function setView(name, render) {
  view = name;
  rerender = render;
  listToken++;
  list.replaceChildren();
  list.scrollTop = 0;
  setStatus("");
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (["issues", "mine", "projects"].includes(name)) browser.storage.local.set({ view: name });
}

// Fills the list one page at a time, with "Load more" while Linear has more.
// `fetchPage(after)` returns a connection ({ nodes, pageInfo }).
async function loadPaged({ fetchPage, render, loadingText, emptyText, what, done }) {
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
      const nodes = render(page.nodes);
      count += page.nodes.length;
      list.append(...nodes);
      after = page.pageInfo.endCursor;
      if (page.pageInfo.hasNextPage) list.append(more);
      else done?.();
      setStatus(count ? "" : emptyText);
    } catch (err) {
      if (token === listToken) setStatus(describeError(err, what));
    }
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

function issueRow(issue, back) {
  return itemButton(
    {
      marker: stateDot(issue.state),
      line1: issue.title,
      line2: [issue.identifier, issue.state?.name, issue.assignee?.displayName].filter(Boolean).join(" · "),
      url: issue.url,
    },
    () => showIssue(issue.identifier, back),
  );
}

function issuesView({ name, filter, loadingText, emptyText }) {
  const render = () => {
    setView(name, render);
    return loadPaged({
      fetchPage: (after) => gql("issues", { filter, after }).then((data) => data.issues),
      render: (issues) => issues.map((issue) => issueRow(issue, render)),
      what: "the issues",
      loadingText,
      emptyText,
    });
  };
  return render();
}

function showIssues() {
  return issuesView({
    name: "issues",
    filter: { team: { id: { eq: teamId } }, ...OPEN_STATES },
    loadingText: `Loading ${team()?.key} issues…`,
    emptyText: "No open issues in this team.",
  });
}

function showMine() {
  return issuesView({
    name: "mine",
    filter: { team: { id: { eq: teamId } }, assignee: { isMe: { eq: true } }, ...OPEN_STATES },
    loadingText: "Loading your issues…",
    emptyText: "No open issues assigned to you in this team.",
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
  return itemButton({ marker: bar, line1: project.name, line2: line2.filter(Boolean).join(" · "), url: project.url }, () =>
    showProject(project),
  );
}

// Open projects first; finished ones behind a button once all are loaded.
function showProjects() {
  setView("projects", showProjects);
  const finished = [];
  return loadPaged({
    fetchPage: (after) => gql("projects", { teamId, after }).then((data) => data.team.projects),
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
function head(name, back, buttons) {
  const node = el("div", "collection-head");
  const backButton = el("button", null, "←");
  backButton.title = "Back";
  backButton.addEventListener("click", () => back());
  node.append(backButton, el("div", "name", name), ...buttons);
  return node;
}

function iconButton(text, title, onClick) {
  const button = el("button", "icon", text);
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function showProject(project, back = rerender) {
  const render = () => {
    setView("project", render);
    list.append(head(project.name, back, [iconButton("↗", "Open the project in Linear", () => openTab(project.url))]));
    return loadPaged({
      fetchPage: (after) =>
        gql("issues", { filter: { project: { id: { eq: project.id } }, ...OPEN_STATES }, after }).then((data) => data.issues),
      render: (issues) => issues.map((issue) => issueRow(issue, render)),
      what: "the project's issues",
      loadingText: "Loading the project's issues…",
      emptyText: "No open issues in this project.",
    });
  };
  return render();
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

// An issue's details and description. `back` redraws the view it came from.
async function showIssue(identifier, back = rerender) {
  const render = async () => {
    setView("issue", render);
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
      list.append(
        head(issue.identifier, back, [copy, iconButton("↗", "Open in Linear", () => openTab(issue.url))]),
        issueDetails(issue, render),
      );
    } catch (err) {
      if (token !== listToken) return;
      const missing = /not found|entity not found/i.test(err.message);
      list.append(head(identifier, back, []));
      setStatus(missing ? `There's no issue ${identifier}, or you can't see it.` : describeError(err, identifier));
    }
  };
  return render();
}

function issueDetails(issue, self) {
  const node = el("article", "issue");
  const chips = el("div", "chips");
  chips.append(chip(issue.state.name, issue.state.color));
  if (issue.priorityLabel && issue.priorityLabel !== "No priority") chips.append(chip(issue.priorityLabel));
  chips.append(chip(issue.assignee ? `👤 ${issue.assignee.displayName}` : "Unassigned"));
  if (issue.project) {
    const project = chip(`▦ ${issue.project.name}`);
    project.title = "Open the project's issues";
    project.style.cursor = "pointer";
    project.addEventListener("click", () => showProject(issue.project, self));
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
  if (identifier) return showIssue(identifier);
  $("tabs").querySelector('[data-view="results"]').hidden = false;
  return issuesView({
    name: "results",
    filter: { team: { id: { eq: teamId } }, title: { containsIgnoreCase: query } },
    loadingText: `Searching for “${query}”…`,
    emptyText: `No ${team()?.key} issue titles contain “${query}”.`,
  });
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
  if (identifier && !newTab && view !== "setup") showIssue(identifier);
  else openTab(a.href);
}
document.addEventListener("click", followLink);
document.addEventListener("auxclick", (event) => event.button === 1 && followLink(event));

// --- Setup and start --------------------------------------------------------------

const MAIN = ["top", "search-form", "tabs", "list", "status"];

function showSetup(message = "") {
  view = "setup";
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

$("team").addEventListener("change", async () => {
  teamId = $("team").value;
  await browser.storage.local.set({ teamId });
  $("tabs").querySelector('[data-view="results"]').hidden = true;
  showView(["issues", "mine", "projects"].includes(view) ? view : "issues");
});

$("refresh").addEventListener("click", () => rerender());

$("open-team").addEventListener("click", () => openTab(`https://linear.app/${urlKey}/team/${team()?.key}/active`));

const VIEWS = { issues: showIssues, mine: showMine, projects: showProjects, results: () => search($("search").value) };
const showView = (name) => (VIEWS[name] ?? showIssues)();

$("tabs").addEventListener("click", (event) => {
  const name = event.target.closest("button")?.dataset.view;
  if (name) showView(name);
});

async function start() {
  const stored = await browser.storage.local.get(["apiKey", "teamId", "view"]);
  if (!stored.apiKey || !(await browser.permissions.contains(HOST_ACCESS))) return showSetup();
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
  showView(stored.view);
}

start();
