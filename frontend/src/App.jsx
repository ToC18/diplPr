import React, { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { api, clearSession, getAccessToken, getRefreshToken, getSessionRole, setSession } from './api'

const REFRESH_MS = 15000
const TREND_EVENTS_LIMIT = 1000
const STATUS_COLORS = {
  RUN: '#58d39b',
  STOP: '#ff8f8f',
  ALARM: '#ff5da2',
  OFFLINE: '#94a8c0',
  IDLE: '#ffd98f'
}

function statusTone(status) {
  return `status ${String(status || '').toLowerCase()}`
}

function normalizeTs(ts) {
  if (!ts || typeof ts !== 'string') return ts
  const hasZone = /([zZ]|[+-]\d\d:\d\d)$/.test(ts)
  const normalized = ts.includes(' ') ? ts.replace(' ', 'T') : ts
  return hasZone ? normalized : `${normalized}Z`
}

function formatTs(ts) {
  if (!ts) return '—'
  const d = new Date(normalizeTs(ts))
  if (Number.isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('ru-RU')
}

function durationMinutes(startTs, endTs) {
  if (!startTs || !endTs) return '—'
  const s = new Date(normalizeTs(startTs)).getTime()
  const e = new Date(normalizeTs(endTs)).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return '—'
  return `${Math.max(0, Math.round((e - s) / 60000))}м`
}

function StatusDonut({ distribution = [] }) {
  const total = distribution.reduce((acc, row) => acc + Number(row.count || 0), 0) || 1
  let acc = 0
  const slices = distribution.map((row) => {
    const value = Number(row.count || 0)
    const start = (acc / total) * 360
    acc += value
    const end = (acc / total) * 360
    return { status: row.status, value, start, end, color: STATUS_COLORS[row.status] || '#49c5ff' }
  })
  return (
    <div className="chart-card">
      <h3>Распределение статусов</h3>
      <div className="donut-wrap">
        <svg viewBox="-1 -1 2 2" className="donut">
          {slices.map((s) => {
            const large = s.end - s.start > 180 ? 1 : 0
            const a0 = (Math.PI / 180) * (s.start - 90)
            const a1 = (Math.PI / 180) * (s.end - 90)
            const x0 = Math.cos(a0)
            const y0 = Math.sin(a0)
            const x1 = Math.cos(a1)
            const y1 = Math.sin(a1)
            const d = `M 0 0 L ${x0} ${y0} A 1 1 0 ${large} 1 ${x1} ${y1} Z`
            return <path key={s.status} d={d} fill={s.color} opacity="0.9" />
          })}
          <circle r="0.52" fill="#111922" />
        </svg>
        <div className="donut-center">{total}</div>
      </div>
      <div className="legend">
        {slices.map((s) => <div key={s.status}><span style={{ background: s.color }} />{s.status}: {s.value}</div>)}
      </div>
    </div>
  )
}

function DowntimeBars({ downtime = [] }) {
  const grouped = downtime.reduce((acc, row) => {
    const mins = row.start_ts && row.end_ts ? Math.max(0, Math.round((new Date(normalizeTs(row.end_ts)) - new Date(normalizeTs(row.start_ts))) / 60000)) : 0
    acc[row.equipment_id] = (acc[row.equipment_id] || 0) + mins
    return acc
  }, {})
  const rows = Object.entries(grouped).map(([id, mins]) => ({ id, mins })).sort((a, b) => b.mins - a.mins).slice(0, 8)
  const max = rows[0]?.mins || 1
  return (
    <div className="chart-card">
      <h3>Топ простоев (мин)</h3>
      <div className="bars">
        {rows.map((r) => (
          <div key={r.id} className="bar-row">
            <div className="bar-label">{r.id}</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(4, (r.mins / max) * 100)}%` }} /></div>
            <div className="bar-val">{r.mins}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EventTrend({ events = [] }) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({ i, c: 0 }))
  const now = Date.now()
  const span = 10 * 60 * 1000
  events.forEach((e) => {
    const t = new Date(normalizeTs(e.ts)).getTime()
    if (!Number.isFinite(t) || t < now - span || t > now) return
    const idx = Math.min(9, Math.floor(((t - (now - span)) / span) * 10))
    buckets[idx].c += 1
  })
  const max = Math.max(1, ...buckets.map((b) => b.c))
  const xMin = 3
  const xMax = 97
  const yMin = 8
  const yMax = 96
  const points = buckets
    .map((b, i) => {
      const x = xMin + (i / 9) * (xMax - xMin)
      const y = yMax - (b.c / max) * (yMax - yMin)
      return `${x},${y}`
    })
    .join(' ')
  return (
    <div className="chart-card">
      <h3>Тренд событий (10 мин)</h3>
      <svg viewBox="0 0 100 100" className="trend">
        <polyline fill="none" stroke="#49c5ff" strokeWidth="2.4" points={points} />
      </svg>
      <div className="trend-buckets">
        {buckets.map((b, i) => <span key={i}>{b.c}</span>)}
      </div>
    </div>
  )
}

function Protected({ children }) {
  return getAccessToken() ? children : <Navigate to="/login" replace />
}

function RoleProtected({ role, children }) {
  return getSessionRole() === role ? children : <Navigate to="/overview" replace />
}

function LoginPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: 'admin', password: 'admin' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.login(form)
      setSession(res.access_token || '', res.refresh_token || '', res.role || 'operator')
      navigate('/overview', { replace: true })
    } catch (err) {
      setError(`Ошибка входа: ${String(err.message || err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Авторизация</h1>
        <p>АС мониторинга простоев оборудования</p>
        <label>Логин<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
        <label>Пароль<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {error && <div className="banner error">{error}</div>}
        <button className="primary" type="submit" disabled={loading}>{loading ? 'Вход...' : 'Войти'}</button>
        <div className="sub">Нет аккаунта? <Link to="/register">Регистрация</Link></div>
      </form>
    </div>
  )
}

function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '', role: 'operator' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.register(form)
      const res = await api.login({ username: form.username, password: form.password })
      setSession(res.access_token || '', res.refresh_token || '', res.role || form.role || 'operator')
      navigate('/overview', { replace: true })
    } catch (err) {
      setError(`Ошибка регистрации: ${String(err.message || err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Регистрация</h1>
        <p>Создание пользователя</p>
        <label>Логин<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
        <label>Пароль<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <label>Роль
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </label>
        {error && <div className="banner error">{error}</div>}
        <button className="primary" type="submit" disabled={loading}>{loading ? 'Создание...' : 'Зарегистрироваться'}</button>
        <div className="sub">Есть аккаунт? <Link to="/login">Вход</Link></div>
      </form>
    </div>
  )
}

function useDashboardData() {
  const [summary, setSummary] = useState({ total_events: 0, total_equipment: 0, open_intervals: 0 })
  const [equipment, setEquipment] = useState([])
  const [events, setEvents] = useState([])
  const [downtime, setDowntime] = useState([])
  const [reports, setReports] = useState([])
  const [statusDistribution, setStatusDistribution] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const [sm, eq, ev, dt, rp, sd] = await Promise.all([
          api.getSummary(),
          api.getEquipment(),
          api.getEvents(`?limit=${TREND_EVENTS_LIMIT}`),
          api.getDowntime('?limit=200'),
          api.getReports(),
          api.getStatusDistribution()
        ])
        if (!mounted) return
        setSummary(sm)
        setEquipment(eq)
        setEvents(ev)
        setDowntime(dt)
        setReports(rp)
        setStatusDistribution(sd)
        setError('')
      } catch (err) {
        if (mounted) setError(`Ошибка загрузки: ${String(err.message || err)}`)
      }
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let closed = false
    const es = new EventSource(`/reports/events/stream?limit=${TREND_EVENTS_LIMIT}`)
    es.addEventListener('events', (evt) => {
      if (closed) return
      try {
        const rows = JSON.parse(evt.data)
        if (Array.isArray(rows)) setEvents(rows)
      } catch {
      }
    })
    es.addEventListener('error', () => {
      es.close()
    })
    return () => {
      closed = true
      es.close()
    }
  }, [])

  return { summary, equipment, events, downtime, reports, statusDistribution, error }
}

function AppLayout() {
  const navigate = useNavigate()
  const data = useDashboardData()

  const alarmsCount = useMemo(() => {
    const row = (data.statusDistribution || []).find((x) => x.status === 'ALARM')
    return row?.count ?? 0
  }, [data.statusDistribution])

  const logout = async () => {
    const refresh = getRefreshToken()
    try {
      if (refresh) await api.logout({ refresh_token: refresh })
    } catch {
    }
    clearSession()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand-title">Мониторинг простоев</div>
        <nav className="nav">
          <NavLink to="/overview" className="nav-item">Обзор</NavLink>
          <NavLink to="/equipment" className="nav-item">Оборудование</NavLink>
          <NavLink to="/events" className="nav-item">События</NavLink>
          <NavLink to="/downtime" className="nav-item">Простои</NavLink>
          <NavLink to="/reports" className="nav-item">Отчеты</NavLink>
          {getSessionRole() === 'admin' && <NavLink to="/admin" className="nav-item">Админ</NavLink>}
        </nav>
        <button className="ghost" onClick={logout}>Выйти</button>
      </aside>

      <main className="main">
        {data.error && <div className="banner error">{data.error}</div>}
        <Routes>
          <Route path="/overview" element={<OverviewPage data={data} alarmsCount={alarmsCount} />} />
          <Route path="/equipment" element={<EquipmentPage data={data} />} />
          <Route path="/events" element={<EventsPage data={data} />} />
          <Route path="/downtime" element={<DowntimePage data={data} />} />
          <Route path="/reports" element={<ReportsPage data={data} alarmsCount={alarmsCount} />} />
          <Route path="/admin" element={<RoleProtected role="admin"><AdminPage /></RoleProtected>} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function OverviewPage({ data, alarmsCount }) {
  return (
    <section className="table-card">
      <h2>Обзор</h2>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">Всего событий</div><div className="kpi-value">{data.summary.total_events}</div></div>
        <div className="kpi-card"><div className="kpi-label">Оборудование</div><div className="kpi-value">{data.summary.total_equipment}</div></div>
        <div className="kpi-card"><div className="kpi-label">Открытые интервалы</div><div className="kpi-value">{data.summary.open_intervals}</div></div>
        <div className="kpi-card"><div className="kpi-label">Аварии</div><div className="kpi-value">{alarmsCount}</div></div>
      </div>
      <div className="charts-grid">
        <StatusDonut distribution={data.statusDistribution} />
        <EventTrend events={data.events} />
      </div>
    </section>
  )
}

function EquipmentPage({ data }) {
  return (
    <section className="table-card">
      <h2>Оборудование</h2>
      <table>
        <thead><tr><th>ID</th><th>Имя</th><th>Тип</th><th>Протокол</th></tr></thead>
        <tbody>
          {data.equipment.map((x) => <tr key={x.equipment_id}><td>{x.equipment_id}</td><td>{x.name}</td><td>{x.type}</td><td>{x.protocol}</td></tr>)}
        </tbody>
      </table>
    </section>
  )
}

function EventsPage({ data }) {
  return (
    <section className="table-card">
      <h2>{`События (limit=${TREND_EVENTS_LIMIT})`}</h2>
      <table>
        <thead><tr><th>Оборудование</th><th>Статус</th><th>Время</th></tr></thead>
        <tbody>
          {data.events.map((x) => <tr key={`${x.equipment_id}-${x.ts}-${x.status}`}><td>{x.equipment_id}</td><td><span className={statusTone(x.status)}>{x.status}</span></td><td>{formatTs(x.ts)}</td></tr>)}
        </tbody>
      </table>
    </section>
  )
}

function DowntimePage({ data }) {
  return (
    <section className="table-card">
      <h2>Простои</h2>
      <DowntimeBars downtime={data.downtime} />
      <table>
        <thead><tr><th>Оборудование</th><th>Статус</th><th>Начало</th><th>Конец</th><th>Длительность</th></tr></thead>
        <tbody>
          {data.downtime.map((x) => <tr key={`${x.equipment_id}-${x.start_ts}-${x.status}`}><td>{x.equipment_id}</td><td><span className={statusTone(x.status)}>{x.status}</span></td><td>{formatTs(x.start_ts)}</td><td>{formatTs(x.end_ts)}</td><td>{durationMinutes(x.start_ts, x.end_ts)}</td></tr>)}
        </tbody>
      </table>
    </section>
  )
}

function ReportsPage({ data, alarmsCount }) {
  return (
    <section className="table-card">
      <h2>Отчеты</h2>
      <p className="sub">Аварии по распределению статусов: {alarmsCount}</p>
      <div className="charts-grid">
        <StatusDonut distribution={data.statusDistribution} />
        <DowntimeBars downtime={data.downtime} />
      </div>
      <div className="grid-cards">
        {data.reports.map((x) => (
          <article key={x.equipment_id} className="report-card">
            <div className="equip-title">{x.name || x.equipment_id}</div>
            <div className="sub">{x.equipment_id} · {x.type} · {x.protocol}</div>
          </article>
        ))}
      </div>
    </section>
  )
}

function AdminPage() {
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [roleForm, setRoleForm] = useState({ name: '', description: '' })
  const [equipmentForm, setEquipmentForm] = useState({
    equipment_id: '',
    name: '',
    type: 'poll',
    protocol: 'modbus',
    endpoint_host: '127.0.0.1',
    endpoint_port: 502,
    endpoint_topic: '',
    poll_interval_sec: 2,
    timeout_sec: 60
  })

  const loadAdminData = async () => {
    try {
      const [u, r] = await Promise.all([api.listUsers(), api.listRoles()])
      setUsers(Array.isArray(u) ? u : [])
      setRoles(Array.isArray(r) ? r : [])
      setError('')
    } catch (e) {
      setError(`Ошибка загрузки админ-данных: ${String(e.message || e)}`)
    }
  }

  useEffect(() => {
    loadAdminData()
  }, [])

  const createRole = async (e) => {
    e.preventDefault()
    try {
      await api.createRole(roleForm)
      setNotice(`Роль создана: ${roleForm.name}`)
      setRoleForm({ name: '', description: '' })
      await loadAdminData()
    } catch (err) {
      setError(`Ошибка создания роли: ${String(err.message || err)}`)
    }
  }

  const createEquipment = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        equipment_id: equipmentForm.equipment_id.trim(),
        name: equipmentForm.name.trim(),
        type: equipmentForm.type,
        protocol: equipmentForm.type === 'push' ? 'mqtt' : equipmentForm.protocol,
        endpoint: equipmentForm.type === 'push'
          ? { host: equipmentForm.endpoint_host.trim(), port: Number(equipmentForm.endpoint_port), topic: equipmentForm.endpoint_topic.trim() }
          : { host: equipmentForm.endpoint_host.trim(), port: Number(equipmentForm.endpoint_port) },
        poll_interval_sec: equipmentForm.type === 'poll' ? Number(equipmentForm.poll_interval_sec) : null,
        timeout_sec: Math.max(60, Math.min(3600, Number(equipmentForm.timeout_sec) || 60)),
        mapping: { status_map: { 0: 'STOP', 1: 'RUN', 2: 'ALARM' } }
      }
      await api.createEquipment(payload)
      setNotice(`Оборудование создано: ${payload.equipment_id}`)
      setEquipmentForm({
        equipment_id: '',
        name: '',
        type: 'poll',
        protocol: 'modbus',
        endpoint_host: '127.0.0.1',
        endpoint_port: 502,
        endpoint_topic: '',
        poll_interval_sec: 2,
        timeout_sec: 60
      })
    } catch (err) {
      setError(`Ошибка добавления оборудования: ${String(err.message || err)}`)
    }
  }

  return (
    <section className="table-card">
      <h2>Администрирование</h2>
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner">{notice}</div>}
      <div className="btn-row">
        <button className="ghost" onClick={() => window.open('/admin/', '_blank')}>Django Admin</button>
        <button className="ghost" onClick={() => window.open('http://localhost:1880', '_blank')}>Node-RED</button>
      </div>
      <div className="charts-grid" style={{ marginTop: 14 }}>
        <form className="chart-card" onSubmit={createEquipment}>
          <h3>Добавить оборудование</h3>
          <label>ID<input value={equipmentForm.equipment_id} onChange={(e) => setEquipmentForm({ ...equipmentForm, equipment_id: e.target.value })} /></label>
          <label>Имя<input value={equipmentForm.name} onChange={(e) => setEquipmentForm({ ...equipmentForm, name: e.target.value })} /></label>
          <label>Тип
            <select value={equipmentForm.type} onChange={(e) => setEquipmentForm({ ...equipmentForm, type: e.target.value })}>
              <option value="poll">poll</option>
              <option value="push">push</option>
            </select>
          </label>
          {equipmentForm.type === 'poll' && (
            <label>Протокол
              <select value={equipmentForm.protocol} onChange={(e) => setEquipmentForm({ ...equipmentForm, protocol: e.target.value })}>
                <option value="modbus">modbus</option>
                <option value="opcua">opcua</option>
              </select>
            </label>
          )}
          <label>Host<input value={equipmentForm.endpoint_host} onChange={(e) => setEquipmentForm({ ...equipmentForm, endpoint_host: e.target.value })} /></label>
          <label>Port<input type="number" value={equipmentForm.endpoint_port} onChange={(e) => setEquipmentForm({ ...equipmentForm, endpoint_port: Number(e.target.value) })} /></label>
          {equipmentForm.type === 'push' && <label>Topic<input value={equipmentForm.endpoint_topic} onChange={(e) => setEquipmentForm({ ...equipmentForm, endpoint_topic: e.target.value })} /></label>}
          {equipmentForm.type === 'poll' && <label>poll_interval_sec<input type="number" value={equipmentForm.poll_interval_sec} onChange={(e) => setEquipmentForm({ ...equipmentForm, poll_interval_sec: Number(e.target.value) })} /></label>}
          <label>timeout_sec<input type="number" value={equipmentForm.timeout_sec} onChange={(e) => setEquipmentForm({ ...equipmentForm, timeout_sec: Number(e.target.value) })} /></label>
          <button className="primary" type="submit">Добавить</button>
        </form>

        <form className="chart-card" onSubmit={createRole}>
          <h3>Создать роль</h3>
          <label>Название<input value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} /></label>
          <label>Описание<input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} /></label>
          <button className="primary" type="submit">Создать роль</button>
          <div className="sub" style={{ marginTop: 8 }}>Роли: {roles.map((r) => r.name).join(', ') || '—'}</div>
        </form>
      </div>

      <div className="chart-card" style={{ marginTop: 14 }}>
        <h3>Пользователи (admin)</h3>
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Created</th></tr></thead>
          <tbody>
            {users.map((u) => <tr key={u.username}><td>{u.username}</td><td>{u.role}</td><td>{formatTs(u.created_at)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/*" element={<Protected><AppLayout /></Protected>} />
    </Routes>
  )
}
