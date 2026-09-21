"""Raw Pipedrive API access (api.pipedrive.com v1) — fetches deals, stages,
pipelines, activities, persons and organizations. This module only fetches
and paginates; all CEO-metric calculation (revenue, pipeline-by-stage,
risks, forecast, etc.) lives in crm_metrics.py so the two concerns
(talking to Pipedrive vs. deriving business meaning from the data) stay
separate and each is independently testable.

Same fail-safe convention as tavily/industry_client.py: a missing token or
an unreachable/erroring API never raises — it logs and returns an empty
list, so a Pipedrive outage degrades the CRM dashboard to "no data" rather
than crashing it. Callers (crm_metrics.py) are responsible for surfacing
"data unavailable" to the frontend rather than silently treating empty as
zero, per the no-fabricated-data requirement.
"""

import logging

import httpx

from .config import PIPEDRIVE_API_TOKEN, PIPEDRIVE_DOMAIN

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 20
_PAGE_LIMIT = 500  # Pipedrive's max per page


def is_configured() -> bool:
    return bool(PIPEDRIVE_API_TOKEN and PIPEDRIVE_DOMAIN)


def _base_url() -> str:
    return f"https://{PIPEDRIVE_DOMAIN}.pipedrive.com/api/v1"


def _get_paginated(path: str, params: dict | None = None) -> list[dict]:
    """Follows Pipedrive's start/limit pagination (additional_data.pagination)
    until more_items_in_collection is false. Returns [] on any failure or if
    Pipedrive isn't configured."""
    if not is_configured():
        return []

    items: list[dict] = []
    start = 0
    params = dict(params or {})
    params["api_token"] = PIPEDRIVE_API_TOKEN
    params["limit"] = _PAGE_LIMIT

    while True:
        params["start"] = start
        try:
            response = httpx.get(
                f"{_base_url()}/{path}", params=params, timeout=_TIMEOUT_SECONDS
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Pipedrive API error %s for %s: %s",
                e.response.status_code, path, e.response.text[:200],
            )
            return items
        except httpx.HTTPError as e:
            logger.warning("Pipedrive API unreachable for %s: %s", path, e)
            return items

        body = response.json()
        batch = body.get("data") or []
        items.extend(batch)

        pagination = (body.get("additional_data") or {}).get("pagination") or {}
        if not pagination.get("more_items_in_collection"):
            break
        start = pagination.get("next_start", start + _PAGE_LIMIT)

    return items


def get_deals(status: str = "all_not_deleted") -> list[dict]:
    """status: "open" | "won" | "lost" | "deleted" | "all_not_deleted"."""
    return _get_paginated("deals", {"status": status})


def get_stages() -> list[dict]:
    return _get_paginated("stages")


def get_pipelines() -> list[dict]:
    return _get_paginated("pipelines")


def get_activities(done: int | None = None) -> list[dict]:
    """done: None (all), 0 (not done), 1 (done)."""
    params = {} if done is None else {"done": done}
    return _get_paginated("activities", params)


def get_persons() -> list[dict]:
    return _get_paginated("persons")


def get_organizations() -> list[dict]:
    return _get_paginated("organizations")
