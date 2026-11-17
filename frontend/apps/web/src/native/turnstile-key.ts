// Syntax checks do not certify a widget; real human and mail verification is required.
export const turnstileKeyValid = (value: string) =>
  /^[A-Za-z0-9_-]{1,256}$/.test(value);
export const turnstileConfigurationError =
  "Turnstile Site Key 和 Secret 必须来自同一个 Cloudflare Turnstile 组件，不能填写网站地址或 API Token。请返回站点设置使用 API Token 自动配置。";
