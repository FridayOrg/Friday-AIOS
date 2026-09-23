"use client";

import { useEffect, useState } from "react";
import { User, Camera, Briefcase, Building2, MapPin } from "lucide-react";

// Reads the CEO's real name/title/location/experience straight out of team.md (via
// the existing /api/context endpoint) rather than hardcoding a person's details into
// this component — per CLAUDE.md's rule against hardcoding company/team facts into
// UI code. Only the "no accounts yet" framing below is our own placeholder copy.
interface ContextFile {
  slug: string;
  title: string;
  content: string;
}

interface CeoProfile {
  name: string;
  title: string;
  location: string;
  primary: string;
  subSkills: string;
}

function parseCeoFromTeamDoc(content: string): CeoProfile | null {
  const match = content.match(
    /\*\*([^,*]+),\s*([^(*]+?)\s*\(([^)]+)\)\*\*\s*\nPrimary:\s*([^\n]+)\s*\nSub-skills:\s*([^\n]+)/
  );
  if (!match || !/CEO/i.test(match[2])) return null;
  const [, name, title, location, primary, subSkills] = match;
  return { name: name.trim(), title: title.trim(), location: location.trim(), primary: primary.trim(), subSkills: subSkills.trim() };
}

export default function ProfilePage() {
  const [ceo, setCeo] = useState<CeoProfile | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/context")
      .then((r) => r.json())
      .then((data) => {
        const files: ContextFile[] = data.files ?? [];
        const teamDoc = files.find((f) => f.slug === "team");
        if (teamDoc) setCeo(parseCeoFromTeamDoc(teamDoc.content));
        const profileDoc = files.find((f) => f.slug === "company-profile");
        const titleMatch = profileDoc?.content.match(/^#\s*([^:\n]+)/);
        if (titleMatch) setCompanyName(titleMatch[1].trim());
      })
      .finally(() => setLoading(false));
  }, []);

  const experience = ceo ? [ceo.primary, ceo.subSkills] : [];

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <User size={22} className="text-sky-400" />
        <h1 className="text-2xl font-bold text-white">Profile</h1>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading profile...</p>
      ) : (
        <div className="bg-[#141E33] rounded-2xl border border-white/10 overflow-hidden">
          {/* Header band */}
          <div className="px-8 pt-8 pb-6 bg-gradient-to-br from-white/5 to-transparent border-b border-white/10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <div className="relative shrink-0">
                <div className="h-24 w-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                  <User size={36} className="text-slate-500" />
                </div>
                <button
                  type="button"
                  aria-label="Upload profile photo"
                  title="Upload photo"
                  className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-sky-500 text-white flex items-center justify-center border-2 border-[#141E33] hover:bg-sky-400 transition-colors"
                >
                  <Camera size={14} />
                </button>
              </div>

              <div className="min-w-0">
                <h2 className="text-xl font-bold text-white">{ceo?.name ?? "Founder"}</h2>
                <p className="text-sm text-slate-400 mt-0.5">{ceo?.title ?? "Chief Executive Officer"}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-slate-400">
                  {companyName && (
                    <span className="flex items-center gap-1.5">
                      <Building2 size={13} className="text-slate-500" />
                      {companyName}
                    </span>
                  )}
                  {ceo?.location && (
                    <span className="flex items-center gap-1.5">
                      <MapPin size={13} className="text-slate-500" />
                      {ceo.location}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Experience */}
          <div className="px-8 py-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100 mb-3">
              <Briefcase size={15} className="text-sky-400" />
              Experience
            </div>
            {experience.length ? (
              <ul className="flex flex-col gap-2.5">
                {experience.map((line, i) => (
                  <li key={i} className="text-sm text-slate-300 leading-relaxed pl-4 border-l-2 border-white/10">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No experience details found in the team context.</p>
            )}
          </div>

          <div className="px-8 pb-8">
            <p className="text-xs text-slate-400 leading-relaxed border-t border-white/10 pt-4">
              Full profile management (editable name, role, and notification preferences) isn&rsquo;t built yet.
              This MVP has no accounts or database, so this page reflects the founder&rsquo;s details from the
              company&rsquo;s own context files.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
