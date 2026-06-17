const statusLabel = {
  ok: "可用",
  not_found: "未匹配",
  setup_required: "待配置"
};

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function loadStatus() {
  let data;
  try {
    const response = await fetch(`./data/ettv-variety.json?t=${Date.now()}`);
    data = await response.json();
  } catch {
    data = {
      channelName: "ETTV Variety",
      updatedAt: null,
      status: "setup_required",
      message: "本地文件模式已打开。部署到 GitHub Pages 后会自动读取每日更新数据。",
      matches: []
    };
  }

  document.getElementById("summary").textContent = data.message || "";
  document.getElementById("status").textContent = statusLabel[data.status] || data.status || "-";
  document.getElementById("matchCount").textContent = String((data.matches || []).length);
  document.getElementById("updatedAt").textContent = formatDate(data.updatedAt);

  const rows = (data.matches || []).map((match) => `
    <tr>
      <td>${match.name || match.title || data.channelName}</td>
      <td>${match.group || "-"}</td>
      <td>${match.sourceName || "-"}</td>
      <td><a href="${match.url}" rel="noreferrer">${maskUrl(match.url)}</a></td>
    </tr>
  `);

  document.getElementById("matches").innerHTML = rows.length
    ? rows.join("")
    : '<tr><td colspan="4">还没有匹配到授权直播源</td></tr>';
}

loadStatus().catch((error) => {
  document.getElementById("summary").textContent = `读取失败：${error.message}`;
});
