/**
 * app.js — BLACKPINK Solo Intelligence Consolidated Dashboard
 * Supports Dual Engine Architecture:
 * - Option A: Live Google Sheets SQL query via gviz/tq API
 * - Option B: Pre-compiled Edge JSON Snapshot (bp_daily_snapshot.json)
 */

const MEMBERS = {
  "Lisa": {
    id: "1I81HxbHsWNrMCE4WMeYJJUN9Uc4zPHsLJ_5D_04wE2k",
    displayName: "Lisa",
    accent: "#F59E0B",
    avatar: "https://i.scdn.co/image/ab6761610000e5ebc58f0efd9a4fbe29f3c7e096"
  },
  "Jennie": {
    id: "1MMZWR-gsyHUEoOTHkbUAoQyOD7xA1qOSBarwOwphRjY",
    displayName: "Jennie",
    accent: "#EC4899",
    avatar: "https://i.scdn.co/image/ab6761610000e5ebba9a98ef1f7051df4b8826c7"
  },
  "Rose": {
    id: "1MtZ_LEXXpNSsKaPnow-RkJee8RWLd-V_vY0EZbMfM4U",
    displayName: "Rosé",
    accent: "#38BDF8",
    avatar: "https://i.scdn.co/image/ab6761610000e5ebfc3e0ee0c463a89307775199"
  },
  "Jisoo": {
    id: "1d4r2ZSFAhL_s7Qqap93LeW97NKXcTxmWPQEA7YUWms8",
    displayName: "Jisoo",
    accent: "#A855F7",
    avatar: "https://i.scdn.co/image/ab6761610000e5eb5a1ef4c2975949d8858a8a49"
  }
};

let currentEngine = "snapshot"; // "snapshot" or "live"
let snapshotData = null;
let currentDate = "";
let availableDates = [];

// DOM Elements
const dateSelect = document.getElementById("date-select");
const prevDateBtn = document.getElementById("prev-date-btn");
const nextDateBtn = document.getElementById("next-date-btn");
const latestDateBtn = document.getElementById("latest-date-btn");
const engineSnapshotBtn = document.getElementById("engine-snapshot-btn");
const engineLiveBtn = document.getElementById("engine-live-btn");
const statusText = document.getElementById("status-text");
const queryMeta = document.getElementById("query-meta");
const statusPulse = document.getElementById("status-pulse");

const aggTotalStreams = document.getElementById("agg-total-streams");
const aggTotalChange = document.getElementById("agg-total-change");
const aggDailyStreams = document.getElementById("agg-daily-streams");
const aggDailyChange = document.getElementById("agg-daily-change");
const aggTracks = document.getElementById("agg-tracks");
const aggTopVelocity = document.getElementById("agg-top-velocity");
const aggTopPerformer = document.getElementById("agg-top-performer");

const membersGrid = document.getElementById("members-grid");
const consolidatedTbody = document.getElementById("consolidated-tbody");
const songsTbody = document.getElementById("songs-tbody");
const selectedDateBadge = document.getElementById("selected-date-badge");
const radarDateLabel = document.getElementById("radar-date-label");

// Number Formatting Helpers
function fmt(num) {
  if (num === null || num === undefined || isNaN(num)) return "0";
  return new Intl.NumberFormat("en-US").format(num);
}

function fmtCompact(num) {
  if (num === null || num === undefined || isNaN(num)) return "0";
  if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return fmt(num);
}

function fmtChange(num) {
  if (num === null || num === undefined || isNaN(num) || num === 0) {
    return `<span class="pill-badge neutral">0</span>`;
  }
  const isPos = num > 0;
  const sign = isPos ? "+" : "";
  const cls = isPos ? "pos" : "neg";
  return `<span class="pill-badge ${cls}">${sign}${fmt(num)}</span>`;
}

