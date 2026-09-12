"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { OrgProvider, useOrg } from "@/components/org-context";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

function OrgReadyGate({ session, children }: { session: Session; children: (session: Session) => React.ReactNode }) {
  const { organizationId, loading, error } = useOrg();

  if (loading) {
    return <div className="min-h-screen bg-concrete p-6 text-sm text-steel">Ładowanie organizacji...</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-concrete p-6">
        <div className="mx-auto max-w-xl rounded-lg bg-white p-6 shadow-panel">
          <h1 className="text-xl font-bold text-rose-700">Błąd konfiguracji konta</h1>
          <p className="mt-2 text-sm text-steel">{error}</p>
          <p className="mt-3 text-xs text-steel">
            Upewnij się, że w Supabase uruchomiono aktualny skrypt `supabase/schema.sql` (tabele organizacji i funkcja
            `ensure_user_org`).
          </p>
        </div>
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="min-h-screen bg-concrete p-6 text-sm text-steel">Brak przypisanej organizacji. Skontaktuj się z administratorem.</div>
    );
  }

  return <>{children(session)}</>;
}

export function AuthGate({ children }: { children: (session: Session) => React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        const qs = window.location.search;
        const params = new URLSearchParams(qs);
        // Zachowaj ?code= z linku resetu hasła — inaczej PKCE ginie przy przekierowaniu na /login.
        if (params.has("code") || params.get("type") === "recovery") {
          router.push(`/login${qs || "?recovery=1"}`);
        } else {
          router.push("/login");
        }
        return;
      }
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (!currentSession) {
        router.push("/login");
        return;
      }
      if (event === "PASSWORD_RECOVERY") {
        router.push("/login?recovery=1");
        return;
      }
      setSession(currentSession);
    });

    return () => listener.subscription.unsubscribe();
  }, [router]);

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-concrete p-6">
        <div className="mx-auto max-w-xl rounded-lg bg-white p-6 shadow-panel">
          <h1 className="text-xl font-bold text-ink">Brakuje konfiguracji Supabase</h1>
          <p className="mt-2 text-sm text-steel">
            Uzupełnij zmienne `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_ANON_KEY` w pliku `.env.local`.
          </p>
        </div>
      </div>
    );
  }

  if (loading || !session) {
    return <div className="min-h-screen bg-concrete p-6 text-sm text-steel">Ładowanie panelu...</div>;
  }

  return (
    <OrgProvider userId={session.user.id}>
      <OrgReadyGate session={session}>{children}</OrgReadyGate>
    </OrgProvider>
  );
}
