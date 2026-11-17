"use client";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Action } from "@mail-web/ui/action";
import { TextField } from "@mail-web/ui/form-field";
import { api, errorMessage } from "@platform/lib/api";
import type {} from "./auth-controller";
import {
  turnstileKeyValid,
  turnstileConfigurationError,
} from "./turnstile-key";
export function useVerification() {
  const [ticket, setTicket] = useState(""),
    [siteKey, setSiteKey] = useState(""),
    [ready, setReady] = useState(false),
    [captcha, setCaptcha] = useState(""),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [done, setDone] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const target = useRef<HTMLDivElement>(null),
    widget = useRef<string | undefined>(undefined);
  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1)),
      value = fragment.get("check") ?? history.state?.registrationCheck ?? "";
    history.replaceState(
      { ...history.state, registrationCheck: value },
      "",
      location.pathname,
    );
    setTicket(value);
    void api<{ siteKey: string; mailSent: boolean }>("/readiness/session", {
      method: "POST",
      body: JSON.stringify({ ticket: value }),
    })
      .then((r) => {
        setSiteKey(r.siteKey);
        setSent(r.mailSent);
        if (!r.mailSent && !turnstileKeyValid(r.siteKey))
          setError(turnstileConfigurationError);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  function widgetError() {
    setCaptcha("");
    setError(
      "人机验证组件加载失败。请检查 Turnstile Site Key、组件允许的主机名和网络连接，然后重新加载此页；此时尚未发送检查邮件。",
    );
    return true;
  }
  useEffect(() => {
    if (
      !ready ||
      !turnstileKeyValid(siteKey) ||
      !target.current ||
      !window.turnstile ||
      sent
    )
      return;
    try {
      const id = window.turnstile.render(target.current, {
        sitekey: siteKey,
        callback: (value) => {
          setCaptcha(value);
          setError("");
        },
        "expired-callback": () => setCaptcha(""),
        "error-callback": widgetError,
      });
      widget.current = id;
      return () => {
        try {
          window.turnstile?.remove(id);
        } catch {
          /* A failed widget may already be removed. */
        }
        widget.current = undefined;
      };
    } catch {
      widgetError();
    }
  }, [ready, siteKey, sent]);
  async function submit() {
    if (pending || !ticket || done || (!sent && !captcha)) return;
    setPending(true);
    setError("");
    try {
      await api(sent ? "/readiness/verify" : "/readiness/send", {
        method: "POST",
        body: JSON.stringify({ ticket, email, code, turnstile_token: captcha }),
      });
      if (sent) {
        setDone(true);
        setTicket("");
        setCaptcha("");
        setCode("");
        history.replaceState(
          { ...history.state, registrationCheck: null },
          "",
          location.pathname,
        );
      } else setSent(true);
    } catch (e) {
      setError(errorMessage(e));
      if (!sent) {
        setCaptcha("");
        if (widget.current) {
          try {
            window.turnstile?.reset(widget.current);
          } catch {
            widgetError();
          }
        }
      }
    } finally {
      setPending(false);
    }
  }
  return {
    ticket,
    siteKey,
    ready,
    setReady,
    captcha,
    email,
    setEmail,
    code,
    setCode,
    sent,
    done,
    pending,
    error,
    target,
    submit,
    widgetError,
  };
}
