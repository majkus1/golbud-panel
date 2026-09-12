"use client";

import { InfoTip } from "@/components/info-tip";
import { MEMBER_ROLE_LABELS } from "@/lib/domain";
import {
  DIGEST_GROUP_HELP,
  DIGEST_PREF_GROUPS,
  NOTIFICATION_HELP,
  defaultNotificationPrefsForRole,
  groupChecked,
  setGroupChecked,
  type UserNotificationPrefs
} from "@/lib/notification-prefs";
import type { MemberRole, OrgMemberProfile } from "@/lib/types";

type Props = {
  member: OrgMemberProfile;
  prefs: UserNotificationPrefs;
  busy: boolean;
  onChange: (next: UserNotificationPrefs) => void;
  onSave: () => void;
  onResetRoleDefaults: () => void;
};

function LabelWithTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <InfoTip text={tip} />
    </span>
  );
}

export function TeamMemberNotificationPrefs({
  member,
  prefs,
  busy,
  onChange,
  onSave,
  onResetRoleDefaults
}: Props) {
  const roleLabel = MEMBER_ROLE_LABELS[member.role];

  return (
    <li className="rounded-xl2 border border-stone-200 bg-stone-50/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{member.email || "(brak e-mailu)"}</p>
          <p className="mt-0.5 text-xs text-steel">
            Rola: <span className="font-medium text-ink">{roleLabel}</span>
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="shrink-0 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss disabled:opacity-50"
        >
          {busy ? "Zapis…" : "Zapisz"}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-moss"
            checked={prefs.digest_enabled}
            onChange={(e) => onChange({ ...prefs, digest_enabled: e.target.checked })}
          />
          <span>
            <LabelWithTip label="Poranny digest" tip={NOTIFICATION_HELP.digest} />
            <span className="mt-0.5 block text-xs text-steel">Jeden mail rano z podsumowaniem na dany dzień</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-moss"
            checked={prefs.notify_new_case}
            onChange={(e) => onChange({ ...prefs, notify_new_case: e.target.checked })}
          />
          <span>
            <LabelWithTip label="Nowe zapytanie — od razu" tip={NOTIFICATION_HELP.newCase} />
            <span className="mt-0.5 block text-xs text-steel">Mail gdy w panelu pojawi się nowa sprawa od klienta</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-moss"
            checked={prefs.notify_task_comment}
            onChange={(e) => onChange({ ...prefs, notify_task_comment: e.target.checked })}
          />
          <span>
            <LabelWithTip label="Komentarz w zadaniu" tip={NOTIFICATION_HELP.taskComment} />
            <span className="mt-0.5 block text-xs text-steel">Mail gdy ktoś napisze w dyskusji zadania, do którego jesteś przypisany</span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-moss"
            checked={prefs.notify_financial_alerts}
            onChange={(e) => onChange({ ...prefs, notify_financial_alerts: e.target.checked })}
          />
          <span>
            <LabelWithTip label="Alert finansowy — od razu" tip={NOTIFICATION_HELP.financialAlert} />
            <span className="mt-0.5 block text-xs text-steel">Dzwonek/push przy większym koszcie, fakturze lub rozliczeniu wpływającym na kasę</span>
          </span>
        </label>

        {prefs.digest_enabled && (
          <div className="rounded-lg border border-stone-200 bg-white p-3">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-steel">
              Co w porannym digestcie
              <InfoTip text={NOTIFICATION_HELP.digestSections} />
            </p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {DIGEST_PREF_GROUPS.map((g) => (
                <li key={g.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-50">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-moss"
                      checked={groupChecked(prefs, g.id)}
                      onChange={(e) => {
                        const sections = setGroupChecked(prefs, g.id, e.target.checked);
                        onChange({ ...prefs, ...sections });
                      }}
                    />
                    <span>
                      <span className="inline-flex items-center gap-1">
                        <span className="text-sm font-medium text-ink">{g.label}</span>
                        <InfoTip text={DIGEST_GROUP_HELP[g.id]} />
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-2 inline-flex items-start gap-1.5 text-[0.65rem] leading-snug text-steel">
              <span>{NOTIFICATION_HELP.digestScope}</span>
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onResetRoleDefaults}
        title={NOTIFICATION_HELP.resetRole}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-moss hover:underline disabled:opacity-50"
      >
        Przywróć domyślne dla roli „{roleLabel}”
        <InfoTip text={NOTIFICATION_HELP.resetRole} />
      </button>
    </li>
  );
}

export function prefsFromMember(
  member: OrgMemberProfile,
  row: Partial<UserNotificationPrefs> | undefined
): UserNotificationPrefs {
  const defaults = defaultNotificationPrefsForRole(member.role);
  if (!row) return { ...defaults };
  return {
    digest_enabled: row.digest_enabled ?? defaults.digest_enabled,
    notify_new_case: row.notify_new_case ?? defaults.notify_new_case,
    notify_task_comment: row.notify_task_comment ?? defaults.notify_task_comment,
    notify_financial_alerts: row.notify_financial_alerts ?? defaults.notify_financial_alerts,
    push_enabled: row.push_enabled ?? defaults.push_enabled,
    include_reminders: row.include_reminders ?? defaults.include_reminders,
    include_overdue_contact: row.include_overdue_contact ?? defaults.include_overdue_contact,
    include_schedule: row.include_schedule ?? defaults.include_schedule,
    include_payments: row.include_payments ?? defaults.include_payments,
    include_tasks: row.include_tasks ?? defaults.include_tasks,
    include_fleet: row.include_fleet ?? defaults.include_fleet,
    include_warehouse: row.include_warehouse ?? defaults.include_warehouse,
    include_profitability_alerts: row.include_profitability_alerts ?? defaults.include_profitability_alerts,
    include_cost_invoices: row.include_cost_invoices ?? defaults.include_cost_invoices,
    include_employee_compliance: row.include_employee_compliance ?? defaults.include_employee_compliance,
    include_settlements: row.include_settlements ?? defaults.include_settlements,
    include_stale_cases: row.include_stale_cases ?? defaults.include_stale_cases
  };
}

export function prefsToDbRow(organizationId: string, userId: string, prefs: UserNotificationPrefs) {
  return {
    organization_id: organizationId,
    user_id: userId,
    digest_enabled: prefs.digest_enabled,
    notify_new_case: prefs.notify_new_case,
    notify_task_comment: prefs.notify_task_comment,
    notify_financial_alerts: prefs.notify_financial_alerts,
    include_reminders: prefs.include_reminders,
    include_overdue_contact: prefs.include_overdue_contact,
    include_schedule: prefs.include_schedule,
    include_payments: prefs.include_payments,
    include_tasks: prefs.include_tasks,
    include_fleet: prefs.include_fleet,
    include_warehouse: prefs.include_warehouse,
    include_profitability_alerts: prefs.include_profitability_alerts,
    include_cost_invoices: prefs.include_cost_invoices,
    include_employee_compliance: prefs.include_employee_compliance,
    include_settlements: prefs.include_settlements,
    include_stale_cases: prefs.include_stale_cases
  };
}

export function resetPrefsForRole(role: MemberRole, keepDigestEnabled: boolean): UserNotificationPrefs {
  const d = defaultNotificationPrefsForRole(role);
  return { ...d, digest_enabled: keepDigestEnabled };
}
