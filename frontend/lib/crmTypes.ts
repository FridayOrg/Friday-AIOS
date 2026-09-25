// Mirrors backend/app/crm_metrics.py's build_overview() response shape
// exactly — see that file's docstrings for how each field is calculated
// from HubSpot data. Keeping these types in one place (rather than inline
// in CrmDashboard.tsx) so the API route and every chart/table component
// agree on the shape.

export interface DealRow {
  id: number;
  name: string | null;
  company: string | null;
  value: number | null;
  currency: string | null;
  stage_id: number | null;
  stage_name: string | null;
  probability: number | null;
  expected_close_date: string | null;
  owner: string | null;
  age_days: number | null;
  last_activity_date: string | null;
  next_activity_date: string | null;
}

export interface StageRow {
  stage_id: number;
  stage_name: string;
  order: number;
  count: number;
  value: number;
}

export interface CrmOverview {
  configured: boolean;
  message?: string;
  error?: string;
  range?: { key: string; start: string; end: string };
  kpis?: {
    won_revenue: number;
    revenue_growth_pct: number | null;
    open_pipeline_value: number;
    deals_won: number;
    conversion_rate_pct: number | null;
    activities_due: number;
    new_contacts: number;
  };
  revenue?: {
    won_revenue: number;
    won_deal_count: number;
    pipeline_value: number;
    growth_pct: number | null;
    previous_period_revenue: number;
  };
  pipeline?: {
    total_open_value: number;
    total_open_count: number;
    by_stage: StageRow[];
    approaching_close_count: number;
    overdue_close_count: number;
    closing_this_month_value: number;
    closing_this_month_count: number;
  };
  qualified_leads?: {
    count_this_month: number | null;
    pct_change_vs_last_month: number | null;
    awaiting_first_contact: number | null;
  };
  top_deals?: DealRow[];
  risks?: {
    overdue_close_deals: DealRow[];
    approaching_close_deals: DealRow[];
    stalled_deals: DealRow[];
    large_deals_without_upcoming_activity: DealRow[];
    stale_activity_threshold_days: number;
    approaching_close_threshold_days: number;
  };
  activities?: {
    by_type: Record<string, number>;
    overdue_count: number;
    due_today_count: number;
    upcoming_count: number;
    recent: {
      id: number;
      subject: string;
      type: string;
      due_date: string | null;
      done: boolean;
    }[];
  };
  contacts?: {
    new_contacts_count: number;
    new_organizations_count: number;
    active_customers_count: number;
    prospects_count: number;
    accounts_without_recent_activity_count: number;
    accounts_without_recent_activity: { id: number; name: string; last_activity_date: string | null }[];
  };
  conversion?: { won_count: number; lost_count: number; rate_pct: number } | null;
  win_rate?: {
    won_count: number;
    lost_count: number;
    closed_count: number;
    rate_pct: number | null;
    window_days: number;
  };
  revenue_target?: number | null;
  forecast?: { forecast_value: number; included_deal_count: number; excluded_no_probability_count: number } | null;
  revenue_trend?: { period: string; points: { date: string; value: number }[] };
  won_vs_lost?: { month: string; won_value: number; lost_value: number }[];
  deals_by_stage?: { stage_name: string; count: number; value: number }[];
  deals_by_owner?: { owner: string; value: number; count: number }[];
  lost_reasons?: { reason: string; count: number; value: number }[];
  limitations?: string[];
}

export type DateRangeKey = "today" | "week" | "month" | "quarter" | "year" | "custom";
export type TrendPeriod = "7d" | "30d" | "90d" | "quarter" | "year";