// ----------------------------------------------------
// Engine 1: Snapshot (Option B) Loader
// ----------------------------------------------------
async function loadSnapshot() {
  const t0 = performance.now();
  statusText.textContent = "Loading Edge JSON Snapshot...";
  statusPulse.style.background = "#38BDF8";

  try {
    const res = await fetch("./data/bp_daily_snapshot.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snapshotData = await res.json();

    availableDates = snapshotData.available_dates || [];
    currentDate = snapshotData.latest_date || (availableDates.length > 0 ? availableDates[0] : "");

    populateDateDropdown();
    renderCurrentView();

    const t1 = performance.now();
    const elapsed = Math.round(t1 - t0);
    queryMeta.textContent = `Latency: ${elapsed} ms • Snapshot (Option B)`;
    statusText.textContent = `Ready • Snapshot mode (${fmt(availableDates.length)} dates cached)`;
    statusPulse.style.background = "#10B981";
  } catch (err) {
    console.error("Snapshot error:", err);
    statusText.textContent = `Snapshot failed: ${err.message}. Falling back to Live Sheets...`;
    switchEngine("live");
  }
}

// ----------------------------------------------------
// Engine 2: Live Google Sheets (Option A) Query
// ----------------------------------------------------
async function queryGviz(spreadsheetId, sheetName, query) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&tq=${encodeURIComponent(query)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on sheet ${sheetName}`);
  const text = await resp.text();
  
  // Extract JSON from gviz response: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}") + 1;
  const jsonStr = text.substring(jsonStart, jsonEnd);
  return JSON.parse(jsonStr);
}

async function fetchLiveData(targetDate) {
  const t0 = performance.now();
  statusText.textContent = `Querying 4 Google Sheets live for ${targetDate}...`;
  statusPulse.style.background = "#F59E0B";

  const memberPromises = Object.entries(MEMBERS).map(async ([key, meta]) => {
    try {
      // 1. Fetch Summary rows for date
      const sumQuery = `SELECT * WHERE A = '${targetDate}'`;
      const sumData = await queryGviz(meta.id, "Summary", sumQuery);

      const rows = sumData.table.rows || [];
      const parsed = { streams: {}, daily: {}, tracks: {}, top_songs: [] };

      rows.forEach(r => {
        const c = r.c;
        if (!c || c.length < 3) return;
        const metric = c[1]?.v?.toString()?.toLowerCase() || "";
        const rowObj = {
          total: c[2]?.v || 0,
          lead: c[3]?.v || 0,
          solo: c[4]?.v || 0,
          feature: c[5]?.v || 0,
          lead_ratio: c[6]?.v || 0,
          solo_ratio: c[7]?.v || 0,
          total_change: c[10]?.v || 0,
          lead_change: c[11]?.v || 0,
          solo_change: c[12]?.v || 0,
        };

        if (metric === "streams") parsed.streams = rowObj;
        else if (metric === "daily") parsed.daily = rowObj;
        else if (metric === "tracks") parsed.tracks = rowObj;
      });

      // 2. Fetch Top 5 Songs for date
      try {
        const songsQuery = `SELECT B, C, D, E, F WHERE A = '${targetDate}' ORDER BY D DESC LIMIT 5`;
        const songsData = await queryGviz(meta.id, "Songs", songsQuery);
        const sRows = songsData.table.rows || [];
        parsed.top_songs = sRows.map(sr => ({
          name: sr.c[0]?.v || "Unknown",
          total_streams: sr.c[1]?.v || 0,
          daily_streams: sr.c[2]?.v || 0,
          total_change: sr.c[3]?.v || 0,
          daily_change: sr.c[4]?.v || 0
        }));
      } catch (e) {
        console.warn(`Could not query Songs for ${key}:`, e);
      }

      return [key, parsed];
    } catch (err) {
      console.error(`Error querying ${key}:`, err);
      return [key, null];
    }
  });

  const results = await Promise.all(memberPromises);
  const liveDayData = Object.fromEntries(results);

  const t1 = performance.now();
  const elapsed = Math.round(t1 - t0);
  queryMeta.textContent = `Latency: ${elapsed} ms • Live Sheets (Option A)`;
  statusText.textContent = `Ready • Live Sheets query complete for ${targetDate}`;
  statusPulse.style.background = "#10B981";

  return liveDayData;
}

// ----------------------------------------------------
// Renderers
// ----------------------------------------------------
function populateDateDropdown() {
  dateSelect.innerHTML = "";
  availableDates.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    if (d === currentDate) opt.selected = true;
    dateSelect.appendChild(opt);
  });
}

async function renderCurrentView() {
  selectedDateBadge.textContent = currentDate;
  radarDateLabel.textContent = currentDate;

  let dayData = null;

  if (currentEngine === "snapshot" && snapshotData && snapshotData.dates_data) {
    dayData = snapshotData.dates_data[currentDate] || {};
  } else if (currentEngine === "live") {
    dayData = await fetchLiveData(currentDate);
  }

  if (!dayData) {
    membersGrid.innerHTML = `<div class="loading-placeholder">No data available for ${currentDate}</div>`;
    return;
  }

  // Calculate Macro Aggregates
  let totalStreamsSum = 0;
  let totalChangeSum = 0;
  let dailyStreamsSum = 0;
  let dailyChangeSum = 0;
  let tracksSum = 0;
  let topVelocityVal = -1;
  let topVelocityArtist = "--";

  const memberCardsHtml = [];
  const tableRows = [];
  const combinedTopSongs = [];

  Object.entries(MEMBERS).forEach(([key, meta]) => {
    const mData = dayData[key] || {};
    const streams = mData.streams || {};
    const daily = mData.daily || {};
    const tracks = mData.tracks || {};
    const topSongs = mData.top_songs || [];

    const tot = streams.total || 0;
    const totChg = streams.total_change || 0;
    const dly = daily.total || 0;
    const dlyChg = daily.total_change || 0;
    const trk = tracks.total || 0;
    const solo = streams.solo || 0;
    const soloRatio = streams.solo_ratio ? (streams.solo_ratio * 100).toFixed(1) : (tot > 0 ? ((solo / tot) * 100).toFixed(1) : "0.0");

    totalStreamsSum += tot;
    totalChangeSum += totChg;
    dailyStreamsSum += dly;
    dailyChangeSum += dlyChg;
    tracksSum += trk;

    if (dly > topVelocityVal) {
      topVelocityVal = dly;
      topVelocityArtist = meta.displayName;
    }

    const topSong = topSongs.length > 0 ? topSongs[0] : { name: "No Track", daily_streams: 0 };

    // Push songs to combined radar
    topSongs.forEach(s => {
      combinedTopSongs.push({
        ...s,
        artist: meta.displayName,
        accent: meta.accent
      });
    });

    // 1. Build Bento Card
    memberCardsHtml.push(`
      <div class="member-card" style="--accent-color: ${meta.accent};">
        <div class="member-card-header">
          <div class="avatar-wrapper">
            <img src="${meta.avatar}" alt="${meta.displayName}" class="member-avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'50\\' height=\\'50\\'><rect fill=\\'%231E293B\\' width=\\'50\\' height=\\'50\\'/></svg>'">
          </div>
          <div class="member-name-group">
            <span class="member-name">${meta.displayName}</span>
            <span class="member-subtitle">${fmt(trk)} Solo Tracks Catalog</span>
          </div>
        </div>

        <div class="member-metrics-grid">
          <div class="metric-item">
            <span class="metric-label">TOTAL STREAMS</span>
            <span class="metric-val">${fmtCompact(tot)}</span>
            ${fmtChange(totChg)}
          </div>
          <div class="metric-item">
            <span class="metric-label">DAILY STREAMS</span>
            <span class="metric-val">${fmtCompact(dly)}</span>
            ${fmtChange(dlyChg)}
          </div>
        </div>

        <div class="progress-group">
          <div class="progress-header">
            <span class="text-dim">Pure Solo Share</span>
            <span class="font-mono">${soloRatio}% (${fmtCompact(solo)})</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${Math.min(Math.max(parseFloat(soloRatio), 0), 100)}%;"></div>
          </div>
        </div>

        <div class="member-top-song">
          <span class="top-song-title" title="${topSong.name}">⭐ ${topSong.name}</span>
          <span class="top-song-streams">+${fmt(topSong.daily_streams)}/d</span>
        </div>
      </div>
    `);

    // 2. Build Table Row
    tableRows.push(`
      <tr>
        <td>
          <div class="table-member-cell">
            <img src="${meta.avatar}" alt="${meta.displayName}" class="table-avatar" style="border: 2px solid ${meta.accent};">
            <span>${meta.displayName}</span>
          </div>
        </td>
        <td class="num-col"><strong>${fmt(tot)}</strong></td>
        <td class="num-col">${fmtChange(totChg)}</td>
        <td class="num-col"><strong>${fmt(dly)}</strong></td>
        <td class="num-col">${fmtChange(dlyChg)}</td>
        <td class="num-col">${fmt(solo)}</td>
        <td class="num-col">${soloRatio}%</td>
        <td class="num-col">${trk}</td>
        <td>
          <a href="https://docs.google.com/spreadsheets/d/${meta.id}" target="_blank" rel="noopener" class="sheet-link-btn">
            Open Sheet ↗
          </a>
        </td>
      </tr>
    `);
  });

  // Render Highlights
  aggTotalStreams.textContent = fmtCompact(totalStreamsSum);
  aggTotalChange.innerHTML = `24h Net: ${fmtChange(totalChangeSum)}`;
  aggDailyStreams.textContent = fmt(dailyStreamsSum);
  aggDailyChange.innerHTML = `Daily Delta: ${fmtChange(dailyChangeSum)}`;
  aggTracks.textContent = tracksSum;
  aggTopVelocity.textContent = fmt(topVelocityVal);
  aggTopPerformer.textContent = `${topVelocityArtist} (#1 Velocity)`;

  // Render Grid and Table
  membersGrid.innerHTML = memberCardsHtml.join("");
  consolidatedTbody.innerHTML = tableRows.join("");

  // Render Top Songs Radar (sorted by daily streams descending)
  combinedTopSongs.sort((a, b) => b.daily_streams - a.daily_streams);
  const songRows = combinedTopSongs.slice(0, 10).map((s, idx) => `
    <tr>
      <td class="font-mono">#${idx + 1}</td>
      <td><strong>${s.name}</strong></td>
      <td><span style="color: ${s.accent}; font-weight: 700;">${s.artist}</span></td>
      <td class="num-col"><strong>+${fmt(s.daily_streams)}</strong></td>
      <td class="num-col">${fmtChange(s.daily_change)}</td>
      <td class="num-col">${fmt(s.total_streams)}</td>
      <td class="num-col">${fmtChange(s.total_change)}</td>
    </tr>
  `);
  songsTbody.innerHTML = songRows.length > 0 ? songRows.join("") : `<tr><td colspan="7" class="loading-cell">No song data for this date</td></tr>`;
}

// ----------------------------------------------------
// Event Listeners & Navigation
// ----------------------------------------------------
function switchEngine(mode) {
  if (mode === currentEngine) return;
  currentEngine = mode;

  if (mode === "snapshot") {
    engineSnapshotBtn.classList.add("active");
    engineLiveBtn.classList.remove("active");
    if (!snapshotData) {
      loadSnapshot();
    } else {
      renderCurrentView();
      statusText.textContent = "Switched to Snapshot Engine (Option B)";
      queryMeta.textContent = "Cache: Instant Local/Edge";
    }
  } else {
    engineLiveBtn.classList.add("active");
    engineSnapshotBtn.classList.remove("active");
    renderCurrentView();
  }
}

engineSnapshotBtn.addEventListener("click", () => switchEngine("snapshot"));
engineLiveBtn.addEventListener("click", () => switchEngine("live"));

dateSelect.addEventListener("change", (e) => {
  currentDate = e.target.value;
  renderCurrentView();
});

prevDateBtn.addEventListener("click", () => {
  const idx = availableDates.indexOf(currentDate);
  if (idx < availableDates.length - 1) {
    currentDate = availableDates[idx + 1];
    dateSelect.value = currentDate;
    renderCurrentView();
  }
});

nextDateBtn.addEventListener("click", () => {
  const idx = availableDates.indexOf(currentDate);
  if (idx > 0) {
    currentDate = availableDates[idx - 1];
    dateSelect.value = currentDate;
    renderCurrentView();
  }
});

latestDateBtn.addEventListener("click", () => {
  if (availableDates.length > 0) {
    currentDate = availableDates[0];
    dateSelect.value = currentDate;
    renderCurrentView();
  }
});

// Initialize on Load
document.addEventListener("DOMContentLoaded", () => {
  loadSnapshot();
});
