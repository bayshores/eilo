"""Recorded foreground intervals, independent of inferred focus or completion."""

from datetime import UTC, datetime, timedelta


def usage_summary(episodes, now):
    today = datetime.fromtimestamp(now, UTC).date()
    dates = [(today - timedelta(days=offset)).isoformat() for offset in range(6, -1, -1)]
    sources = {
        source: {"days": dict.fromkeys(dates, 0), "sites": {}} for source in ("browser", "desktop")
    }
    for episode in episodes:
        source = sources.get(episode.get("source_id"))
        if source is None:
            continue
        for day, seconds in episode.get("daily_seconds", {}).items():
            if (
                day not in source["days"]
                or type(seconds) not in {int, float}
                or not 0 <= seconds <= 86400
            ):
                continue
            key = (
                episode.get("origin")
                if episode.get("source_id") == "browser"
                else episode.get("app_name")
            )
            if not key:
                continue
            source["days"][day] += seconds
            source["sites"][key] = source["sites"].get(key, 0) + seconds
    result = {}
    for name, source in sources.items():
        result[name] = {
            "timezone": "UTC",
            "scope": "retained_sessions",
            "days": [
                {"date": day, "observed_seconds": seconds}
                for day, seconds in source["days"].items()
            ],
            "sites": [
                {"origin" if name == "browser" else "app_name": key, "observed_seconds": seconds}
                for key, seconds in sorted(
                    source["sites"].items(), key=lambda item: (-item[1], item[0])
                )
            ],
            "total_observed_seconds": sum(source["days"].values()),
        }
    return result


def add_interval(days, start, end):
    while start < end:
        current = datetime.fromtimestamp(start, UTC)
        midnight = datetime.combine(
            current.date() + timedelta(days=1), datetime.min.time(), UTC
        ).timestamp()
        stop = min(midnight, end)
        day = current.date().isoformat()
        days[day] = days.get(day, 0) + stop - start
        start = stop
