const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const configPath = path.join(rootDir, "config.json");
const exampleConfigPath = path.join(rootDir, "config.example.json");
const outputJsonPath = path.join(dataDir, "ettv-variety.json");
const outputM3uPath = path.join(dataDir, "ettv-variety.m3u");

const DEFAULT_KEYWORDS = [
  "東森綜合",
  "东森综合",
  "EBC Variety",
  "ETTV Variety",
  "ETTV 综合",
  "ETTV 綜合"
];

function readConfig() {
  const base = fs.existsSync(exampleConfigPath)
    ? JSON.parse(fs.readFileSync(exampleConfigPath, "utf8"))
    : {};

  const local = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : {};

  const rawEnvSources = process.env.IPTV_SOURCE_URLS || "";
  const envSeparator = /\r?\n/.test(rawEnvSources) ? /\r?\n/ : ",";
  const envSources = rawEnvSources
    .split(envSeparator)
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url, index) => ({ name: `env-source-${index + 1}`, url }));

  return {
    channelName: local.channelName || base.channelName || "ETTV Variety",
    channelKeywords: local.channelKeywords || base.channelKeywords || DEFAULT_KEYWORDS,
    sources: envSources.length ? envSources : local.sources || []
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[|｜_\-]/g, "");
}

function parseAttributes(text) {
  const attrs = {};
  const pattern = /([\w-]+)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(text))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseM3u(content, source) {
  const lines = content.split(/\r?\n/);
  const channels = [];
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const commaIndex = line.lastIndexOf(",");
      const title = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";
      pending = {
        sourceName: source.name,
        sourceUrl: source.url,
        title,
        attrs: parseAttributes(line)
      };
      continue;
    }

    if (line.startsWith("#")) continue;

    if (pending) {
      channels.push({
        sourceName: pending.sourceName,
        sourceUrl: pending.sourceUrl,
        name: pending.attrs["tvg-name"] || pending.title,
        title: pending.title,
        group: pending.attrs["group-title"] || "",
        logo: pending.attrs["tvg-logo"] || "",
        url: line
      });
      pending = null;
    }
  }

  return channels;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "ettv-authorized-playlist-updater/1.0"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function isMatch(channel, keywords) {
  const haystack = normalizeText([
    channel.name,
    channel.title,
    channel.group
  ].join(" "));
  return keywords.some((keyword) => haystack.includes(normalizeText(keyword)));
}

function uniqueMatches(matches) {
  const seen = new Set();
  return matches.filter((match) => {
    const key = normalizeText(`${match.name}|${match.url}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildM3u(channelName, matches) {
  const lines = ["#EXTM3U"];
  for (const match of matches) {
    const logo = match.logo ? ` tvg-logo="${match.logo.replace(/"/g, "%22")}"` : "";
    const group = match.group ? ` group-title="${match.group.replace(/"/g, "%22")}"` : "";
    const name = (match.name || channelName).replace(/"/g, "%22");
    lines.push(`#EXTINF:-1 tvg-name="${name}"${logo}${group},${match.title || match.name || channelName}`);
    lines.push(match.url);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });

  const config = readConfig();
  const startedAt = new Date().toISOString();
  const results = [];
  const errors = [];

  for (const source of config.sources) {
    if (!source.url || /example\.com/.test(source.url)) continue;
    try {
      const text = await fetchText(source.url);
      const channels = parseM3u(text, source);
      results.push(...channels.filter((channel) => isMatch(channel, config.channelKeywords)));
    } catch (error) {
      errors.push({
        sourceName: source.name || source.url,
        error: error.message
      });
    }
  }

  const matches = uniqueMatches(results);
  const payload = {
    channelName: config.channelName,
    updatedAt: startedAt,
    status: matches.length ? "ok" : config.sources.length ? "not_found" : "setup_required",
    message: matches.length
      ? `Found ${matches.length} matching stream(s).`
      : config.sources.length
        ? "No matching channel was found in the configured authorized sources."
        : "Add authorized IPTV playlist URLs in config.json or the IPTV_SOURCE_URLS secret.",
    keywords: config.channelKeywords,
    sourceCount: config.sources.filter((source) => source.url && !/example\.com/.test(source.url)).length,
    errors,
    matches
  };

  fs.writeFileSync(outputJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(outputM3uPath, matches.length
    ? buildM3u(config.channelName, matches)
    : "#EXTM3U\n# No matching authorized stream found.\n", "utf8");

  console.log(`${payload.status}: ${payload.message}`);
  if (errors.length) {
    console.log(`Source errors: ${errors.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
