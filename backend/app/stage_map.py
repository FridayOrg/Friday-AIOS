"""Tab 30 (Stage Map) as code. A client's CRM pipeline stage names are specific to
that CRM's own setup; this table translates them into RevenueOS's small, fixed set of
stage names so the rest of the app (playbook rules, dashboard) never needs to know
what a given client happened to call their stages.

This is onboarding configuration, not data pulled from a CRM or file — it's defined
once per client's pipeline. Kept tiny on purpose (8 rows) per the handoff doc.
"""

STAGE_MAP = {
    "New Lead": "New Lead",
    "Qualified": "Qualified",
    "Discovery": "Discovery",
    "Solution Review": "Solution",
    "Proposal Sent": "Proposal",
    "Negotiation": "Decision",
    "Won": "Won",
    "Lost": "Lost / Nurture",
}


def map_source_stage_to_revenueos(source_stage: str | None) -> str | None:
    """Translates a raw CRM stage name into the RevenueOS stage name. Returns None
    (rather than guessing) if the source stage isn't in the map."""
    if source_stage is None:
        return None
    return STAGE_MAP.get(source_stage)
