// Linear GraphQL API client shared by the sidebar and the background script.
// Authenticates with the user's personal API key (storage.local "apiKey").

const API_URL = "https://api.linear.app/graphql";
const HOST_ACCESS = { origins: ["https://api.linear.app/*"] };
const PAGE_SIZE = 50;

// Thrown when there is no key or Linear rejects it, so the UI can ask again.
const NO_KEY = "NO_KEY";

// Issues that aren't done or canceled.
const OPEN_STATES = { state: { type: { nin: ["completed", "canceled"] } } };

const ISSUE_ROW = `
  id
  identifier
  title
  url
  state { name type color }
  assignee { displayName }
`;

const QUERIES = {
  viewer: `
    query Viewer {
      viewer { id displayName }
      organization { name urlKey }
      teams(first: 100) { nodes { id key name } }
    }
  `,

  issues: `
    query Issues($filter: IssueFilter, $after: String) {
      issues(first: ${PAGE_SIZE}, after: $after, filter: $filter, orderBy: updatedAt) {
        nodes { ${ISSUE_ROW} }
        pageInfo { hasNextPage endCursor }
      }
    }
  `,

  projects: `
    query Projects($teamId: String!, $after: String) {
      team(id: $teamId) {
        projects(first: ${PAGE_SIZE}, after: $after, orderBy: updatedAt) {
          nodes {
            id
            name
            url
            progress
            targetDate
            status { name type color }
            lead { displayName }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `,

  // `id` takes the UUID or the identifier (DOS-123).
  issue: `
    query Issue($id: String!) {
      issue(id: $id) {
        ${ISSUE_ROW}
        description
        priorityLabel
        createdAt
        updatedAt
        creator { displayName }
        project { id name url }
        team { key name }
        labels { nodes { name color } }
      }
    }
  `,
};

async function apiKey() {
  const { apiKey: key } = await browser.storage.local.get("apiKey");
  return key || null;
}

// Runs a query from QUERIES. `key` overrides the stored key (to test a new one).
async function gql(name, variables = {}, key = null) {
  const token = key ?? (await apiKey());
  if (!token) throw new Error(NO_KEY);
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query: QUERIES[name], variables }),
  });
  if (response.status === 401) throw new Error(NO_KEY);
  const body = await response.json().catch(() => null);
  const error = body?.errors?.[0];
  const kind = `${error?.extensions?.type} ${error?.extensions?.code}`.toLowerCase();
  if (kind.includes("authentication")) throw new Error(NO_KEY);
  if (error) throw new Error(error.message);
  if (!response.ok) throw new Error(`Linear answered ${response.status}`);
  return body.data;
}

// DOS-123, dos 123, dos123 -> "DOS-123"; anything else -> null.
function parseIdentifier(text) {
  const match = text.trim().match(/^([a-z][a-z0-9]*)[-\s]?(\d+)$/i);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : null;
}

// The identifier in a linear.app issue URL, or null.
function identifierFromUrl(url) {
  const match = url.match(/^https:\/\/linear\.app\/[^/]+\/issue\/([a-z][a-z0-9]*-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

// Linear redirects this to the issue whatever its title slug is.
function issueUrl(urlKey, identifier) {
  return `https://linear.app/${urlKey}/issue/${identifier}`;
}
