// Builds the "honest stats" card from the metadata of all commits, on all branches.
// Only aggregates end up in the SVG: no repo names, no commit messages, no code.
//
//   STATS_TOKEN=<token> node scripts/stats.mjs [outDir]          → <outDir>/stats.svg + stats-dark.svg
//   STATS_TOKEN=<token> node scripts/stats.mjs --json            → metrics as JSON on stdout
//
// STATS_TOKEN needs read access to the private repos: a classic PAT with the
// `repo` scope (fine-grained tokens are limited to a single org). Without it the
// script exits cleanly and the previous card stays online.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderCard } from './card.mjs';

const USER = process.env.STATS_USER ?? 'mollekopp';
const TOKEN = process.env.STATS_TOKEN;
const TZ = 'Europe/Berlin';
const JSON_ONLY = process.argv.includes('--json');
const OUT_DIR = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'dist';

if (!TOKEN) {
  console.log('::notice::STATS_TOKEN not set, keeping the previous stats card.');
  process.exit(0);
}

// ---------------------------------------------------------------- fetching

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function gh(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(path.startsWith('https://') ? path : `https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': `${USER}-profile-stats`,
      },
    });
    if (res.ok) return { body: await res.json(), next: /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] };
    if (res.status === 409) return { body: [] }; // empty repository
    const rateLimited = res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0';
    if (res.status >= 500 && attempt < 2) {
      await sleep(5000);
      continue;
    }
    if ((res.status === 403 || res.status === 429) && rateLimited && attempt < 2) {
      await sleep((Number(res.headers.get('retry-after')) || 30) * 1000);
      continue;
    }
    // Workflow logs of a public repo are public: no path, no repo names in here.
    throw Object.assign(new Error(`GitHub API responded ${res.status}`), { status: res.status });
  }
}

async function ghAll(path) {
  const items = [];
  for (let url = path; url; ) {
    const { body, next } = await gh(url);
    items.push(...body);
    url = next;
  }
  return items;
}

// Runs `task` for every item with a few requests in flight at once.
async function pool(items, size, task) {
  const results = [];
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

// Commit search hits GitHub's secondary rate limits fast and only sees default
// branches, so this walks every repo: all commits by USER on the default branch,
// then each other branch's commits by USER until a page brings nothing new (the
// list is newest first, a branch's own commits come before the shared history).
const ref = (name) => name.split('/').map(encodeURIComponent).join('/');

async function fetchRepo(repo, defaultBranch) {
  const items = await ghAll(`/repos/${repo}/commits?author=${USER}&per_page=100`);
  const known = new Set(items.map((item) => item.sha));
  for (const branch of await ghAll(`/repos/${repo}/branches?per_page=100`)) {
    if (branch.name === defaultBranch || known.has(branch.commit.sha)) continue;
    try {
      for (let url = `/repos/${repo}/commits?sha=${ref(branch.name)}&author=${USER}&per_page=100`; url; ) {
        const { body, next } = await gh(url);
        const fresh = body.filter((item) => !known.has(item.sha));
        fresh.forEach((item) => known.add(item.sha));
        items.push(...fresh);
        url = fresh.length ? next : null;
      }
    } catch (error) {
      if (error.status !== 404 && error.status !== 409 && error.status !== 422) throw error; // vanished branch
    }
  }
  return items
    .filter((item) => item.parents.length < 2)
    .map((item) => ({ sha: item.sha, repo, message: item.commit.message, date: new Date(item.commit.author.date) }));
}

async function fetchAll() {
  const repos = await ghAll('/user/repos?per_page=100&affiliation=owner,collaborator,organization_member');

  // A repo the token may not read (org token policy, SSO) is skipped, not fatal.
  let skipped = 0;
  const perRepo = await pool(repos, 6, async (repo) => {
    try {
      return await fetchRepo(repo.full_name, repo.default_branch);
    } catch (error) {
      if (error.status !== 403 && error.status !== 404) throw error;
      skipped++;
      return [];
    }
  });
  if (skipped) console.log(`::warning::${skipped} of ${repos.length} repos not readable with STATS_TOKEN, skipped.`);

  // The same commit can show up on several branches and in several repos (forks, mirrors).
  const bySha = new Map(perRepo.flat().map((commit) => [commit.sha, commit]));
  return [...bySha.values()]
    .map(({ repo, date, message }) => ({ repo, date, type: commitType(message) }))
    .filter((commit) => commit.type !== 'auto');
}

// ---------------------------------------------------------------- metrics

const TYPES = [
  { key: 'feat', label: 'feat' },
  { key: 'fix', label: 'fix' },
  { key: 'chore', label: 'chore, docs & tests' },
  { key: 'refactor', label: 'refactor & style' },
  { key: 'freestyle', label: 'freestyle (no prefix)' },
];

function commitType(message) {
  const type = /^(\w+)(\([^)]*\))?!?:/.exec(message)?.[1]?.toLowerCase();
  if (!type) return 'freestyle';
  if (type === 'auto') return 'auto'; // deploy tooling commits in my name, not my typing
  if (type === 'feat' || type === 'feature') return 'feat';
  if (type === 'fix' || type === 'hotfix' || type === 'bugfix') return 'fix';
  if (['refactor', 'style', 'perf'].includes(type)) return 'refactor';
  return 'chore';
}

const berlin = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  weekday: 'long',
});

function local(date) {
  const parts = Object.fromEntries(berlin.formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday };
}

function longestStreak(days) {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of sorted) {
    const current = new Date(`${day}T00:00:00Z`);
    run = previous && current - previous === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = current;
  }
  return best;
}

function metrics(commits) {
  const hours = Array(24).fill(0);
  const weekdays = {};
  const days = new Set();
  const types = Object.fromEntries(TYPES.map((t) => [t.key, 0]));

  for (const commit of commits) {
    const { day, hour, weekday } = local(commit.date);
    hours[hour]++;
    weekdays[weekday] = (weekdays[weekday] ?? 0) + 1;
    days.add(day);
    types[commit.type]++;
  }

  const nightOwl = hours.reduce((sum, n, h) => (h >= 22 || h < 6 ? sum + n : sum), 0);
  const weekend = (weekdays.Saturday ?? 0) + (weekdays.Sunday ?? 0);

  return {
    commits: commits.length,
    since: commits.length ? local(new Date(Math.min(...commits.map((c) => c.date)))).day.slice(0, 4) : '–',
    repos: new Set(commits.map((c) => c.repo)).size,
    activeDays: days.size,
    longestStreak: longestStreak(days),
    types: TYPES.map((t) => ({ ...t, count: types[t.key] })),
    hours,
    peakHour: hours.indexOf(Math.max(...hours)),
    nightOwl: commits.length ? nightOwl / commits.length : 0,
    weekend: commits.length ? weekend / commits.length : 0,
    busiestWeekday: Object.entries(weekdays).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '–',
    updated: new Date().toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------- run

const data = metrics(await fetchAll());

if (JSON_ONLY) {
  console.log(JSON.stringify(data, null, 2));
} else {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'stats.svg'), renderCard(data, 'light'));
  await writeFile(join(OUT_DIR, 'stats-dark.svg'), renderCard(data, 'dark'));
  console.log(`Stats card written: ${data.commits} commits, ${data.repos} repos.`);
}
