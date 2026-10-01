// Minimal GitHub REST client over fetch: works in Node 20+ and Cloudflare Workers.
// Used by BOTH backends so snapshots/history look identical whichever one runs.

const API = 'https://api.github.com';

const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

/**
 * @param {{token: string, repo: string, branch?: string, fetch?: typeof fetch}} opts  repo = "owner/name"
 */
export function github({ token, repo, branch = 'main', fetch: f = fetch }) {
  if (!token) throw new Error('GitHub token missing');
  const call = async (method, path, body) => {
    const res = await f(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'token2049-agenda-sync',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? {} : res.json();
  };

  return {
    /** @returns {Promise<string|null>} file text at branch head */
    async readFile(path) {
      const r = await call('GET', `/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`);
      if (!r) return null;
      if (r.content) return b64decode(r.content);
      // >1MB files come back without inline content
      const blob = await call('GET', `/repos/${repo}/git/blobs/${r.sha}`);
      return blob ? b64decode(blob.content) : null;
    },

    /** List a directory: [{name, path, type}] */
    async listDir(path) {
      const r = await call('GET', `/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`);
      return Array.isArray(r) ? r : [];
    },

    /** Commit many files in ONE commit (Git Data API). files: {path: text} */
    async commitFiles(files, message) {
      const ref = await call('GET', `/repos/${repo}/git/ref/heads/${branch}`);
      const headSha = ref.object.sha;
      const head = await call('GET', `/repos/${repo}/git/commits/${headSha}`);
      const tree = [];
      for (const [path, text] of Object.entries(files)) {
        const blob = await call('POST', `/repos/${repo}/git/blobs`, { content: b64encode(text), encoding: 'base64' });
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const newTree = await call('POST', `/repos/${repo}/git/trees`, { base_tree: head.tree.sha, tree });
      if (newTree.sha === head.tree.sha) return { sha: headSha, unchanged: true };
      const commit = await call('POST', `/repos/${repo}/git/commits`, { message, tree: newTree.sha, parents: [headSha] });
      await call('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha });
      return { sha: commit.sha };
    },

    /** Open (or comment on the existing) issue with this title. */
    async reportIssue(title, body, labels = ['sync-failure']) {
      const q = encodeURIComponent(`repo:${repo} is:issue is:open in:title "${title}"`);
      const found = await call('GET', `/search/issues?q=${q}`);
      const existing = found?.items?.find((i) => i.title === title);
      if (existing) return call('POST', `/repos/${repo}/issues/${existing.number}/comments`, { body });
      return call('POST', `/repos/${repo}/issues`, { title, body, labels });
    },

    /** Read an Actions repository variable (null if unset). */
    async getVariable(name) {
      const r = await call('GET', `/repos/${repo}/actions/variables/${name}`);
      return r ? r.value : null;
    },
  };
}
