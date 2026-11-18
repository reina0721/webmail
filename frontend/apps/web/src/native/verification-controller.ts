"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "@platform/lib/api";
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
  const [widgetIssue, setWidgetIssue] = useState<
    "configuration" | "connection" | null
  >(null);
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
        if (!r.mailSent && !turnstileKeyValid(r.siteKey)) {
          setError(turnstileConfigurationError);
          setWidgetIssue("configuration");
        }
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  function widgetError(code?: unknown) {
    setCaptcha("");
    setWidgetIssue(
      code === "110100" || code === "110110" || code === "110200"
        ? "configuration"
        : "connection",
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
          setWidgetIssue(null);
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
      } else {
        setSent(true);
        setWidgetIssue(null);
      }
    } catch (e) {
      setError(
        !sent && !(e instanceof ApiError)
          ? "发送连接中断，暂时无法确认发送结果。请重新加载验证页，查看是否已进入验证码输入步骤。"
          : errorMessage(e),
      );
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
    widgetIssue,
    target,
    submit,
    widgetError,
  };
}
