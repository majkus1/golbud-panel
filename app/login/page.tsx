"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { getPasswordRecoveryRedirectUrl } from "@/lib/app-url";

type Mode = "login" | "signup" | "forgot" | "new-password";

function authErrorMessage(message: string): string {
  if (message === "Invalid login credentials") return "Nieprawidłowy email lub hasło.";
  if (message.toLowerCase().includes("email not confirmed")) return "Potwierdź adres e-mail przed logowaniem.";
  if (message.toLowerCase().includes("email rate limit exceeded")) {
    return "Limit wysyłki maili Supabase — poczekaj ok. godzinę lub włącz własny SMTP w Supabase (Authentication → SMTP).";
  }
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const activateRecovery = () => {
      if (active) setMode("new-password");
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get("recovery") === "1") {
      activateRecovery();
    }

    const code = params.get("code");
    if (code) {
      void supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (!active) return;
        if (error) {
          setFeedback(authErrorMessage(error.message));
          return;
        }
        activateRecovery();
        window.history.replaceState({}, "", "/login?recovery=1");
      });
    }

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        activateRecovery();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const setFeedback = (text: string, tone: "error" | "success" = "error") => {
    setMessage(text);
    setMessageTone(tone);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (mode === "forgot") {
        const { url, blocked } = getPasswordRecoveryRedirectUrl();
        if (blocked) {
          setFeedback(blocked);
          return;
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: url
        });
        if (error) {
          setFeedback(authErrorMessage(error.message));
          return;
        }
        setFeedback("Wysłaliśmy link do ustawienia nowego hasła. Sprawdź skrzynkę e-mail (także spam).", "success");
        return;
      }

      if (mode === "new-password") {
        if (password.length < 6) {
          setFeedback("Hasło musi mieć co najmniej 6 znaków.");
          return;
        }
        if (password !== passwordConfirm) {
          setFeedback("Hasła nie są takie same.");
          return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          setFeedback(authErrorMessage(error.message));
          return;
        }
        setFeedback("Hasło zostało zmienione. Za chwilę przejdziesz do panelu.", "success");
        setTimeout(() => router.push("/"), 1200);
        return;
      }

      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        setFeedback(authErrorMessage(result.error.message));
        return;
      }

      if (mode === "signup") {
        setFeedback("Konto utworzone. Jeśli wymagane jest potwierdzenie e-mail, sprawdź skrzynkę.", "success");
        return;
      }

      router.push("/");
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "login"
      ? "Logowanie"
      : mode === "signup"
        ? "Utwórz konto"
        : mode === "forgot"
          ? "Przypomnienie hasła"
          : "Ustaw nowe hasło";

  const subtitle =
    mode === "login"
      ? "Zaloguj się, żeby przejść do panelu GolBud."
      : mode === "signup"
        ? "Załóż konto, żeby uzyskać dostęp do panelu."
        : mode === "forgot"
          ? "Podaj e-mail konta — wyślemy link do ustawienia nowego hasła."
          : "Wpisz nowe hasło do swojego konta.";

  const submitLabel =
    mode === "login"
      ? "Zaloguj"
      : mode === "signup"
        ? "Zarejestruj"
        : mode === "forgot"
          ? "Wyślij link"
          : "Zapisz nowe hasło";

  return (
    <main className="flex min-h-screen items-center justify-center bg-concrete px-4 py-8">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-panel lg:grid-cols-[1.1fr_0.9fr]">
        <section className="flex min-h-48 items-center justify-center border-b border-amberline/25 bg-white p-8 sm:p-10 lg:border-b-0 lg:border-r">
          <Image
            src="/logo-golbud.png"
            alt="GolBud"
            width={300}
            height={80}
            className="h-auto w-full max-w-[300px]"
            priority
          />
        </section>
        <section className="p-8 sm:p-10">
          <h2 className="text-2xl font-bold text-ink">{title}</h2>
          <p className="mt-2 text-sm text-steel">{subtitle}</p>
          {!isSupabaseConfigured && (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Uzupełnij `.env.local`, żeby uruchomić logowanie.
            </div>
          )}
          <form onSubmit={submit} className="mt-6 grid gap-4">
            {mode !== "new-password" && (
              <label className="grid gap-1.5 text-sm font-semibold text-ink">
                Email
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" autoComplete="email" />
              </label>
            )}
            {mode !== "forgot" && (
              <label className="grid gap-1.5 text-sm font-semibold text-ink">
                {mode === "new-password" ? "Nowe hasło" : "Hasło"}
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  autoComplete={mode === "new-password" ? "new-password" : mode === "signup" ? "new-password" : "current-password"}
                />
              </label>
            )}
            {mode === "new-password" && (
              <label className="grid gap-1.5 text-sm font-semibold text-ink">
                Powtórz hasło
                <input
                  type="password"
                  required
                  minLength={6}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="input"
                  autoComplete="new-password"
                />
              </label>
            )}
            {mode === "login" && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setMessage("");
                    setPassword("");
                  }}
                  className="text-sm font-semibold text-moss hover:text-ink"
                >
                  Nie pamiętasz hasła?
                </button>
              </div>
            )}
            {message && (
              <p
                className={`rounded-md p-3 text-sm ${
                  messageTone === "success" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"
                }`}
              >
                {message}
              </p>
            )}
            <button disabled={loading || !isSupabaseConfigured} className="rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white hover:bg-moss disabled:opacity-60">
              {loading ? "Proszę czekać..." : submitLabel}
            </button>
          </form>
          <div className="mt-5 flex flex-col gap-2 text-sm font-semibold">
            {mode === "forgot" || mode === "new-password" ? (
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setMessage("");
                  setPassword("");
                  setPasswordConfirm("");
                }}
                className="text-left text-moss hover:text-ink"
              >
                ← Wróć do logowania
              </button>
            ) : (
              <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")} className="text-left text-moss hover:text-ink">
                {mode === "login" ? "Nie masz konta? Utwórz konto" : "Masz konto? Wróć do logowania"}
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
