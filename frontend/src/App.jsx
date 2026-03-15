import { useEffect, useState } from "react"
import "./App.css"

export default function App() {
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch("http://localhost:8000/api/rides/")
      .then((res) => {
        if (!res.ok) throw new Error("שגיאה בטעינת הנתונים")
        return res.json()
      })
      .then((data) => setRides(Array.isArray(data) ? data : []))
      .catch((err) => {
        setRides([])
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="app">
      <h1>STRANSPORT</h1>
      <p style={{ textAlign: "center", fontSize: "0.85rem", color: "#94a3b8", marginTop: "-16px", marginBottom: "24px" }}>
        דף React (Vite) — אם אתה רואה את זה, הפרונט נטען
      </p>
      {loading && <p className="app-loading">טוען נסיעות...</p>}
      {error && <p className="app-error">{error}</p>}
      {!loading && !error && rides.length === 0 && (
        <p className="app-empty">אין נסיעות להצגה</p>
      )}
      {!loading && rides.length > 0 && (
        <ul className="rides-list">
          {rides.map((r) => (
            <li key={r.id} className="ride-card">
              <span className="route">
                {r.from}
                <span className="arrow">→</span>
                {r.to}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
