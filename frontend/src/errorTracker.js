/**
 * Error tracker: sends console/deploy errors to Django POST /api/errors/
 * CORS-friendly for localhost and Render.
 */

const getApiBase = () => {
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, "")
  }
  if (typeof window !== "undefined" && window.location.port === "5173") {
    return "http://localhost:8000"
  }
  if (typeof window !== "undefined") {
    return window.location.origin
  }
  return ""
}

const sendError = (payload) => {
  const base = getApiBase()
  if (!base) return
  const url = `${base}/api/errors/`
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {})
}

const buildPayload = (extra = {}) => ({
  message: extra.message ?? "",
  stack: extra.stack ?? "",
  source: extra.source ?? "",
  line: extra.line ?? null,
  column: extra.column ?? null,
  timestamp: new Date().toISOString(),
  url: typeof window !== "undefined" ? window.location.href : "",
  ...extra,
})

export function initErrorTracker() {
  if (typeof window === "undefined") return

  window.onerror = (message, source, line, column, error) => {
    sendError(
      buildPayload({
        message: String(message),
        stack: error && error.stack ? error.stack : "",
        source: source ?? "",
        line: line ?? null,
        column: column ?? null,
        kind: "window.onerror",
      })
    )
  }

  window.addEventListener("unhandledrejection", (event) => {
    const message = event.reason && (event.reason.message || String(event.reason))
    const stack = event.reason && event.reason.stack ? event.reason.stack : ""
    sendError(
      buildPayload({
        message: message || "Unhandled promise rejection",
        stack,
        kind: "unhandledrejection",
      })
    )
  })

  const originalConsoleError = console.error
  console.error = (...args) => {
    const message = args.map((a) => (typeof a === "object" && a !== null ? (a.message || JSON.stringify(a)) : String(a))).join(" ")
    const err = args.find((a) => a instanceof Error)
    sendError(
      buildPayload({
        message,
        stack: err && err.stack ? err.stack : "",
        kind: "console.error",
      })
    )
    originalConsoleError.apply(console, args)
  }
}
