import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App.jsx"
import { initErrorTracker } from "./errorTracker.js"

initErrorTracker()

const rootEl = document.getElementById("root")
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl)
  root.render(<App />)
}
