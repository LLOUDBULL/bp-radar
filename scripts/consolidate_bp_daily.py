#!/usr/bin/env python3
"""
consolidate_bp_daily.py — Extracts and compiles multi-date Kworb telemetry
for the 4 BLACKPINK solo members into a compact, optimized JSON snapshot.

Members:
- Lisa: 1I81HxbHsWNrMCE4WMeYJJUN9Uc4zPHsLJ_5D_04wE2k
- Jennie: 1MMZWR-gsyHUEoOTHkbUAoQyOD7xA1qOSBarwOwphRjY
- Rose: 1MtZ_LEXXpNSsKaPnow-RkJee8RWLd-V_vY0EZbMfM4U
- Jisoo: 1d4r2ZSFAhL_s7Qqap93LeW97NKXcTxmWPQEA7YUWms8
"""

import os
import sys
import json
import time
from datetime import datetime
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

TOKEN_PATH = "/Users/bibbler/Gemini_Workspace/music_intel/scrapers/kworb_tracker/token.json"
OUTPUT_DIR = "/Users/bibbler/Gemini_Workspace/music_intel/dashboards/bp_consolidated/data"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "bp_daily_snapshot.json")

MEMBERS = {
    "Lisa": {
        "id": "1I81HxbHsWNrMCE4WMeYJJUN9Uc4zPHsLJ_5D_04wE2k",
        "avatar": "./assets/images/lisa.jpg",
        "accent": "#F59E0B"
    },
    "Jennie": {
        "id": "1MMZWR-gsyHUEoOTHkbUAoQyOD7xA1qOSBarwOwphRjY",
        "avatar": "./assets/images/jennie.jpg",
        "accent": "#EC4899"
    },
    "Rose": {
        "id": "1MtZ_LEXXpNSsKaPnow-RkJee8RWLd-V_vY0EZbMfM4U",
        "displayName": "Rosé",
        "avatar": "./assets/images/rose.jpg",
        "accent": "#38BDF8"
    },
    "Jisoo": {
        "id": "1d4r2ZSFAhL_s7Qqap93LeW97NKXcTxmWPQEA7YUWms8",
        "avatar": "./assets/images/jisoo.jpg",
        "accent": "#A855F7"
    }
}

def clean_int(val):
    if not val: return 0
    val_str = str(val).replace(",", "").strip()
    try:
        return int(float(val_str))
    except:
        return 0

def clean_float(val):
    if not val: return 0.0
    val_str = str(val).replace("%", "").strip()
    try:
        return float(val_str)
    except:
        return 0.0

def build_snapshot():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    creds = Credentials.from_authorized_user_file(TOKEN_PATH)
    service = build("sheets", "v4", credentials=creds)

    consolidated_by_date = {}
    all_dates = set()

    for name, meta in MEMBERS.items():
        sid = meta["id"]
        print(f"Fetching data for {name}...")

        # 1. Fetch Summary tab
        res_sum = service.spreadsheets().values().get(spreadsheetId=sid, range="Summary!A2:M").execute()
        summary_rows = res_sum.get("values", [])

        # Group summary rows by date
        # In Summary: Col A=Date, Col B=Metric (Streams, Daily, Tracks), Col C=Total, Col D=As lead, Col E=Solo, Col F=Feature, Col G=Lead Ratio, Col H=Solo Ratio, Col I=Feature Ratio, Col K=Total Change, Col L=Lead Change, Col M=Solo Change
        member_dates = {}
        for r in summary_rows:
            if not r or len(r) < 3: continue
            d = r[0].strip()
            metric = r[1].strip()
            all_dates.add(d)

            if d not in member_dates:
                member_dates[d] = {"streams": {}, "daily": {}, "tracks": {}}

            row_data = {
                "total": clean_int(r[2]),
                "lead": clean_int(r[3]) if len(r) > 3 else 0,
                "solo": clean_int(r[4]) if len(r) > 4 else 0,
                "feature": clean_int(r[5]) if len(r) > 5 else 0,
                "lead_ratio": clean_float(r[6]) if len(r) > 6 else 0.0,
                "solo_ratio": clean_float(r[7]) if len(r) > 7 else 0.0,
                "total_change": clean_int(r[10]) if len(r) > 10 else 0,
                "lead_change": clean_int(r[11]) if len(r) > 11 else 0,
                "solo_change": clean_int(r[12]) if len(r) > 12 else 0,
            }

            if metric.lower() == "streams":
                member_dates[d]["streams"] = row_data
            elif metric.lower() == "daily":
                member_dates[d]["daily"] = row_data
            elif metric.lower() == "tracks":
                member_dates[d]["tracks"] = row_data

        # 2. Fetch Songs tab for top songs
        # In Songs: Col A=Date, Col B=Name, Col C=Total, Col D=Daily, Col E=Total Change, Col F=Daily Change
        res_songs = service.spreadsheets().values().get(spreadsheetId=sid, range="Songs!A2:F").execute()
        songs_rows = res_songs.get("values", [])
        
        songs_by_date = {}
        for r in songs_rows:
            if not r or len(r) < 4: continue
            d = r[0].strip()
            song_obj = {
                "name": r[1].strip(),
                "total_streams": clean_int(r[2]),
                "daily_streams": clean_int(r[3]),
                "total_change": clean_int(r[4]) if len(r) > 4 else 0,
                "daily_change": clean_int(r[5]) if len(r) > 5 else 0
            }
            songs_by_date.setdefault(d, []).append(song_obj)

        # Sort songs by daily streams descending per date, keep top 5
        for d, s_list in songs_by_date.items():
            s_list.sort(key=lambda x: x["daily_streams"], reverse=True)
            if d in member_dates:
                member_dates[d]["top_songs"] = s_list[:5]

        # Populate into consolidated structure
        for d, d_data in member_dates.items():
            if d not in consolidated_by_date:
                consolidated_by_date[d] = {}
            consolidated_by_date[d][name] = d_data

    sorted_dates = sorted(list(all_dates), reverse=True)
    latest_date = sorted_dates[0] if sorted_dates else ""

    # Forward-fill any missing member entries chronologically (oldest to newest)
    chronological_dates = sorted(list(all_dates))
    last_known = {}
    for d in chronological_dates:
        day_dict = consolidated_by_date.get(d, {})
        for name in MEMBERS.keys():
            if name in day_dict and day_dict[name].get("streams", {}).get("total", 0) > 0:
                last_known[name] = day_dict[name]
            elif name not in day_dict and name in last_known:
                # Carry forward last known catalog and streams, set delta to 0
                carried = json.loads(json.dumps(last_known[name]))
                carried["streams"]["total_change"] = 0
                carried["daily"]["total_change"] = 0
                carried["is_carried_forward"] = True
                day_dict[name] = carried
        consolidated_by_date[d] = day_dict

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "latest_date": latest_date,
        "available_dates": sorted_dates,
        "members_meta": {
            k: {
                "id": v["id"],
                "displayName": v.get("displayName", k),
                "accent": v["accent"],
                "avatar": v["avatar"]
            } for k, v in MEMBERS.items()
        },
        "dates_data": consolidated_by_date
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(payload, f, separators=(',', ':'))

    size_kb = os.path.getsize(OUTPUT_FILE) / 1024
    print(f"\n[Snapshot Generated] {OUTPUT_FILE}")
    print(f"Total dates captured: {len(sorted_dates)}")
    print(f"Latest date: {latest_date}")
    print(f"File size: {size_kb:.1f} KB")

if __name__ == "__main__":
    build_snapshot()
