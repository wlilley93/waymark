import { useState } from "react";
import type { UserPublic } from "@waymark/shared";
import { api } from "../api/client.js";
import { useStore } from "../state/store.js";

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const setUser = useStore((s) => s.setUser);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "signup") {
        await api.signup({ email, password, name });
      } else {
        await api.login({ email, password });
      }
      const me = (await api.me()) as UserPublic;
      setUser(me);
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      setError(body?.error ?? (err as Error).message);
    }
  };

  const resetRequest = async () => {
    if (!email) return setError("enter your email first");
    await api.login({ email, password: "" }).catch(() => {});
    await fetch("/api/auth/reset-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setInfo("if that account exists, a reset link was logged by the server (dev posture)");
  };

  return (
    <div className="auth">
      <h1>Waymark</h1>
      <p className="tagline">shared live maps of bookmarked places</p>
      <form onSubmit={submit}>
        {mode === "signup" && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (10+ chars)" autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        <button className="primary">{mode === "signup" ? "Create account" : "Log in"}</button>
      </form>
      <div className="row">
        <button className="link" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "need an account?" : "have an account?"}
        </button>
        <button className="link" onClick={() => void resetRequest()}>
          forgot password?
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {info && <p className="hint">{info}</p>}
    </div>
  );
}
