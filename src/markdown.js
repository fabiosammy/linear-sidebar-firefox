// Renders the Markdown of issue descriptions into DOM nodes. It only builds
// elements and text nodes (never HTML strings), so nothing in an issue can
// run script in the sidebar. Covers what Linear writes: headings, lists and
// checklists, quotes, code, tables, rules, links, images and its collapsible
// sections ("+++ Title" ... "+++").

// Only these link targets are kept; anything else renders as plain text.
function safeUrl(url) {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

function link(href, children) {
  const a = document.createElement("a");
  a.href = href;
  a.append(...children);
  return a;
}

// Inline syntax, longest first. Each rule turns a regex match into nodes.
const INLINE = [
  [/`([^`]+)`/, (m) => el("code", null, m[1])],
  // Linear upload images need a signed-in session, so they open as a link.
  [/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/, (m) => (safeUrl(m[2]) ? link(m[2], [`🖼 ${m[1] || "image"}`]) : m[0])],
  [/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/, (m) => (safeUrl(m[2]) ? link(m[2], inline(m[1])) : m[1])],
  [/<(https?:\/\/[^>\s]+)>/, (m) => link(m[1], [m[1]])],
  [/\*\*(.+?)\*\*|__(.+?)__/, (m) => wrap("strong", m[1] ?? m[2])],
  [/~~(.+?)~~/, (m) => wrap("s", m[1])],
  [/(?<![\w*])\*(?!\s)(.+?)\*(?!\w)|(?<!\w)_(?!\s)(.+?)_(?!\w)/, (m) => wrap("em", m[1] ?? m[2])],
  [/https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/, (m) => link(m[0], [m[0]])],
];

function wrap(tag, text) {
  const node = document.createElement(tag);
  node.append(...inline(text));
  return node;
}

// Text -> list of nodes/strings, applying the earliest matching inline rule.
function inline(text) {
  const out = [];
  let rest = text;
  while (rest) {
    let best = null;
    for (const [re, make] of INLINE) {
      const m = rest.match(re);
      if (m && (!best || m.index < best.m.index)) best = { m, make };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index) out.push(rest.slice(0, best.m.index));
    out.push(best.make(best.m));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

// Lines -> block nodes. Recursive for quotes and collapsible sections.
function blocks(lines) {
  const out = [];
  let i = 0;
  const paragraph = [];

  function flush() {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    paragraph.forEach((line, n) => {
      if (n) p.append(document.createElement("br"));
      p.append(...inline(line));
    });
    out.push(p);
    paragraph.length = 0;
  }

  while (i < lines.length) {
    const line = lines[i];
    let m;

    if (!line.trim()) {
      flush();
      i++;
    } else if ((m = line.match(/^\s*(```|~~~)/))) {
      flush();
      const fence = m[1];
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i++]);
      i++;
      const pre = document.createElement("pre");
      pre.append(el("code", null, code.join("\n")));
      out.push(pre);
    } else if ((m = line.match(/^\+\+\+\s*(.*)$/))) {
      flush();
      const inner = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "+++") inner.push(lines[i++]);
      i++;
      const details = document.createElement("details");
      details.append(el("summary", null, m[1] || "Details"), ...blocks(inner));
      out.push(details);
    } else if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      flush();
      const h = document.createElement(`h${Math.min(6, m[1].length + 2)}`);
      h.append(...inline(m[2]));
      out.push(h);
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push(document.createElement("hr"));
      i++;
    } else if (/^\s*>/.test(line)) {
      flush();
      const inner = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ""));
      const quote = document.createElement("blockquote");
      quote.append(...blocks(inner));
      out.push(quote);
    } else if (line.includes("|") && TABLE_RULE.test(lines[i + 1] ?? "")) {
      flush();
      const table = document.createElement("table");
      const head = document.createElement("tr");
      for (const c of cells(line)) head.append(wrap("th", c));
      table.append(head);
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        const row = document.createElement("tr");
        for (const c of cells(lines[i++])) row.append(wrap("td", c));
        table.append(row);
      }
      const scroll = el("div", "table-scroll");
      scroll.append(table);
      out.push(scroll);
    } else if (LIST_ITEM.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && (LIST_ITEM.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) items.push(lines[i++]);
      out.push(listBlock(items));
    } else {
      paragraph.push(line);
      i++;
    }
  }
  flush();
  return out;
}

// Nested lists by indentation; "[ ]" / "[x]" become checkboxes.
function listBlock(lines) {
  const indent = lines[0].match(LIST_ITEM)?.[1].length ?? 0;
  const ordered = /^\d/.test(lines[0].match(LIST_ITEM)?.[2] ?? "");
  const node = document.createElement(ordered ? "ol" : "ul");
  let item = null;
  let child = [];

  function closeChild() {
    if (item && child.length) item.append(listBlock(child));
    child = [];
  }

  for (const line of lines) {
    const m = line.match(LIST_ITEM);
    if (m && m[1].length <= indent) {
      closeChild();
      item = document.createElement("li");
      const task = m[3].match(/^\[([ xX])\]\s*(.*)$/);
      if (task) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = task[1] !== " ";
        box.disabled = true;
        item.className = "task";
        item.append(box, ...inline(task[2]));
      } else {
        item.append(...inline(m[3]));
      }
      node.append(item);
    } else if (m) {
      child.push(line);
    } else if (item) {
      item.append(document.createElement("br"), ...inline(line.trim()));
    }
  }
  closeChild();
  return node;
}

function renderMarkdown(text) {
  const root = el("div", "markdown");
  root.append(...blocks((text || "").replace(/\r\n?/g, "\n").split("\n")));
  return root;
}
