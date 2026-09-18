import { getDashboardData, getStrategyGoals } from "@/lib/data";
import CeoDashboard from "@/components/CeoDashboard";

// Reads the real system clock (via lib/data → lib/paths) on every request, so the
// dashboard must never be statically cached — otherwise "today" / past-meeting
// marking freezes at build time.
export const dynamic = "force-dynamic";

// Server component: reads all mock-data at request time, hands it to the client
// dashboard for the collapse/expand interactivity. Keeps data-loading server-side
// (no loading flash) and presentation in the client component.
export default async function DashboardPage() {
  const data = await getDashboardData();
  const goals = getStrategyGoals();
  return <CeoDashboard data={data} goals={goals} />;
}
