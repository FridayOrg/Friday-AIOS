import { User } from "lucide-react";

// Kept intentionally minimal per CLAUDE.md — no auth/DB yet, so this is a static
// placeholder for the founder's profile rather than an editable settings page.
export default function ProfilePage() {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <User size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-semibold">
            F
          </div>
          <div>
            <div className="font-semibold text-slate-900">Founder</div>
            <div className="text-sm text-slate-400">BookMySales.ai</div>
          </div>
        </div>
        <p className="text-sm text-slate-500">
          Profile management (name, role, notification preferences) isn&rsquo;t built
          yet — this MVP has no accounts or database. This page is a placeholder for
          that future settings surface.
        </p>
      </div>
    </div>
  );
}
