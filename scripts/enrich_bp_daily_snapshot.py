#!/usr/bin/env python3
"""
enrich_bp_daily_snapshot.py
----------------------------
Enriches data/bp_daily_snapshot.json with granular playlist positions,
total playlist reach, and editorial activities from playlist_positions.db.

Run this after consolidate_bp_daily.py to produce the complete
Consolidated Streaming & Playlist Snapshot.
"""

import os, sys, json, sqlite3, unicodedata, re, shutil
from pathlib import Path

SNAPSHOT_PATH = Path("/Users/bibbler/Gemini_Workspace/music_intel/dashboards/bp_consolidated/data/bp_daily_snapshot.json")
DB_PATH = Path("/Users/bibbler/Gemini_Workspace/songstats_intelligence/data/playlist_positions.db")

def normalize_name(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = re.sub(r"[^\w\s]", "", s).lower()
    return re.sub(r"\s+", " ", s).strip()

def matches_song(song_name: str, db_track: str) -> bool:
    n1 = normalize_name(song_name)
    n2 = normalize_name(db_track)
    if not n1 or not n2:
        return False
    return n1 in n2 or n2 in n1

def main():
    if not SNAPSHOT_PATH.exists():
        print(f"❌ Snapshot not found: {SNAPSHOT_PATH}")
        sys.exit(1)
    if not DB_PATH.exists():
        print(f"❌ Database not found: {DB_PATH}")
        sys.exit(1)

    print(f"📂 Loading snapshot from {SNAPSHOT_PATH}...")
    with open(SNAPSHOT_PATH, "r", encoding="utf-8") as f:
        snapshot = json.load(f)

    print(f"🔌 Connecting to SQLite database at {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)

    # 1. Pre-fetch all daily pivoted positions
    positions_rows = conn.execute("""
        SELECT date, artist, track, songstats_track_id,
               tth_pos, top50_global_pos, kpop_on_pos,
               playlist_count, playlist_reach, spotify_streams
        FROM v_daily_pivoted_positions
    """).fetchall()

    # Index by date -> list of records
    daily_positions = {}
    for r in positions_rows:
        date, artist, track, sid, tth, g50, kpop, pl_cnt, reach, strms = r
        daily_positions.setdefault(date, []).append({
            "artist": artist,
            "track": track,
            "songstats_track_id": sid,
            "tth_pos": tth,
            "top50_global_pos": g50,
            "kpop_on_pos": kpop,
            "playlist_count": pl_cnt,
            "playlist_reach": reach,
            "spotify_streams": strms
        })

    # 2. Pre-fetch all track activities for the 4 soloists
    activities_rows = conn.execute("""
        SELECT activity_date, artist, track_title, songstats_track_id,
               source, activity_type, activity_tier, activity_text,
               playlist_followers, activity_url
        FROM track_activities
        WHERE artist IN ('LISA', 'JENNIE', 'ROSÉ', 'JISOO')
    """).fetchall()

    daily_activities = {}
    for r in activities_rows:
        adate, artist, track, sid, src, atype, atier, atext, followers, aurl = r
        daily_activities.setdefault(adate, []).append({
            "artist": artist,
            "track": track,
            "songstats_track_id": sid,
            "source": src,
            "activity_type": atype,
            "activity_tier": atier,
            "activity_text": atext,
            "playlist_followers": followers,
            "activity_url": aurl
        })

    # 3. Pre-fetch playlist longevity matrix
    longevity_rows = conn.execute("""
        SELECT artist, track, songstats_track_id,
               COUNT(DISTINCT date) as days_on_tth,
               MIN(tth_pos) as peak_tth,
               MIN(top50_global_pos) as peak_g50,
               MIN(kpop_on_pos) as peak_kpop,
               MAX(playlist_reach) as max_reach,
               MIN(date) as first_date,
               MAX(date) as last_date
        FROM v_daily_pivoted_positions
        WHERE tth_pos IS NOT NULL OR top50_global_pos IS NOT NULL OR kpop_on_pos IS NOT NULL
        GROUP BY artist, track
        ORDER BY days_on_tth DESC, max_reach DESC
    """).fetchall()

    playlist_longevity_radar = []
    for r in longevity_rows:
        playlist_longevity_radar.append({
            "artist": r[0],
            "track": r[1],
            "songstats_track_id": r[2],
            "days_on_tth": r[3],
            "peak_tth": r[4],
            "peak_g50": r[5],
            "peak_kpop": r[6],
            "max_reach": r[7],
            "first_date": r[8],
            "last_date": r[9]
        })

    # Member alias mapping
    member_aliases = {
        "lisa": ["LISA", "Lisa"],
        "jennie": ["JENNIE", "Jennie"],
        "rose": ["ROSÉ", "Rosé", "ROSE", "Rose"],
        "jisoo": ["JISOO", "Jisoo"]
    }

    dates_data = snapshot.get("dates_data", {})
    enriched_tracks_count = 0
    enriched_activities_count = 0

    for dt, members_dict in dates_data.items():
        date_pos_list = daily_positions.get(dt, [])
        date_act_list = daily_activities.get(dt, [])

        for member_key, mdata in members_dict.items():
            valid_aliases = member_aliases.get(member_key.lower(), [member_key])

            # Filter records for this member
            m_pos = [p for p in date_pos_list if p["artist"] in valid_aliases]
            m_act = [a for a in date_act_list if a["artist"] in valid_aliases]

            # Enrich top_songs and all_songs
            for song_list_key in ("top_songs", "all_songs"):
                songs = mdata.get(song_list_key, [])
                for s in songs:
                    sname = s.get("name", "")
                    
                    # Find matching position record
                    matched_p = None
                    for p in m_pos:
                        if matches_song(sname, p["track"]):
                            matched_p = p
                            break

                    if matched_p:
                        s["playlist_telemetry"] = {
                            "tth_pos": matched_p["tth_pos"],
                            "top50_global_pos": matched_p["top50_global_pos"],
                            "kpop_on_pos": matched_p["kpop_on_pos"],
                            "playlist_count": matched_p["playlist_count"],
                            "playlist_reach": matched_p["playlist_reach"],
                            "spotify_streams": matched_p["spotify_streams"],
                            "songstats_track_id": matched_p["songstats_track_id"]
                        }
                        enriched_tracks_count += 1
                    else:
                        s["playlist_telemetry"] = None

                    # Find matching activities for this song on this date
                    matched_acts = []
                    for a in m_act:
                        if matches_song(sname, a["track"]):
                            matched_acts.append({
                                "source": a["source"],
                                "type": a["activity_type"],
                                "tier": a["activity_tier"],
                                "text": a["activity_text"],
                                "followers": a["playlist_followers"]
                            })
                    s["activities"] = matched_acts[:5] if matched_acts else []
                    if matched_acts:
                        enriched_activities_count += len(matched_acts)

            # Add member-level playlist highlights on this date
            active_badges = []
            for p in m_pos:
                badges = []
                if p["tth_pos"]:
                    badges.append(f"TTH #{p['tth_pos']}")
                if p["top50_global_pos"]:
                    badges.append(f"Global #{p['top50_global_pos']}")
                if p["kpop_on_pos"]:
                    badges.append(f"K-Pop ON #{p['kpop_on_pos']}")
                if p["playlist_reach"]:
                    reach_m = round(p["playlist_reach"] / 1e6, 1)
                    badges.append(f"{reach_m}M Reach")
                if badges:
                    active_badges.append({
                        "track": p["track"],
                        "badges": badges,
                        "reach": p["playlist_reach"]
                    })

            mdata["playlist_highlights"] = active_badges
            # Top 3 major activities for this member on this date
            mdata["daily_activities"] = [
                {"text": a["activity_text"], "source": a["source"], "type": a["activity_type"]}
                for a in m_act if a["activity_tier"] == 1
            ][:4]

    # Attach global playlist longevity radar
    snapshot["playlist_longevity_radar"] = playlist_longevity_radar
    snapshot["playlist_enriched"] = True
    snapshot["playlist_enriched_at"] = snapshot.get("generated_at", "")

    # Write backup and output
    backup_path = SNAPSHOT_PATH.with_suffix(".json.bak")
    shutil.copyfile(SNAPSHOT_PATH, backup_path)
    with open(SNAPSHOT_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, separators=(',', ':'))

    print(f"✨ Successfully enriched snapshot!")
    print(f"  • Enriched track daily instances : {enriched_tracks_count:,}")
    print(f"  • Enriched activity links       : {enriched_activities_count:,}")
    print(f"  • Flagship longevity radar rows : {len(playlist_longevity_radar)}")
    print(f"  • Backup saved to               : {backup_path.name}")
    print(f"  • Updated JSON size             : {SNAPSHOT_PATH.stat().st_size / 1024:.1f} KB")

if __name__ == "__main__":
    main()
