import React, { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { api, clearSession, getAccessToken, getRefreshToken, getSessionRole, setSession } from './api'

const REFRESH_MS = 15000
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

function toDayKey(ts) {
  if (!ts) return ''
  const d = new Date(normalizeTs(ts))
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getTodayKey() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
    const startMs = row.start_ts ? new Date(normalizeTs(row.start_ts)).getTime() : NaN
    const endMs = row.end_ts ? new Date(normalizeTs(row.end_ts)).getTime() : Date.now()
    const mins = Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, Math.round((endMs - startMs) / 60000))
      : 0
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

function EquipmentStateTable({ rows = [] }) {
  return (
    <div className="chart-card">
      <h3>Состояния оборудования (текущее)</h3>
      <table>
        <thead><tr><th>Оборудование</th><th>Статус</th><th>Время</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={`${x.equipment_id}-${x.last_ts}`}>
              <td>{x.equipment_id}</td>
              <td><span className={statusTone(x.last_status)}>{x.last_status}</span></td>
              <td>{formatTs(x.last_ts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CurrentDowntimeTable({ rows = [], onResolveManual = null }) {
  const [busyId, setBusyId] = useState('')

  const resolveManual = async (equipmentId) => {
    if (!onResolveManual) return
    setBusyId(equipmentId)
    try {
      await onResolveManual(equipmentId)
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="chart-card">
      <h3>Текущие простои</h3>
      <table>
        <thead><tr><th>Оборудование</th><th>Статус</th><th>Начало</th><th>Источник</th><th>Комментарий</th><th>Автор</th><th>Действие</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={`${x.equipment_id}-${x.start_ts}-${x.status}`}>
              <td>{x.equipment_id}</td>
              <td><span className={statusTone(x.status)}>{x.status}</span></td>
              <td>{formatTs(x.start_ts)}</td>
              <td>{x.source || 'auto'}</td>
              <td>{x.note || '—'}</td>
              <td>{x.created_by || '—'}</td>
              <td>
                {getSessionRole() === 'admin' && x.source === 'manual'
                  ? <button className="ghost" disabled={busyId === x.equipment_id} onClick={() => resolveManual(x.equipment_id)}>Перевести в RUN</button>
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EquipmentLiveTable({ rows = [] }) {
  return (
    <div className="chart-card">
      <h3>Живой сигнал оборудования</h3>
      <table>
        <thead><tr><th>Оборудование</th><th>Last seen</th><th>Возраст, сек</th><th>Состояние</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.equipment_id}>
              <td>{x.equipment_id}</td>
              <td>{formatTs(x.last_seen)}</td>
              <td>{x.age_sec ?? '—'}</td>
              <td><span className={statusTone(x.live === 'ONLINE' ? 'RUN' : x.live === 'STALE' ? 'OFFLINE' : 'IDLE')}>{x.live}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ManualDowntimeTable({ rows = [] }) {
  return (
    <div className="chart-card">
      <h3>Ручные простои (все)</h3>
      <table>
        <thead><tr><th>Оборудование</th><th>Статус</th><th>Начало</th><th>Конец</th><th>Длительность</th><th>Комментарий</th><th>Автор</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={`${x.equipment_id}-${x.start_ts}-${x.status}-${x.created_by || ''}`}>
              <td>{x.equipment_id}</td>
              <td><span className={statusTone(x.status)}>{x.status}</span></td>
              <td>{formatTs(x.start_ts)}</td>
              <td>{formatTs(x.end_ts)}</td>
              <td>{durationMinutes(x.start_ts, x.end_ts)}</td>
              <td>{x.note || '—'}</td>
              <td>{x.created_by || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DailyEventsBars({ events = [] }) {
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (6 - i))
    return {
      key: toDayKey(d.toISOString()),
      label: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      c: 0
    }
  })
  const indexByKey = new Map(buckets.map((b, i) => [b.key, i]))
  events.forEach((e) => {
    const key = toDayKey(e.ts)
    const idx = indexByKey.get(key)
    if (idx == null) return
    buckets[idx].c += 1
  })
  const max = Math.max(1, ...buckets.map((b) => b.c))
  return (
    <div className="chart-card">
      <h3>События по дням (7 дней)</h3>
      <div className="bars">
        {buckets.map((b) => (
          <div key={b.key} className="bar-row">
            <div className="bar-label">{b.label}</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(4, (b.c / max) * 100)}%` }} /></div>
            <div className="bar-val">{b.c}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EquipmentStateCard({ equipment = [], events = [], dayKey }) {
  const latestByEquipment = new Map()
  events.forEach((e) => {
    if (toDayKey(e.ts) !== dayKey) return
    const prev = latestByEquipment.get(e.equipment_id)
    const currTs = new Date(normalizeTs(e.ts)).getTime()
    const prevTs = prev ? new Date(normalizeTs(prev.ts)).getTime() : -1
    if (!prev || currTs > prevTs) latestByEquipment.set(e.equipment_id, e)
  })

  let running = 0
  let alarm = 0
  let stop = 0
  let offline = 0
  let unknown = 0

  equipment.forEach((eq) => {
    const row = latestByEquipment.get(eq.equipment_id)
    if (!row?.status) {
      unknown += 1
      return
    }
    if (row.status === 'RUN') running += 1
    else if (row.status === 'ALARM') alarm += 1
    else if (row.status === 'STOP') stop += 1
    else if (row.status === 'OFFLINE') offline += 1
    else unknown += 1
  })

  return (
    <div className="chart-card">
      <h3>Состояние оборудования за день</h3>
      <div className="legend">
        <div><span style={{ background: STATUS_COLORS.RUN }} />RUN: {running}</div>
        <div><span style={{ background: STATUS_COLORS.ALARM }} />ALARM: {alarm}</div>
        <div><span style={{ background: STATUS_COLORS.STOP }} />STOP: {stop}</div>
        <div><span style={{ background: STATUS_COLORS.OFFLINE }} />OFFLINE: {offline}</div>
        <div><span style={{ background: '#6f8199' }} />NO DATA: {unknown}</div>
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
  const [currentDowntime, setCurrentDowntime] = useState([])
  const [equipmentState, setEquipmentState] = useState([])
  const [equipmentLive, setEquipmentLive] = useState([])
  const [reports, setReports] = useState([])
  const [statusDistribution, setStatusDistribution] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const [sm, eq, ev, dt, rp, sd, cd, es, el] = await Promise.all([
          api.getSummary(),
          api.getEquipment(),
          api.getEvents(),
          api.getDowntime(),
          api.getReports(),
          api.getStatusDistribution(),
          api.getCurrentDowntime(),
          api.getEquipmentState(),
          api.getEquipmentLive(120)
        ])
        if (!mounted) return
        setSummary(sm)
        setEquipment(eq)
        setEvents(ev)
        setDowntime(dt)
        setCurrentDowntime(cd)
        setEquipmentState(es)
        setEquipmentLive(el)
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

  return { summary, equipment, events, downtime, currentDowntime, equipmentState, equipmentLive, reports, statusDistribution, error }
}

function AppLayout() {
  const navigate = useNavigate()
  const data = useDashboardData()
  const [selectedDay, setSelectedDay] = useState(getTodayKey())

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
        <div className="table-card" style={{ marginBottom: 14 }}>
          <label>
            Дата мониторинга
            <input type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value || getTodayKey())} />
          </label>
        </div>
        <Routes>
          <Route path="/overview" element={<OverviewPage data={data} alarmsCount={alarmsCount} selectedDay={selectedDay} />} />
          <Route path="/equipment" element={<EquipmentPage data={data} />} />
          <Route path="/events" element={<EventsPage data={data} selectedDay={selectedDay} />} />
          <Route path="/downtime" element={<DowntimePage data={data} selectedDay={selectedDay} />} />
          <Route path="/reports" element={<ReportsPage data={data} alarmsCount={alarmsCount} selectedDay={selectedDay} />} />
          <Route path="/admin" element={<RoleProtected role="admin"><AdminPage /></RoleProtected>} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function OverviewPage({ data, alarmsCount, selectedDay }) {
  const dayEvents = data.events.filter((x) => toDayKey(x.ts) === selectedDay)
  const dayDowntime = data.downtime.filter((x) => toDayKey(x.start_ts) === selectedDay || toDayKey(x.end_ts) === selectedDay)
  const downtimeMinutes = dayDowntime.reduce((acc, row) => {
    const s = new Date(normalizeTs(row.start_ts)).getTime()
    const e = row.end_ts ? new Date(normalizeTs(row.end_ts)).getTime() : Date.now()
    if (!Number.isFinite(s) || !Number.isFinite(e)) return acc
    return acc + Math.max(0, Math.round((e - s) / 60000))
  }, 0)
  const alarmsToday = dayEvents.filter((x) => x.status === 'ALARM').length
  const totalDowntimeMinutesAll = data.downtime.reduce((acc, row) => {
    const s = new Date(normalizeTs(row.start_ts)).getTime()
    const e = row.end_ts ? new Date(normalizeTs(row.end_ts)).getTime() : Date.now()
    if (!Number.isFinite(s) || !Number.isFinite(e)) return acc
    return acc + Math.max(0, Math.round((e - s) / 60000))
  }, 0)

  return (
    <section className="table-card">
      <h2>{`Обзор за ${selectedDay}`}</h2>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">События за день</div><div className="kpi-value">{dayEvents.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Оборудование</div><div className="kpi-value">{data.equipment.length || data.summary.total_equipment}</div></div>
        <div className="kpi-card"><div className="kpi-label">Простой за день, мин</div><div className="kpi-value">{downtimeMinutes}</div></div>
        <div className="kpi-card"><div className="kpi-label">Аварии за день</div><div className="kpi-value">{alarmsToday || alarmsCount}</div></div>
        <div className="kpi-card"><div className="kpi-label">Сумма простоев (все), мин</div><div className="kpi-value">{totalDowntimeMinutesAll}</div></div>
      </div>
      <div className="charts-grid">
        <StatusDonut distribution={data.statusDistribution} />
        <DailyEventsBars events={data.events} />
      </div>
      <div className="charts-grid">
        <EquipmentStateCard equipment={data.equipment} events={data.events} dayKey={selectedDay} />
        <DowntimeBars downtime={dayDowntime} />
      </div>
      <div className="charts-grid">
        <EquipmentStateTable rows={data.equipmentState} />
        <CurrentDowntimeTable rows={data.currentDowntime} />
      </div>
      <div className="charts-grid">
        <EquipmentLiveTable rows={data.equipmentLive} />
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
          {data.equipment.map((x) => (
            <tr key={x.equipment_id}>
              <td>{x.equipment_id}</td>
              <td>{x.name}</td>
              <td>{x.type}</td>
              <td>{x.protocol}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function EventsPage({ data, selectedDay }) {
  const dayEvents = data.events.filter((x) => toDayKey(x.ts) === selectedDay)
  return (
    <section className="table-card">
      <h2>{`События/интервалы за ${selectedDay}`}</h2>
      <table>
        <thead><tr><th>Оборудование</th><th>Статус</th><th>Начало</th><th>Конец</th><th>Простой, мин</th><th>Источник</th><th>Комментарий</th><th>Автор</th></tr></thead>
        <tbody>
          {dayEvents.map((x) => <tr key={`${x.equipment_id}-${x.start_ts}-${x.status}`}><td>{x.equipment_id}</td><td><span className={statusTone(x.status)}>{x.status}</span></td><td>{formatTs(x.start_ts)}</td><td>{formatTs(x.end_ts)}</td><td>{x.downtime_minutes ?? 0}</td><td>{x.source || 'auto'}</td><td>{x.note || '—'}</td><td>{x.created_by || '—'}</td></tr>)}
        </tbody>
      </table>
    </section>
  )
}

function DowntimePage({ data, selectedDay }) {
  const dayDowntime = data.downtime.filter((x) => toDayKey(x.start_ts) === selectedDay || toDayKey(x.end_ts) === selectedDay)
  const manualDowntime = data.downtime.filter((x) => x.source === 'manual')
  const [forceRunId, setForceRunId] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const resolveManual = async (equipmentId) => {
    await api.resolveManualDowntime({ equipment_id: equipmentId })
    window.location.reload()
  }
  const forceRun = async () => {
    if (!forceRunId) {
      setActionError('Выберите оборудование')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      await api.resolveManualDowntime({ equipment_id: forceRunId, note: 'forced RUN from downtime page' })
      window.location.reload()
    } catch (e) {
      setActionError(`Ошибка: ${String(e.message || e)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="table-card">
      <h2>{`Простои за ${selectedDay}`}</h2>
      <div className="chart-card">
        <h3>Принудительно перевести в RUN</h3>
        {actionError && <div className="banner error">{actionError}</div>}
        <div className="btn-row">
          <select value={forceRunId} onChange={(e) => setForceRunId(e.target.value)}>
            <option value="">Выберите оборудование</option>
            {data.equipment.map((eq) => (
              <option key={eq.equipment_id} value={eq.equipment_id}>{eq.equipment_id} - {eq.name}</option>
            ))}
          </select>
          <button className="ghost" disabled={busy} onClick={forceRun}>{busy ? 'Выполняю...' : 'Перевести в RUN'}</button>
        </div>
      </div>
      <CurrentDowntimeTable rows={data.currentDowntime} onResolveManual={resolveManual} />
      <ManualDowntimeTable rows={manualDowntime} />
      <DowntimeBars downtime={dayDowntime} />
      <table>
        <thead><tr><th>Оборудование</th><th>Статус</th><th>Начало</th><th>Конец</th><th>Длительность</th><th>Источник</th><th>Комментарий</th><th>Автор</th></tr></thead>
        <tbody>
          {dayDowntime.map((x) => <tr key={`${x.equipment_id}-${x.start_ts}-${x.status}`}><td>{x.equipment_id}</td><td><span className={statusTone(x.status)}>{x.status}</span></td><td>{formatTs(x.start_ts)}</td><td>{formatTs(x.end_ts)}</td><td>{durationMinutes(x.start_ts, x.end_ts)}</td><td>{x.source || 'auto'}</td><td>{x.note || '—'}</td><td>{x.created_by || '—'}</td></tr>)}
        </tbody>
      </table>
    </section>
  )
}

function ReportsPage({ data, alarmsCount, selectedDay }) {
  const dayDowntime = data.downtime.filter((x) => toDayKey(x.start_ts) === selectedDay || toDayKey(x.end_ts) === selectedDay)
  return (
    <section className="table-card">
      <h2>{`Отчеты за ${selectedDay}`}</h2>
      <p className="sub">Аварии по распределению статусов: {alarmsCount}</p>
      <div className="charts-grid">
        <StatusDonut distribution={data.statusDistribution} />
        <DowntimeBars downtime={dayDowntime} />
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
  const [equipmentList, setEquipmentList] = useState([])
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
  const [manualDowntimeForm, setManualDowntimeForm] = useState({
    equipment_id: '',
    status: 'STOP',
    start_ts: '',
    end_ts: '',
    note: ''
  })

  const loadAdminData = async () => {
    try {
      const [u, r, eq] = await Promise.all([api.listUsers(), api.listRoles(), api.getEquipment()])
      setUsers(Array.isArray(u) ? u : [])
      setRoles(Array.isArray(r) ? r : [])
      setEquipmentList(Array.isArray(eq) ? eq : [])
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

  const createManualDowntime = async (e) => {
    e.preventDefault()
    if (!manualDowntimeForm.equipment_id) {
      setError('Выберите оборудование для ручного простоя')
      return
    }
    try {
      const payload = {
        equipment_id: manualDowntimeForm.equipment_id.trim(),
        status: manualDowntimeForm.status,
        start_ts: manualDowntimeForm.start_ts,
        end_ts: manualDowntimeForm.end_ts || null,
        note: manualDowntimeForm.note.trim() || null
      }
      await api.createManualDowntime(payload)
      setNotice(`Ручной простой добавлен: ${payload.equipment_id}`)
      setManualDowntimeForm({ equipment_id: '', status: 'STOP', start_ts: '', end_ts: '', note: '' })
    } catch (err) {
      setError(`Ошибка добавления простоя: ${String(err.message || err)}`)
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
          {equipmentForm.type === 'push' && <div className="sub">Для `push` протокол фиксированный: mqtt.</div>}
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

      <div className="charts-grid" style={{ marginTop: 14 }}>
        <form className="chart-card" onSubmit={createManualDowntime}>
          <h3>Ручной простой (admin)</h3>
          <label>Оборудование
            <select value={manualDowntimeForm.equipment_id} onChange={(e) => setManualDowntimeForm({ ...manualDowntimeForm, equipment_id: e.target.value })}>
              <option value="">Выберите оборудование</option>
              {equipmentList.map((eq) => (
                <option key={eq.equipment_id} value={eq.equipment_id}>
                  {eq.equipment_id} - {eq.name}
                </option>
              ))}
            </select>
          </label>
          <label>Статус
            <select value={manualDowntimeForm.status} onChange={(e) => setManualDowntimeForm({ ...manualDowntimeForm, status: e.target.value })}>
              <option value="STOP">STOP</option>
              <option value="ALARM">ALARM</option>
              <option value="OFFLINE">OFFLINE</option>
              <option value="IDLE">IDLE</option>
            </select>
          </label>
          <label>Начало<input type="datetime-local" value={manualDowntimeForm.start_ts} onChange={(e) => setManualDowntimeForm({ ...manualDowntimeForm, start_ts: e.target.value })} /></label>
          <label>Конец (опционально)<input type="datetime-local" value={manualDowntimeForm.end_ts} onChange={(e) => setManualDowntimeForm({ ...manualDowntimeForm, end_ts: e.target.value })} /></label>
          <label>Комментарий<input value={manualDowntimeForm.note} onChange={(e) => setManualDowntimeForm({ ...manualDowntimeForm, note: e.target.value })} /></label>
          <button className="primary" type="submit">Добавить простой</button>
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
