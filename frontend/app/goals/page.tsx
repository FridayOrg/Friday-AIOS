import { getStrategyGoals } from "@/lib/data";
import GoalsPage from "@/components/GoalsPage";

export const dynamic = "force-dynamic";

export default function Goals() {
  const goals = getStrategyGoals();
  return <GoalsPage goals={goals} />;
}
