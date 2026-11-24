// Helpers shared by the sidebar and the background script.

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent != null) node.textContent = textContent;
  return node;
}

// Opens a URL in a new tab next to the current one (or reuses the current tab
// for the address-bar keyword when Firefox asks for it).
async function openTab(url, disposition = "newForegroundTab") {
  if (disposition === "currentTab") return browser.tabs.update({ url });
  return browser.tabs.create({ url, active: disposition !== "newBackgroundTab" });
}
