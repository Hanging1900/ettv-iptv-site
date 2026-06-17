const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const outputJsonPath = path.join(dataDir, "ettv-variety.json");
const outputM3uPath = path.join(dataDir, "ettv-variety.m3u");

const KEYWORDS = ["東森綜合", "东森综合", "EBC Variety", "ETTV Variety", "ETTV 综合", "ETTV 綜合"];

function norm(v) {
  return String(v || "").toLowerCase().replace(/\s+/g, "").replace(/[|｜_\-]/g, "");
}

function attrs(line) {
  const out = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(line))) out[m[1]] = m[2];
  return out;
}

function parseM3u(text, sourceName, sourceUrl) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let pending = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      pending = {
        title: comma >= 0 ? line.slice(comma + 1).trim() : "",
        attrs: attrs(line)
      };
      continue;
    }

    if (line.startsWith("#")) continue;

    if (pending) {
      channels.push({
        sourceName,
        sourceUrl,
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
  const response = await fetch(url, {
    headers: { "user-agent": "ettv-authorized-playlist-updater/1.0" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function isMatch(ch) {
  const text = norm([ch.name, ch.title, ch.group].join(" "));
  return KEYWORDS.some((k) => text.includes(norm(k)));
}

function buildM3u(matches) {
  const lines = ["#EXTM3U"];
  for (const m of matches) {
    const logo = m.logo ? ` tvg-logo="${m.logo.replace(/"/g, "%22")}"` : "";
    const group = m.group ? ` group-title="${m.group.replace(/"/g, "%22")}"` : "";
    const name = (m.name || "ETTV Variety").replace(/"/g, "%22");
    lines.push(`#EXTINF:-1 tvg-name="${name}"${logo}${group},${m.title || name}`);
    lines.push(m.url);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });

  const raw = process.env.IPTV_SOURCE_URLS || "";
  const sourceUrls = raw.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  const matches = [];
  const errors = [];

  for (let i = 0; i < sourceUrls.length; i++) {
    try {
      const text = await fetchText(sourceUrls[i]);
      matches.push(...parseM3u(text, `source-${i + 1}`, sourceUrls[i]).filter(isMatch));
    } catch (e) {
      errors.push({ source: `source-${i + 1}`, error: e.message });
    }
  }

  const payload = {
    channelName: "ETTV Variety",
    updatedAt: new Date().toISOString(),
    status: matches.length ? "ok" : sourceUrls.length ? "not_found" : "setup_required",
    message: matches.length ? `Found ${matches.length} matching stream(s).` : "No matching authorized stream found.",
    sourceCount: sourceUrls.length,
    errors,
    matches
  };

  fs.writeFileSync(outputJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(outputM3uPath, matches.length ? buildM3u(matches) : "#EXTM3U\n# No matching authorized stream found.\n");

  console.log(payload.message);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
