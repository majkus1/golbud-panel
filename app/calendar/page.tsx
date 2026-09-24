"use client";

import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { CompanyCalendar } from "@/components/calendar/company-calendar";

export default function CalendarPage() {
  return (
    <AuthGate>
      {() => (
        <AppShell>
          <CompanyCalendar />
        </AppShell>
      )}
    </AuthGate>
  );
}
