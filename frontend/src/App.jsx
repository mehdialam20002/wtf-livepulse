import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "http://localhost:3001/api";
const WS_URL = "ws://localhost:3001";
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function currency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function occupancyTone(percent) {
  if (percent >= 85) return "critical";
  if (percent >= 60) return "warning";
  return "healthy";
}

function useApi(url, fallback) {
  const [state, setState] = useState({ loading: true, error: "", data: fallback });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        const data = await response.json();
        if (!cancelled) setState({ loading: false, error: "", data });
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error.message, data: fallback });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}

function Heatmap({ data }) {
  const max = Math.max(...data.map((item) => item.checkin_count), 1);

  return (
    <div className="heatmap">
      {dayNames.map((day, dayIndex) => (
        <div key={day} className="heatmap-row">
          <span className="day-label">{day}</span>
          <div className="heatmap-cells">
            {Array.from({ length: 24 }, (_, hour) => {
              const entry = data.find(
                (item) => item.day_of_week === dayIndex && item.hour_of_day === hour,
              );
              const count = entry?.checkin_count || 0;
              return (
                <div
                  key={`${day}-${hour}`}
                  className="heat-cell"
                  style={{ background: `rgba(0, 224, 194, ${count ? 0.18 + count / max / 1.3 : 0.08})` }}
                >
                  {count}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function App() {
  const gymsState = useApi(`${API_BASE}/gyms`, { gyms: [], summary: {} });
  const crossGymState = useApi(`${API_BASE}/analytics/cross-gym`, []);
  const [selectedGymId, setSelectedGymId] = useState("");
  const [dateRange, setDateRange] = useState("30d");
  const [liveData, setLiveData] = useState(null);
  const [panelError, setPanelError] = useState("");
  const [analytics, setAnalytics] = useState({
    heatmap: [],
    revenueByPlan: [],
    churnRisk: [],
    newVsRenewal: { new: 0, renewal: 0 },
  });
  const [anomalies, setAnomalies] = useState([]);
  const [summary, setSummary] = useState({});
  const [activityFeed, setActivityFeed] = useState([]);
  const [simulator, setSimulator] = useState({ running: true, speed: 1 });
  const [wsConnected, setWsConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const feedRef = useRef(null);

  useEffect(() => {
    if (!selectedGymId && gymsState.data.gyms.length > 0) {
      setSelectedGymId(gymsState.data.gyms[0].id);
      setSummary(gymsState.data.summary || {});
      setSimulator(gymsState.data.summary?.simulator || { running: true, speed: 1 });
    }
  }, [gymsState.data, selectedGymId]);

  useEffect(() => {
    if (!selectedGymId) return;

    let cancelled = false;

    async function load() {
      setPanelError("");
      const [liveResponse, analyticsResponse, anomaliesResponse] = await Promise.all([
        fetch(`${API_BASE}/gyms/${selectedGymId}/live`),
        fetch(`${API_BASE}/gyms/${selectedGymId}/analytics?dateRange=${dateRange}`),
        fetch(`${API_BASE}/anomalies?gym_id=${selectedGymId}`),
      ]);

      if (!liveResponse.ok || !analyticsResponse.ok || !anomaliesResponse.ok) {
        throw new Error("Failed to load dashboard data");
      }

      const [liveJson, analyticsJson, anomaliesJson] = await Promise.all([
        liveResponse.json(),
        analyticsResponse.json(),
        anomaliesResponse.json(),
      ]);

      if (!cancelled) {
        setLiveData(liveJson);
        setAnalytics(analyticsJson);
        setAnomalies(anomaliesJson);
        setActivityFeed(liveJson.recent_events || []);
      }
    }

    load().catch((error) => {
      console.error(error);
      if (!cancelled) {
        setPanelError(error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedGymId, dateRange]);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);

    socket.addEventListener("open", () => setWsConnected(true));
    socket.addEventListener("close", () => setWsConnected(false));
    socket.addEventListener("message", (message) => {
      const event = JSON.parse(message.data);

      if (event.type === "CHECKIN_EVENT" || event.type === "CHECKOUT_EVENT" || event.type === "PAYMENT_EVENT") {
        setActivityFeed((current) => [
          {
            event_type: event.type.replace("_EVENT", "").toLowerCase(),
            member_name: event.member_name,
            event_timestamp: event.timestamp,
          },
          ...current,
        ].slice(0, 20));
      }

      if ((event.type === "CHECKIN_EVENT" || event.type === "CHECKOUT_EVENT") && selectedGymId === event.gym_id) {
        setLiveData((current) =>
          current
            ? {
                ...current,
                current_occupancy: event.current_occupancy,
                capacity_pct: event.capacity_pct,
              }
            : current,
        );
      }

      if (event.type === "PAYMENT_EVENT") {
        setSummary((current) => ({
          ...current,
          totalRevenueToday: Number(current.totalRevenueToday || 0) + Number(event.amount || 0),
        }));

        if (selectedGymId === event.gym_id) {
          setLiveData((current) =>
            current ? { ...current, today_revenue: event.today_total } : current,
          );
        }
      }

      if (event.type === "ANOMALY_DETECTED") {
        setSummary((current) => ({
          ...current,
          activeAnomalies: Number(event.unread_count ?? (current.activeAnomalies || 0)),
        }));
        setToasts((current) => [
          {
            id: `${event.anomaly_id}-detected`,
            title: `${event.severity.toUpperCase()} alert`,
            message: event.message,
          },
          ...current,
        ].slice(0, 4));
      }

      if (event.type === "ANOMALY_RESOLVED") {
        setSummary((current) => ({
          ...current,
          activeAnomalies: Number(event.unread_count ?? (current.activeAnomalies || 0)),
        }));
        setAnomalies((current) =>
          current.map((item) =>
            item.id === event.anomaly_id
              ? { ...item, resolved: true, resolved_at: event.resolved_at }
              : item,
          ),
        );
        setToasts((current) => [
          {
            id: `${event.anomaly_id}-resolved`,
            title: "Alert resolved",
            message: "An anomaly condition recovered and is marked resolved.",
          },
          ...current,
        ].slice(0, 4));
      }

      if (event.type === "CHECKIN_EVENT") {
        setSummary((current) => ({
          ...current,
          totalCheckedIn: Number(current.totalCheckedIn || 0) + 1,
        }));
      }

      if (event.type === "CHECKOUT_EVENT") {
        setSummary((current) => ({
          ...current,
          totalCheckedIn: Math.max(Number(current.totalCheckedIn || 0) - 1, 0),
        }));
      }
    });

    return () => socket.close();
  }, [selectedGymId]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [activityFeed]);

  useEffect(() => {
    if (toasts.length === 0) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setToasts((current) => current.slice(1));
    }, 3500);

    return () => clearTimeout(timer);
  }, [toasts]);

  const selectedGym = useMemo(
    () => gymsState.data.gyms.find((gym) => gym.id === selectedGymId),
    [gymsState.data.gyms, selectedGymId],
  );

  const ratioTotal = Number(analytics.newVsRenewal?.new || 0) + Number(analytics.newVsRenewal?.renewal || 0);
  const donutAngle = ratioTotal ? (Number(analytics.newVsRenewal.new || 0) / ratioTotal) * 360 : 0;

  async function simulatorAction(path, body) {
    const response = await fetch(`${API_BASE}/simulator/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    setSimulator((current) => ({ ...current, ...json }));
  }

  async function dismissWarning(id) {
    const confirmed = window.confirm("Dismiss this warning anomaly?");

    if (!confirmed) {
      return;
    }

    const response = await fetch(`${API_BASE}/anomalies/${id}/dismiss`, {
      method: "PATCH",
    });

    if (!response.ok) {
      return;
    }

    setAnomalies((current) => current.filter((item) => item.id !== id));
    setSummary((current) => ({
      ...current,
      activeAnomalies: Math.max(Number(current.activeAnomalies || 0) - 1, 0),
    }));
  }

  return (
    <div className="shell">
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div className="toast-card" key={toast.id}>
            <strong>{toast.title}</strong>
            <p>{toast.message}</p>
          </div>
        ))}
      </div>
      <header className="topbar">
        <div>
          <p className="eyebrow">WTF LivePulse</p>
          <h1>Real-Time Multi-Gym Intelligence Engine</h1>
        </div>

        <div className="toolbar">
          <label className="select-wrap">
            <span>Gym</span>
            <select value={selectedGymId} onChange={(event) => setSelectedGymId(event.target.value)}>
              {gymsState.data.gyms.map((gym) => (
                <option key={gym.id} value={gym.id}>
                  {gym.name}
                </option>
              ))}
            </select>
          </label>

          <label className="select-wrap">
            <span>Date Range</span>
            <select value={dateRange} onChange={(event) => setDateRange(event.target.value)}>
              <option value="7d">7 Days</option>
              <option value="30d">30 Days</option>
              <option value="90d">90 Days</option>
            </select>
          </label>
        </div>
      </header>

      <section className="summary-grid">
        <article className="summary-card">
          <span className="label">All Gyms Checked In</span>
          <strong>{summary.totalCheckedIn || 0}</strong>
        </article>
        <article className="summary-card">
          <span className="label">Today Revenue</span>
          <strong>{currency(summary.totalRevenueToday || 0)}</strong>
        </article>
        <article className="summary-card">
          <span className="label">Unread Alerts</span>
          <strong>{summary.activeAnomalies || 0}</strong>
        </article>
        <article className="summary-card">
          <span className="label">WebSocket</span>
          <strong><span className={`dot ${wsConnected ? "online" : "offline"}`} />{wsConnected ? "Live" : "Offline"}</strong>
        </article>
      </section>

      <main className="dashboard">
        <section className="column">
          <div className="panel hero-panel">
            <div>
              <p className="eyebrow">Selected Gym</p>
              <h2>{selectedGym?.name || "Loading..."}</h2>
              <p className="muted">{selectedGym?.city || "Fetching city"} - capacity {selectedGym?.capacity || 0}</p>
            </div>
            <div className={`occupancy-chip ${occupancyTone(liveData?.capacity_pct || 0)}`}>
              {liveData?.capacity_pct || 0}% occupied
            </div>
          </div>

          {panelError ? <div className="panel error-panel">{panelError}</div> : null}

          <div className="kpi-grid">
            <article className="panel kpi-card">
              <span className="label">Live Occupancy</span>
              <strong>{liveData?.current_occupancy || 0}</strong>
              <p className="muted">Members currently checked in</p>
            </article>
            <article className="panel kpi-card">
              <span className="label">Revenue Today</span>
              <strong>{currency(liveData?.today_revenue || 0)}</strong>
              <p className="muted">Streaming collections</p>
            </article>
            <article className="panel kpi-card">
              <span className="label">Operating Window</span>
              <strong>{selectedGym?.opens_at?.slice(0, 5)} - {selectedGym?.closes_at?.slice(0, 5)}</strong>
              <p className="muted">Used by anomaly engine</p>
            </article>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Analytics</p>
                <h3>7-Day Peak Hours Heatmap</h3>
              </div>
            </div>
            <Heatmap data={analytics.heatmap || []} />
          </div>

          <div className="analytics-grid">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Revenue Mix</p>
                  <h3>Plan Type Breakdown</h3>
                </div>
              </div>
              <div className="bars">
                {(analytics.revenueByPlan || []).map((item) => (
                  <div className="bar-row" key={item.plan_type}>
                    <span>{item.plan_type}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${Math.max(
                            12,
                            (item.revenue / Math.max(...(analytics.revenueByPlan || []).map((entry) => entry.revenue), 1)) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <strong>{currency(item.revenue)}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Member Lifecycle</p>
                  <h3>New vs Renewal Ratio</h3>
                </div>
              </div>
              <div className="ratio-card">
                <div className="donut" style={{ background: `conic-gradient(#00e0c2 0deg ${donutAngle}deg, #f97316 ${donutAngle}deg 360deg)` }}>
                  <div className="donut-hole">
                    <strong>{ratioTotal}</strong>
                    <span>sales</span>
                  </div>
                </div>
                <div className="legend">
                  <p><span className="legend-dot teal" />New: {analytics.newVsRenewal?.new || 0}</p>
                  <p><span className="legend-dot orange" />Renewal: {analytics.newVsRenewal?.renewal || 0}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Retention Risk</p>
                <h3>Churn Candidates</h3>
              </div>
            </div>
            <div className="table">
              {(analytics.churnRisk || []).map((member) => (
                <div className="table-row" key={member.id}>
                  <span>{member.name}</span>
                  <span>{new Date(member.last_checkin_at).toLocaleDateString()}</span>
                  <strong className={member.risk_level === "critical" ? "critical-text" : "warning-text"}>
                    {member.risk_level}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Network Ranking</p>
                <h3>Cross-Gym Revenue</h3>
              </div>
            </div>
            <div className="bars">
              {crossGymState.data.map((gym) => (
                <div className="bar-row" key={gym.gym_id}>
                  <span>#{gym.rank} {gym.gym_name}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill orange-fill"
                      style={{
                        width: `${Math.max(
                          12,
                          (gym.total_revenue / Math.max(...crossGymState.data.map((entry) => entry.total_revenue), 1)) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                  <strong>{currency(gym.total_revenue)}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="column">
          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Simulator</p>
                <h3>Live Controls</h3>
              </div>
            </div>
            <div className="simulator-controls">
              <button onClick={() => simulatorAction(simulator.running ? "stop" : "start", simulator.running ? undefined : { speed: simulator.speed || 1 })}>
                {simulator.running ? "Pause" : "Start"}
              </button>
              <select value={simulator.speed || 1} onChange={(event) => simulatorAction("start", { speed: Number(event.target.value) })}>
                <option value={1}>1x</option>
                <option value={5}>5x</option>
                <option value={10}>10x</option>
              </select>
              <button className="ghost" onClick={() => simulatorAction("reset")}>Reset</button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Real-Time Feed</p>
                <h3>Last 20 Events</h3>
              </div>
            </div>
            <div className="activity-feed" ref={feedRef}>
              {activityFeed.map((item, index) => (
                <div className="activity-item" key={`${item.event_timestamp}-${index}`}>
                  <strong>{item.event_type}</strong>
                  <p>{item.member_name}</p>
                  <span>{new Date(item.event_timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Anomaly Engine</p>
                <h3>Active Alerts</h3>
              </div>
            </div>
            <div className="anomaly-list">
              {anomalies.map((anomaly) => (
                <div key={anomaly.id} className={`anomaly-card ${anomaly.severity} ${anomaly.resolved ? "resolved" : ""}`}>
                  <div className="anomaly-head">
                    <strong>{String(anomaly.type).replaceAll("_", " ")}</strong>
                    <span>{anomaly.resolved ? "resolved" : anomaly.severity}</span>
                  </div>
                  <p>{anomaly.message}</p>
                  {anomaly.resolved ? (
                    <p className="muted">Resolved at {new Date(anomaly.resolved_at).toLocaleString()}</p>
                  ) : anomaly.severity === "warning" ? (
                    <button className="ghost dismiss-btn" onClick={() => dismissWarning(anomaly.id)}>
                      Dismiss
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
