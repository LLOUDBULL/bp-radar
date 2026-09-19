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
    avatar: "./assets/images/lisa.jpg"
  },
  "Jennie": {
    id: "1MMZWR-gsyHUEoOTHkbUAoQyOD7xA1qOSBarwOwphRjY",
    displayName: "Jennie",
    accent: "#EC4899",
    avatar: "./assets/images/jennie.jpg"
  },
  "Rose": {
    id: "1MtZ_LEXXpNSsKaPnow-RkJee8RWLd-V_vY0EZbMfM4U",
    displayName: "Rosé",
    accent: "#38BDF8",
    avatar: "./assets/images/rose.jpg"
  },
  "Jisoo": {
    id: "1d4r2ZSFAhL_s7Qqap93LeW97NKXcTxmWPQEA7YUWms8",
    displayName: "Jisoo",
    accent: "#A855F7",
    avatar: "./assets/images/jisoo.jpg"
  }
};

function getAvatarFallback(displayName, accent) {
  const initial = (displayName || "B").charAt(0);
  const color = encodeURIComponent(accent || "#EC4899");
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><rect width="60" height="60" fill="%231E293B"/><circle cx="30" cy="30" r="22" fill="${color}" opacity="0.25"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-family="system-ui,-apple-system,sans-serif" font-size="24" font-weight="700">${initial}</text></svg>`;
}

let currentEngine = "snapshot"; // "snapshot" or "live"
let snapshotData = null;
let currentDate = "";
let availableDates = [];

// Comparative Rankings Tab State
const rankActiveTabs = {
  "pure-solo": "total",
  "weekly": "total",
  "catalog": "total"
};

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
            <img src="${meta.avatar}" alt="${meta.displayName}" class="member-avatar" onerror="this.src=getAvatarFallback('${meta.displayName}', '${meta.accent}')">
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
            <img src="${meta.avatar}" alt="${meta.displayName}" class="table-avatar" style="border: 2px solid ${meta.accent};" onerror="this.src=getAvatarFallback('${meta.displayName}', '${meta.accent}')">
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

  // Save for ranking tab rerenders
  window._lastDayData = dayData;
  window._lastTotalStreamsSum = totalStreamsSum;
  window._lastDailyStreamsSum = dailyStreamsSum;

  // Render Comparative Rankings
  renderRankingSections(dayData, totalStreamsSum, dailyStreamsSum);

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
// Comparative Rankings Engine
// ----------------------------------------------------
function renderRankingSections(dayData, totalStreamsSum, dailyStreamsSum) {
  if (!dayData) return;
  const rankingDateTag = document.getElementById("ranking-date-tag");
  if (rankingDateTag) rankingDateTag.textContent = `Ranked Metrics for ${currentDate}`;

  // 1. Gather comprehensive metrics across all 4 members
  const memberList = Object.entries(MEMBERS).map(([key, meta]) => {
    const mData = dayData[key] || {};
    const streams = mData.streams || {};
    const daily = mData.daily || {};

    const catalogTotal = streams.total || 0;
    const catalogSolo = streams.solo || 0;
    const catalogLead = streams.lead || 0;
    const catalogFeature = streams.feature || 0;
    const dailyTotal = daily.total || 0;
    const dailySolo = daily.solo || 0;
    const dailyLead = daily.lead || 0;
    const dailyFeature = daily.feature || 0;

    const soloRatio = streams.solo_ratio ? streams.solo_ratio * 100 : (catalogTotal > 0 ? (catalogSolo / catalogTotal) * 100 : 0);
    const leadRatio = streams.lead_ratio ? streams.lead_ratio * 100 : (catalogTotal > 0 ? (catalogLead / catalogTotal) * 100 : 0);
    const catalogShare = (totalStreamsSum && totalStreamsSum > 0) ? (catalogTotal / totalStreamsSum) * 100 : 0;
    const dailyShare = (dailyStreamsSum && dailyStreamsSum > 0) ? (dailyTotal / dailyStreamsSum) * 100 : 0;

    // 7-day rolling window calculation
    let weeklyTotal = 0;
    let windowLen = 0;
    if (availableDates.length > 0) {
      const cIdx = availableDates.indexOf(currentDate);
      const startIdx = cIdx >= 0 ? cIdx : 0;
      const windowDates = availableDates.slice(startIdx, Math.min(startIdx + 7, availableDates.length));
      windowLen = windowDates.length;
      if (snapshotData && snapshotData.dates_data) {
        windowDates.forEach(dt => {
          const dRec = snapshotData.dates_data[dt]?.[key];
          if (dRec && dRec.daily && dRec.daily.total) {
            weeklyTotal += dRec.daily.total;
          }
        });
      }
    }
    if (weeklyTotal === 0 && dailyTotal > 0) {
      weeklyTotal = dailyTotal * (windowLen || 7);
    }
    const weeklyAvg = windowLen > 0 ? Math.round(weeklyTotal / windowLen) : dailyTotal;

    return {
      key,
      meta,
      displayName: meta.displayName,
      avatar: meta.avatar,
      accent: meta.accent,
      catalogTotal,
      catalogSolo,
      catalogLead,
      catalogFeature,
      dailyTotal,
      dailySolo,
      dailyLead,
      dailyFeature,
      soloRatio,
      leadRatio,
      catalogShare,
      dailyShare,
      weeklyTotal,
      weeklyAvg,
      windowLen
    };
  });

  // Calculate 4-member weekly combined
  const weeklyCombined = memberList.reduce((acc, m) => acc + m.weeklyTotal, 0);
  memberList.forEach(m => {
    m.weeklyShare = weeklyCombined > 0 ? (m.weeklyTotal / weeklyCombined) * 100 : 0;
  });

  const getRankPosClass = (rank) => {
    if (rank === 1) return "gold";
    if (rank === 2) return "silver";
    if (rank === 3) return "bronze";
    return "sub";
  };

  // ----------------------------------------------------
  // Card 1: Pure Solo Supremacy
  // ----------------------------------------------------
  const pureMetric = rankActiveTabs["pure-solo"] || "total";
  let sortedPure = [...memberList];
  if (pureMetric === "total") {
    sortedPure.sort((a, b) => b.catalogSolo - a.catalogSolo);
  } else if (pureMetric === "daily") {
    sortedPure.sort((a, b) => b.dailySolo - a.dailySolo);
  } else if (pureMetric === "ratio") {
    sortedPure.sort((a, b) => b.soloRatio - a.soloRatio);
  }

  const topPureVal = sortedPure[0] ? (
    pureMetric === "total" ? sortedPure[0].catalogSolo :
    pureMetric === "daily" ? sortedPure[0].dailySolo :
    100
  ) : 1;

  const pureSoloHtml = sortedPure.map((m, idx) => {
    const rank = idx + 1;
    let mainVal = "";
    let subVal = "";
    let barPct = 0;

    if (pureMetric === "total") {
      mainVal = fmtCompact(m.catalogSolo);
      subVal = `${fmt(m.catalogSolo)} total solo`;
      barPct = topPureVal > 0 ? (m.catalogSolo / topPureVal) * 100 : 0;
    } else if (pureMetric === "daily") {
      mainVal = `+${fmtCompact(m.dailySolo)}`;
      subVal = `+${fmt(m.dailySolo)}/d solo streams`;
      barPct = topPureVal > 0 ? (m.dailySolo / topPureVal) * 100 : 0;
    } else if (pureMetric === "ratio") {
      mainVal = `${m.soloRatio.toFixed(1)}%`;
      subVal = `${fmtCompact(m.catalogSolo)} solo (${m.soloRatio.toFixed(1)}% of total)`;
      barPct = Math.min(m.soloRatio, 100);
    }

    return `
      <div class="rank-item">
        <div class="rank-item-main">
          <div class="rank-item-left">
            <span class="rank-pos ${getRankPosClass(rank)}">${rank}</span>
            <img src="${m.avatar}" alt="${m.displayName}" class="rank-avatar" style="border: 2px solid ${m.accent};" onerror="this.src=getAvatarFallback('${m.displayName}', '${m.accent}')">
            <div class="rank-details">
              <span class="rank-name">${m.displayName}</span>
              <span class="rank-meta">${pureMetric === 'ratio' ? 'Pure Solo Share' : 'Solo Discography'}</span>
            </div>
          </div>
          <div class="rank-item-right">
            <span class="rank-val">${mainVal}</span>
            <span class="rank-subval">${subVal}</span>
          </div>
        </div>
        <div class="rank-bar-bg">
          <div class="rank-bar-fill" style="width: ${Math.min(Math.max(barPct, 2), 100)}%; background: ${m.accent};"></div>
        </div>
      </div>
    `;
  }).join("");
  const pureListEl = document.getElementById("rank-list-pure-solo");
  if (pureListEl) pureListEl.innerHTML = pureSoloHtml;

  // ----------------------------------------------------
  // Card 2: Weekly Momentum (7-Day Rolling)
  // ----------------------------------------------------
  const weeklyMetric = rankActiveTabs["weekly"] || "total";
  let sortedWeekly = [...memberList];
  if (weeklyMetric === "total") {
    sortedWeekly.sort((a, b) => b.weeklyTotal - a.weeklyTotal);
  } else if (weeklyMetric === "avg") {
    sortedWeekly.sort((a, b) => b.weeklyAvg - a.weeklyAvg);
  } else if (weeklyMetric === "share") {
    sortedWeekly.sort((a, b) => b.weeklyShare - a.weeklyShare);
  }

  const topWeeklyVal = sortedWeekly[0] ? (
    weeklyMetric === "total" ? sortedWeekly[0].weeklyTotal :
    weeklyMetric === "avg" ? sortedWeekly[0].weeklyAvg :
    100
  ) : 1;

  const weeklyHtml = sortedWeekly.map((m, idx) => {
    const rank = idx + 1;
    let mainVal = "";
    let subVal = "";
    let barPct = 0;

    if (weeklyMetric === "total") {
      mainVal = `+${fmtCompact(m.weeklyTotal)}`;
      subVal = `+${fmt(m.weeklyTotal)} in past 7d`;
      barPct = topWeeklyVal > 0 ? (m.weeklyTotal / topWeeklyVal) * 100 : 0;
    } else if (weeklyMetric === "avg") {
      mainVal = `+${fmtCompact(m.weeklyAvg)}/d`;
      subVal = `7-day avg daily rate`;
      barPct = topWeeklyVal > 0 ? (m.weeklyAvg / topWeeklyVal) * 100 : 0;
    } else if (weeklyMetric === "share") {
      mainVal = `${m.weeklyShare.toFixed(1)}%`;
      subVal = `${fmtCompact(m.weeklyTotal)} of 4-member week`;
      barPct = Math.min(m.weeklyShare, 100);
    }

    return `
      <div class="rank-item">
        <div class="rank-item-main">
          <div class="rank-item-left">
            <span class="rank-pos ${getRankPosClass(rank)}">${rank}</span>
            <img src="${m.avatar}" alt="${m.displayName}" class="rank-avatar" style="border: 2px solid ${m.accent};" onerror="this.src=getAvatarFallback('${m.displayName}', '${m.accent}')">
            <div class="rank-details">
              <span class="rank-name">${m.displayName}</span>
              <span class="rank-meta">7-Day Trajectory</span>
            </div>
          </div>
          <div class="rank-item-right">
            <span class="rank-val">${mainVal}</span>
            <span class="rank-subval">${subVal}</span>
          </div>
        </div>
        <div class="rank-bar-bg">
          <div class="rank-bar-fill" style="width: ${Math.min(Math.max(barPct, 2), 100)}%; background: ${m.accent};"></div>
        </div>
      </div>
    `;
  }).join("");
  const weeklyListEl = document.getElementById("rank-list-weekly");
  if (weeklyListEl) weeklyListEl.innerHTML = weeklyHtml;

  // ----------------------------------------------------
  // Card 3: Catalog Dominance & Lead Breakdown
  // ----------------------------------------------------
  const catMetric = rankActiveTabs["catalog"] || "total";
  let sortedCat = [...memberList];
  if (catMetric === "total") {
    sortedCat.sort((a, b) => b.catalogTotal - a.catalogTotal);
  } else if (catMetric === "daily") {
    sortedCat.sort((a, b) => b.dailyTotal - a.dailyTotal);
  } else if (catMetric === "lead") {
    sortedCat.sort((a, b) => b.catalogLead - a.catalogLead);
  }

  const topCatVal = sortedCat[0] ? (
    catMetric === "total" ? sortedCat[0].catalogTotal :
    catMetric === "daily" ? sortedCat[0].dailyTotal :
    sortedCat[0].catalogLead
  ) : 1;

  const catHtml = sortedCat.map((m, idx) => {
    const rank = idx + 1;
    let mainVal = "";
    let subVal = "";
    let barPct = 0;

    if (catMetric === "total") {
      mainVal = fmtCompact(m.catalogTotal);
      subVal = `${m.catalogShare.toFixed(1)}% share of BP solo pie`;
      barPct = topCatVal > 0 ? (m.catalogTotal / topCatVal) * 100 : 0;
    } else if (catMetric === "daily") {
      mainVal = `+${fmtCompact(m.dailyTotal)}/d`;
      subVal = `${m.dailyShare.toFixed(1)}% of 4-member daily volume`;
      barPct = topCatVal > 0 ? (m.dailyTotal / topCatVal) * 100 : 0;
    } else if (catMetric === "lead") {
      mainVal = `${fmtCompact(m.catalogLead)} Lead`;
      subVal = `${m.leadRatio.toFixed(1)}% Lead • ${m.catalogFeature > 0 ? fmtCompact(m.catalogFeature) + ' Collab' : '0 Collab'}`;
      barPct = topCatVal > 0 ? (m.catalogLead / topCatVal) * 100 : 0;
    }

    return `
      <div class="rank-item">
        <div class="rank-item-main">
          <div class="rank-item-left">
            <span class="rank-pos ${getRankPosClass(rank)}">${rank}</span>
            <img src="${m.avatar}" alt="${m.displayName}" class="rank-avatar" style="border: 2px solid ${m.accent};" onerror="this.src=getAvatarFallback('${m.displayName}', '${m.accent}')">
            <div class="rank-details">
              <span class="rank-name">${m.displayName}</span>
              <span class="rank-meta">${catMetric === 'lead' ? 'Lead vs Collaboration' : 'Solo Discography'}</span>
            </div>
          </div>
          <div class="rank-item-right">
            <span class="rank-val">${mainVal}</span>
            <span class="rank-subval">${subVal}</span>
          </div>
        </div>
        <div class="rank-bar-bg">
          <div class="rank-bar-fill" style="width: ${Math.min(Math.max(barPct, 2), 100)}%; background: ${m.accent};"></div>
        </div>
      </div>
    `;
  }).join("");
  const catListEl = document.getElementById("rank-list-catalog");
  if (catListEl) catListEl.innerHTML = catHtml;
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

// Tab switching for comparative ranking cards
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".rank-tab-btn");
  if (!btn) return;
  const target = btn.dataset.target;
  const metric = btn.dataset.metric;
  if (!target || !metric) return;

  const parent = btn.parentElement;
  parent.querySelectorAll(".rank-tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  rankActiveTabs[target] = metric;

  if (window._lastDayData) {
    renderRankingSections(window._lastDayData, window._lastTotalStreamsSum, window._lastDailyStreamsSum);
  }
});

// Initialize on Load
document.addEventListener("DOMContentLoaded", () => {
  loadSnapshot();
});

