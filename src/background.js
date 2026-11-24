// Toolbar button toggles the sidebar; the "lin" address-bar keyword opens an
// issue by ID ("lin DOS-123") or suggests issues whose title matches.

browser.action.onClicked.addListener(() => browser.sidebarAction.toggle());

browser.omnibox.setDefaultSuggestion({ description: "Open a Linear issue by ID (DOS-123), or type to search titles" });

// Escapes text for omnibox descriptions, which Firefox reads as markup.
const escape = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let suggestTimer = null;

browser.omnibox.onInputChanged.addListener((text, suggest) => {
  clearTimeout(suggestTimer);
  const query = text.trim();
  if (query.length < 3 || parseIdentifier(query)) return suggest([]);
  // Waits for a pause in typing so every keystroke isn't an API call.
  suggestTimer = setTimeout(async () => {
    const { teamId } = await browser.storage.local.get("teamId");
    const filter = { title: { containsIgnoreCase: query }, ...(teamId && { team: { id: { eq: teamId } } }) };
    const sort = sortArg({ field: "updatedAt", order: "Descending" });
    const data = await gql("issues", { filter, sort }).catch(() => null);
    const issues = data?.issues.nodes.slice(0, 6) ?? [];
    suggest(issues.map((i) => ({ content: i.url, description: escape(`${i.identifier} ${i.title} — ${i.state.name}`) })));
  }, 250);
});

browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const input = text.trim();
  if (/^https:\/\/linear\.app\//.test(input)) return openTab(input, disposition);
  const { urlKey } = await browser.storage.local.get("urlKey");
  const identifier = parseIdentifier(input);
  if (identifier && urlKey) return openTab(issueUrl(urlKey, identifier), disposition);
  // Free text (or not connected yet): Linear's own search.
  const workspace = urlKey ? `${urlKey}/` : "";
  return openTab(`https://linear.app/${workspace}search?q=${encodeURIComponent(input)}`, disposition);
});
