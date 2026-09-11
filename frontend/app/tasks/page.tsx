"use client";

import { useEffect, useState } from "react";
import { CheckSquare } from "lucide-react";

interface Task {
  id: string;
  type: string;
  title: string;
  description: string;
  due_date: string;
  priority: string;
  status: string;
  related_client?: string;
  raised_by?: string;
}

const STATUS_STYLE: Record<string, string> = {
  overdue: "bg-red-50 text-red-600",
  pending: "bg-amber-50 text-amber-600",
};

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => setTasks(data.tasks))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <CheckSquare size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading tasks…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((t) => (
            <div
              key={t.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">{t.title}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${
                      PRIORITY_STYLE[t.priority] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {t.priority}
                  </span>
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${
                      STATUS_STYLE[t.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {t.status}
                  </span>
                </div>
              </div>
              <p className="text-sm text-slate-600">{t.description}</p>
              <div className="flex items-center gap-4 text-xs text-slate-400 mt-1">
                <span>Due {t.due_date}</span>
                {t.related_client && <span>Client: {t.related_client}</span>}
                {t.raised_by && <span>Raised by {t.raised_by}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
