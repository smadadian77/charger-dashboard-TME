import json
import os
import sys
from backend.config import SERIAL_HISTORY_FILE

DEFAULT_SERIAL = "TACW2244723S0930"


def read_serial_history():
    """Reads the serial history from disk or returns default fallback."""
    if not os.path.exists(SERIAL_HISTORY_FILE):
        return {"lastSelected": DEFAULT_SERIAL, "history": [DEFAULT_SERIAL]}
    try:
        with open(SERIAL_HISTORY_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        last_selected = str(data.get("lastSelected", "") or "").strip().upper()
        raw_history = data.get("history", [])
        clean_history = []
        if isinstance(raw_history, list):
            for item in raw_history:
                s = str(item or "").strip().upper()
                if s and s not in clean_history:
                    clean_history.append(s)
        if last_selected and last_selected not in clean_history:
            clean_history.insert(0, last_selected)
        if not clean_history:
            clean_history = [DEFAULT_SERIAL]
        return {
            "lastSelected": last_selected or clean_history[0],
            "history": clean_history,
        }
    except Exception:
        return {"lastSelected": DEFAULT_SERIAL, "history": [DEFAULT_SERIAL]}


def write_serial_history(serial_number):
    """Records a new or searched serial number into serial history."""
    clean_serial = str(serial_number or "").strip().upper()
    current = read_serial_history()
    if not clean_serial or len(clean_serial) < 5:
        return current

    history = [clean_serial] + [s for s in current.get("history", []) if s != clean_serial]
    history = history[:40]
    payload = {
        "lastSelected": clean_serial,
        "history": history,
    }
    try:
        with open(SERIAL_HISTORY_FILE, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f"[ERROR] Failed to save serial history to disk: {exc}", file=sys.stderr)
    return payload


def delete_serial_from_history(serial_number):
    clean_serial = str(serial_number or "").strip().upper()
    current = read_serial_history()
    history = [s for s in current.get("history", []) if s != clean_serial]
    if not history:
        history = [DEFAULT_SERIAL]
    last_selected = current.get("lastSelected", "")
    if last_selected == clean_serial:
        last_selected = history[0]
    payload = {"lastSelected": last_selected, "history": history}
    try:
        with open(SERIAL_HISTORY_FILE, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f"[ERROR] Failed to save serial history to disk: {exc}", file=sys.stderr)
    return payload


def clear_serial_history():
    payload = {"lastSelected": DEFAULT_SERIAL, "history": [DEFAULT_SERIAL]}
    try:
        with open(SERIAL_HISTORY_FILE, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f"[ERROR] Failed to reset serial history on disk: {exc}", file=sys.stderr)
    return payload



def levenshtein_distance(s1, s2):
    """Calculates Levenshtein distance between two strings."""
    if s1 == s2:
        return 0
    if not s1:
        return len(s2)
    if not s2:
        return len(s1)

    v0 = list(range(len(s2) + 1))
    v1 = [0] * (len(s2) + 1)

    for i in range(len(s1)):
        v1[0] = i + 1
        for j in range(len(s2)):
            cost = 0 if s1[i] == s2[j] else 1
            v1[j + 1] = min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
        v0 = list(v1)

    return v0[len(s2)]


def find_best_match(query, candidates, max_distance=3):
    """Finds the best typo suggestion from candidates within max_distance."""
    query_upper = str(query or "").strip().upper()
    if not query_upper or not candidates:
        return None

    best = None
    best_dist = float("inf")

    for cand in candidates:
        cand_upper = str(cand or "").strip().upper()
        if cand_upper == query_upper:
            return cand_upper
        dist = levenshtein_distance(query_upper, cand_upper)
        if dist < best_dist and dist <= max_distance:
            best_dist = dist
            best = cand_upper

    return best
