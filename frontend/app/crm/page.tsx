import { getDashboardData, getStrategyGoals } from "@/lib/data";
import CrmDashboard from "@/components/CrmDashboard";

// Same real-clock reasoning as app/page.tsx — never statically cache this page.
export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const data = await getDashboardData();
  const goals = getStrategyGoals();
  return <CrmDashboard data={data} goals={goals} />;
}
