import { getDashboardData } from "@/lib/data";
import CrmDashboard from "@/components/CrmDashboard";

// Same real-clock reasoning as app/page.tsx — never statically cache this page.
export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const { today } = await getDashboardData();
  return <CrmDashboard today={today} />;
}
