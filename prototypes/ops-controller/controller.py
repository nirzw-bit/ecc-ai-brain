"""ECC operations controller prototype.

Planning-only, deterministic and offline. It never calls Supabase, GitHub,
Railway, HTTP endpoints, or production functions. It only decides which
read-only/isolated phase is eligible based on recorded evidence.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Any

ALLOWED = {"PASS", "FAIL", "BLOCKED", "NOT_RUN", "IN_PROGRESS"}


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def build_plan(state: dict[str, Any], now: datetime) -> dict[str, Any]:
    if now.tzinfo is None:
        raise ValueError("now must include a timezone")

    archive = state.get("archive_verification", {})
    reliability = state.get("reliability", {})
    efficiency = state.get("efficiency", {})
    for label, item in (("archive_verification", archive), ("reliability", reliability), ("efficiency", efficiency)):
        status = item.get("status", "NOT_RUN")
        if status not in ALLOWED:
            raise ValueError(f"invalid {label} status: {status}")

    actions: list[dict[str, str]] = []
    audit_due = parse_time(state.get("independent_auditor", {}).get("next_due_at"))
    if audit_due is None or now.astimezone(timezone.utc) >= audit_due:
        actions.append({"role": "independent_auditor", "decision": "ELIGIBLE", "mode": "READ_ONLY"})
    else:
        actions.append({"role": "independent_auditor", "decision": "NOT_DUE", "mode": "READ_ONLY"})

    archive_status = archive.get("status", "NOT_RUN")
    if archive_status != "PASS":
        actions.append({"role": "reliability", "decision": "BLOCKED", "reason": "archive verification must be PASS", "mode": "OBSERVATION_ONLY"})
    else:
        started = parse_time(reliability.get("started_at"))
        if reliability.get("status") == "PASS":
            actions.append({"role": "reliability", "decision": "COMPLETE", "mode": "OBSERVATION_ONLY"})
        elif started is None:
            actions.append({"role": "reliability", "decision": "ELIGIBLE_TO_START", "mode": "OBSERVATION_ONLY"})
        elif now.astimezone(timezone.utc) < started + timedelta(hours=24):
            actions.append({"role": "reliability", "decision": "CONTINUE_OBSERVATION", "mode": "OBSERVATION_ONLY"})
        else:
            actions.append({"role": "reliability", "decision": "READY_FOR_FINAL_REVIEW", "mode": "OBSERVATION_ONLY"})

    if reliability.get("status") != "PASS":
        actions.append({"role": "efficiency_challenge", "decision": "BLOCKED", "reason": "reliability must be completed with PASS", "mode": "ISOLATED_TESTS_ONLY"})
    elif efficiency.get("status") == "PASS":
        actions.append({"role": "efficiency_challenge", "decision": "COMPLETE", "mode": "ISOLATED_TESTS_ONLY"})
    else:
        actions.append({"role": "efficiency_challenge", "decision": "ELIGIBLE", "mode": "ISOLATED_TESTS_ONLY"})

    return {
        "controller": "ecc-ops-controller-prototype",
        "planning_only": True,
        "external_calls": False,
        "production_mutations": False,
        "existing_chatgpt_roles": "UNCHANGED",
        "actions": actions,
    }
