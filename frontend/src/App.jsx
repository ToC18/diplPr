import React, { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, clearSession, getAccessToken, getRefreshToken, getSessionPermissions, getSessionRole, setSession } from './api'

const REFRESH_MS = 2000
const STATUS_COLORS = {
  RUN: '#58d39b',
  STOP: '#ffb66d',
  ALARM: '#ff4d8d',
  OFFLINE: '#94a8c0',
  IDLE: '#ffd98f'
}
const DOWNTIME_STATUSES = new Set(['STOP', 'ALARM', 'OFFLINE', 'IDLE'])

function statusTone(status) {
  return `status ${String(status || '').toLowerCase()}`
}

function hasPermission(permission) {
  const permissions = getSessionPermissions()
  if (getSessionRole() === 'admin') return true
  return Array.isArray(permissions) && (permissions.includes('*') || permissions.includes(permission))
}

function isDowntimeStatus(status) {
  return DOWNTIME_STATUSES.has(String(status || '').toUpperCase())
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

function sourceLabel(source) {
  if (!source || source === 'auto') return 'авто'
  if (source === 'manual') return 'ручной'
  return source
}

function statusLabel(status) {
  if (status === 'RUN') return 'РАБОТАЕТ'
  if (status === 'STOP') return 'ОСТАНОВЛЕН'
  if (status === 'ALARM') return 'АВАРИЯ'
  if (status === 'OFFLINE') return 'ОФФЛАЙН'
  if (status === 'IDLE') return 'ПРОСТОЙ'
  if (status === 'NO_DATA') return 'НЕТ ДАННЫХ'
  if (status === 'UNKNOWN') return 'НЕИЗВЕСТНО'
  return status
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

function getDayBounds(dayKey) {
  if (!dayKey) return null
  const start = new Date(`${dayKey}T00:00:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  return { startMs: start.getTime(), endMs: end.getTime() }
}

function overlapMinutesInDay(startTs, endTs, dayKey) {
  const bounds = getDayBounds(dayKey)
  if (!bounds || !startTs) return 0
  const startMs = new Date(normalizeTs(startTs)).getTime()
  const endMs = endTs ? new Date(normalizeTs(endTs)).getTime() : Date.now()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  const left = Math.max(startMs, bounds.startMs)
  const right = Math.min(endMs, bounds.endMs)
  if (right <= left) return 0
  return Math.max(0, Math.round((right - left) / 60000))
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
      </div>
      <div className="legend">
        {slices.map((s) => <div key={s.status}><span style={{ background: s.color }} />{statusLabel(s.status)}</div>)}
      </div>
    </div>
  )
}

function MinutesDonut({ title, rows = [], totalLabel = 'мин' }) {
  const total = rows.reduce((acc, row) => acc + Number(row.minutes || 0), 0) || 1
  let acc = 0
  const slices = rows.map((row) => {
    const value = Number(row.minutes || 0)
    const start = (acc / total) * 360
    acc += value
    const end = (acc / total) * 360
    return { status: row.status, value, start, end, color: STATUS_COLORS[row.status] || '#49c5ff' }
  })
  return (
    <div className="chart-card">
      <h3>{title}</h3>
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
            return <path key={s.status} d={d} fill={s.color} opacity="1" stroke="#0b1320" strokeWidth="0.02" />
          })}
          <circle r="0.52" fill="#111922" />
        </svg>
        <div className="donut-center">{Math.round(total)}<br />{totalLabel}</div>
      </div>
      <div className="legend">
        {slices.map((s) => {
          const pct = Math.round((s.value / total) * 100)
          return <div key={s.status}><span style={{ background: s.color }} />{statusLabel(s.status)}: {Math.round(s.value)} мин ({pct}%)</div>
        })}
      </div>
    </div>
  )
}

function DowntimeBars({ downtime = [], dayKey = '' }) {
  const grouped = downtime.reduce((acc, row) => {
    if (!isDowntimeStatus(row.status)) return acc
    const mins = overlapMinutesInDay(row.start_ts, row.end_ts, dayKey)
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
              <td><span className={statusTone(x.last_status)}>{statusLabel(x.last_status)}</span></td>
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
              <td><span className={statusTone(x.status)}>{statusLabel(x.status)}</span></td>
              <td>{formatTs(x.start_ts)}</td>
              <td>{sourceLabel(x.source)}</td>
              <td>{x.note || '—'}</td>
              <td>{x.created_by || '—'}</td>
              <td>
                {hasPermission('admin.panel') && x.source === 'manual'
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
  const liveLabel = (live) => {
    if (live === 'ONLINE') return 'В СЕТИ'
    if (live === 'STALE') return 'НЕТ НОВЫХ ДАННЫХ'
    return 'НЕТ ДАННЫХ'
  }

  return (
    <div className="chart-card">
      <h3>Живой сигнал оборудования</h3>
      <table>
        <thead><tr><th>Оборудование</th><th>Последний сигнал</th><th>Возраст, сек</th><th>Состояние</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.equipment_id}>
              <td>{x.equipment_id}</td>
              <td>{formatTs(x.last_seen)}</td>
              <td>{x.age_sec ?? '—'}</td>
              <td><span className={statusTone(x.live === 'ONLINE' ? 'RUN' : x.live === 'STALE' ? 'OFFLINE' : 'IDLE')}>{liveLabel(x.live)}</span></td>
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
              <td><span className={statusTone(x.status)}>{statusLabel(x.status)}</span></td>
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

function EquipmentStateCard({ equipment = [], events = [], equipmentState = [], dayKey }) {
  const latestByEquipment = new Map()
  events.forEach((e) => {
    if (toDayKey(e.ts) !== dayKey) return
    const prev = latestByEquipment.get(e.equipment_id)
    const currTs = new Date(normalizeTs(e.ts)).getTime()
    const prevTs = prev ? new Date(normalizeTs(prev.ts)).getTime() : -1
    if (!prev || currTs > prevTs) latestByEquipment.set(e.equipment_id, e)
  })
  const currentStateByEquipment = new Map(
    equipmentState.map((row) => [row.equipment_id, row.last_status])
  )

  let running = 0
  let alarm = 0
  let stop = 0
  let offline = 0
  let unknown = 0

  equipment.forEach((eq) => {
    const row = latestByEquipment.get(eq.equipment_id)
    const status = row?.status || currentStateByEquipment.get(eq.equipment_id)
    if (!status) {
      unknown += 1
      return
    }
    if (status === 'RUN') running += 1
    else if (status === 'ALARM') alarm += 1
    else if (status === 'STOP') stop += 1
    else if (status === 'OFFLINE') offline += 1
    else unknown += 1
  })

  return (
    <div className="chart-card">
      <h3>Состояния оборудования на данный момент</h3>
      <div className="legend">
        <div><span style={{ background: STATUS_COLORS.RUN }} />РАБОТАЕТ: {running}</div>
        <div><span style={{ background: STATUS_COLORS.ALARM }} />АВАРИЯ: {alarm}</div>
        <div><span style={{ background: STATUS_COLORS.STOP }} />ОСТАНОВЛЕН: {stop}</div>
        <div><span style={{ background: STATUS_COLORS.OFFLINE }} />ОФФЛАЙН: {offline}</div>
        <div><span style={{ background: '#6f8199' }} />НЕТ ДАННЫХ: {unknown}</div>
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

function PermissionProtected({ permission, children }) {
  return hasPermission(permission) ? children : <Navigate to="/overview" replace />
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
      setSession(res.access_token || '', res.refresh_token || '', res.role || 'operator', res.permissions || [])
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
      setSession(res.access_token || '', res.refresh_token || '', res.role || form.role || 'operator', res.permissions || [])
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
            <option value="operator">Оператор</option>
            <option value="admin">Администратор</option>
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
    let inFlight = false
    const load = async () => {
      if (inFlight) return
      inFlight = true
      const results = await Promise.allSettled([
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
      inFlight = false
      if (!mounted) return
      const [sm, eq, ev, dt, rp, sd, cd, es, el] = results
      if (sm.status === 'fulfilled') setSummary(sm.value)
      if (eq.status === 'fulfilled') setEquipment(eq.value)
      if (ev.status === 'fulfilled') setEvents(ev.value)
      if (dt.status === 'fulfilled') setDowntime(dt.value)
      if (cd.status === 'fulfilled') setCurrentDowntime(cd.value)
      if (es.status === 'fulfilled') setEquipmentState(es.value)
      if (el.status === 'fulfilled') setEquipmentLive(el.value)
      if (rp.status === 'fulfilled') setReports(rp.value)
      if (sd.status === 'fulfilled') setStatusDistribution(sd.value)
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed === 0) {
        setError('')
      } else {
        setError(`Проблема связи: не ответили ${failed} API из ${results.length}`)
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
          <NavLink to="/events-log" className="nav-item">События</NavLink>
          <NavLink to="/downtime-log" className="nav-item">Простои</NavLink>
          <NavLink to="/reports-view" className="nav-item">Отчеты</NavLink>
          {hasPermission('admin.panel') && <NavLink to="/admin-panel" className="nav-item">Админ</NavLink>}
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
          <Route path="/events-log" element={<EventsPage data={data} selectedDay={selectedDay} />} />
          <Route path="/downtime-log" element={<DowntimePage data={data} selectedDay={selectedDay} />} />
          <Route path="/reports-view" element={<ReportsPage data={data} alarmsCount={alarmsCount} selectedDay={selectedDay} />} />
          <Route path="/admin-panel" element={<PermissionProtected permission="admin.panel"><AdminPage /></PermissionProtected>} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function OverviewPage({ data, alarmsCount, selectedDay }) {
  const dayEvents = data.events.filter((x) => toDayKey(x.ts) === selectedDay)
  const dayDowntime = data.downtime.filter((x) => isDowntimeStatus(x.status) && (toDayKey(x.start_ts) === selectedDay || toDayKey(x.end_ts) === selectedDay))
  const dayStatusMinutes = useMemo(() => {
    const map = new Map()
    data.downtime
      .filter((x) => toDayKey(x.start_ts) === selectedDay || toDayKey(x.end_ts) === selectedDay)
      .forEach((x) => {
        const mins = overlapMinutesInDay(x.start_ts, x.end_ts, selectedDay)
        map.set(x.status || 'UNKNOWN', (map.get(x.status || 'UNKNOWN') || 0) + mins)
      })
    return Array.from(map.entries()).map(([status, minutes]) => ({ status, minutes })).sort((a, b) => b.minutes - a.minutes)
  }, [data.downtime, selectedDay])
  const downtimeMinutes = dayDowntime.reduce((acc, row) => {
    return acc + overlapMinutesInDay(row.start_ts, row.end_ts, selectedDay)
  }, 0)
  const alarmsToday = dayEvents.filter((x) => x.status === 'ALARM').length

  return (
    <section className="table-card">
      <h2>{`Обзор за ${selectedDay}`}</h2>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">События за день</div><div className="kpi-value">{dayEvents.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Оборудование</div><div className="kpi-value">{data.equipment.length || data.summary.total_equipment}</div></div>
        <div className="kpi-card"><div className="kpi-label">Простой за день, мин</div><div className="kpi-value">{downtimeMinutes}</div></div>
        <div className="kpi-card"><div className="kpi-label">Аварии за день</div><div className="kpi-value">{alarmsToday || alarmsCount}</div></div>
      </div>
      <div className="charts-grid">
        <MinutesDonut title="Анализ времени работы и простоев" rows={dayStatusMinutes} />
        <DailyEventsBars events={data.events} />
      </div>
      <div className="charts-grid">
        <DowntimeBars downtime={dayDowntime} dayKey={selectedDay} />
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
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [protocolFilter, setProtocolFilter] = useState('all')
  const [sortBy, setSortBy] = useState('id')

  const liveById = useMemo(
    () => new Map((data.equipmentLive || []).map((row) => [row.equipment_id, row.live])),
    [data.equipmentLive]
  )
  const stateById = useMemo(
    () => new Map((data.equipmentState || []).map((row) => [row.equipment_id, row.last_status])),
    [data.equipmentState]
  )

  const typeOptions = useMemo(
    () => [...new Set((data.equipment || []).map((x) => x.type).filter(Boolean))].sort(),
    [data.equipment]
  )
  const protocolOptions = useMemo(
    () => [...new Set((data.equipment || []).map((x) => x.protocol).filter(Boolean))].sort(),
    [data.equipment]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = (data.equipment || []).filter((row) => {
      if (typeFilter !== 'all' && row.type !== typeFilter) return false
      if (protocolFilter !== 'all' && row.protocol !== protocolFilter) return false
      if (!q) return true
      return (
        String(row.equipment_id || '').toLowerCase().includes(q) ||
        String(row.name || '').toLowerCase().includes(q)
      )
    })
    rows.sort((a, b) => {
      if (sortBy === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ru')
      if (sortBy === 'type') return String(a.type || '').localeCompare(String(b.type || ''), 'ru')
      if (sortBy === 'protocol') return String(a.protocol || '').localeCompare(String(b.protocol || ''), 'ru')
      return String(a.equipment_id || '').localeCompare(String(b.equipment_id || ''), 'ru')
    })
    return rows
  }, [data.equipment, query, typeFilter, protocolFilter, sortBy])

  const onlineCount = filtered.filter((x) => liveById.get(x.equipment_id) === 'ONLINE').length
  const staleCount = filtered.filter((x) => liveById.get(x.equipment_id) === 'STALE').length
  const noSignalCount = filtered.filter((x) => !liveById.get(x.equipment_id) || liveById.get(x.equipment_id) === 'NO_DATA').length
  const liveLabel = (live) => {
    if (live === 'ONLINE') return 'В СЕТИ'
    if (live === 'STALE') return 'НЕТ НОВЫХ ДАННЫХ'
    return 'НЕТ ДАННЫХ'
  }

  return (
    <section className="table-card">
      <h2>Оборудование</h2>
      <div className="kpi-grid equipment-kpis">
        <div className="kpi-card"><div className="kpi-label">Найдено</div><div className="kpi-value">{filtered.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">В сети</div><div className="kpi-value">{onlineCount}</div></div>
        <div className="kpi-card"><div className="kpi-label">Нет новых данных</div><div className="kpi-value">{staleCount}</div></div>
        <div className="kpi-card"><div className="kpi-label">Нет сигнала</div><div className="kpi-value">{noSignalCount}</div></div>
      </div>

      <div className="equipment-toolbar">
        <input
          placeholder="Поиск по ID или имени"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">Все типы</option>
          {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={protocolFilter} onChange={(e) => setProtocolFilter(e.target.value)}>
          <option value="all">Все протоколы</option>
          {protocolOptions.map((protocol) => <option key={protocol} value={protocol}>{protocol}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="id">Сортировка: ID</option>
          <option value="name">Сортировка: имя</option>
          <option value="type">Сортировка: тип</option>
          <option value="protocol">Сортировка: протокол</option>
        </select>
      </div>

      <div className="equipment-cards">
        {filtered.map((x) => {
          const live = liveById.get(x.equipment_id) || 'NO_DATA'
          const currentStatus = stateById.get(x.equipment_id) || 'NO_DATA'
          const liveTone = live === 'ONLINE' ? 'run' : live === 'STALE' ? 'offline' : 'idle'
          return (
            <article key={x.equipment_id} className="equipment-card">
              <div className="equipment-card-head">
                <div>
                  <div className="equip-title">{x.name || x.equipment_id}</div>
                  <div className="sub">{x.equipment_id}</div>
                </div>
                <span className={`status ${liveTone}`}>{liveLabel(live)}</span>
              </div>
              <div className="equipment-tags">
                <span className="tag">{x.type || '—'}</span>
                <span className="tag">{x.protocol || '—'}</span>
                <span className={`status ${statusTone(currentStatus).replace('status ', '')}`}>{statusLabel(currentStatus)}</span>
              </div>
              <div className="btn-row">
                <button className="ghost" onClick={() => navigate(`/events-log?equipment=${encodeURIComponent(x.equipment_id)}`)}>События</button>
                <button className="ghost" onClick={() => navigate(`/downtime-log?equipment=${encodeURIComponent(x.equipment_id)}`)}>Простои</button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function EventsPage({ data, selectedDay }) {
  const location = useLocation()
  const initialEquipment = new URLSearchParams(location.search).get('equipment') || 'all'
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [equipmentFilter, setEquipmentFilter] = useState(initialEquipment)
  const [sourceFilter, setSourceFilter] = useState('all')
  useEffect(() => {
    setEquipmentFilter(new URLSearchParams(location.search).get('equipment') || 'all')
  }, [location.search])

  const dayEvents = useMemo(
    () => data.events.filter((x) => toDayKey(x.ts) === selectedDay),
    [data.events, selectedDay]
  )
  const equipmentOptions = useMemo(
    () => [...new Set(dayEvents.map((x) => x.equipment_id).filter(Boolean))].sort(),
    [dayEvents]
  )
  const sourceOptions = useMemo(
    () => [...new Set(dayEvents.map((x) => x.source).filter(Boolean))].sort(),
    [dayEvents]
  )
  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dayEvents.filter((x) => {
      if (statusFilter !== 'all' && x.status !== statusFilter) return false
      if (equipmentFilter !== 'all' && x.equipment_id !== equipmentFilter) return false
      if (sourceFilter !== 'all' && (x.source || 'auto') !== sourceFilter) return false
      if (!q) return true
      return (
        String(x.equipment_id || '').toLowerCase().includes(q) ||
        String(x.status || '').toLowerCase().includes(q) ||
        String(x.note || '').toLowerCase().includes(q) ||
        String(x.created_by || '').toLowerCase().includes(q)
      )
    })
  }, [dayEvents, query, statusFilter, equipmentFilter, sourceFilter])
  const totalDowntime = filteredEvents.reduce((acc, x) => acc + Number(x.downtime_minutes || 0), 0)
  const alarms = filteredEvents.filter((x) => x.status === 'ALARM').length
  const uniqueEquipment = new Set(filteredEvents.map((x) => x.equipment_id)).size

  return (
    <section className="table-card">
      <h2>{`События за ${selectedDay}`}</h2>
      <div className="kpi-grid events-kpis">
        <div className="kpi-card"><div className="kpi-label">Записей</div><div className="kpi-value">{filteredEvents.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Оборудование</div><div className="kpi-value">{uniqueEquipment}</div></div>
        <div className="kpi-card"><div className="kpi-label">ALARM</div><div className="kpi-value">{alarms}</div></div>
        <div className="kpi-card"><div className="kpi-label">Сумма простоя, мин</div><div className="kpi-value">{totalDowntime}</div></div>
      </div>
      <div className="events-toolbar">
        <input
          placeholder="Поиск по ID, статусу, комментарию, автору"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Все статусы</option>
          <option value="RUN">РАБОТАЕТ</option>
          <option value="STOP">ОСТАНОВЛЕН</option>
          <option value="ALARM">АВАРИЯ</option>
          <option value="OFFLINE">ОФФЛАЙН</option>
          <option value="IDLE">ПРОСТОЙ</option>
        </select>
        <select value={equipmentFilter} onChange={(e) => setEquipmentFilter(e.target.value)}>
          <option value="all">Все ИД</option>
          {equipmentOptions.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">Все источники</option>
          <option value="auto">авто</option>
          {sourceOptions.filter((s) => s !== 'auto').map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
        </select>
      </div>
      <table>
        <thead><tr><th>Оборудование</th><th>Статус</th><th>Начало</th><th>Конец</th><th>Простой, мин</th><th>Источник</th><th>Комментарий</th><th>Автор</th></tr></thead>
        <tbody>
          {filteredEvents.map((x) => <tr key={`${x.equipment_id}-${x.start_ts}-${x.status}`}><td>{x.equipment_id}</td><td><span className={statusTone(x.status)}>{statusLabel(x.status)}</span></td><td>{formatTs(x.start_ts)}</td><td>{formatTs(x.end_ts)}</td><td>{x.downtime_minutes ?? 0}</td><td>{sourceLabel(x.source)}</td><td>{x.note || '—'}</td><td>{x.created_by || '—'}</td></tr>)}
        </tbody>
      </table>
    </section>
  )
}

function DowntimePage({ data, selectedDay }) {
  const location = useLocation()
  const initialEquipment = new URLSearchParams(location.search).get('equipment') || 'all'
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [equipmentFilter, setEquipmentFilter] = useState(initialEquipment)
  const [sourceFilter, setSourceFilter] = useState('all')
  const [focusEquipmentId, setFocusEquipmentId] = useState('')
  const [focusDay, setFocusDay] = useState(selectedDay)
  useEffect(() => {
    const eq = new URLSearchParams(location.search).get('equipment') || 'all'
    setEquipmentFilter(eq)
    setFocusEquipmentId(eq === 'all' ? '' : eq)
  }, [location.search])
  const dayDowntime = data.downtime.filter((x) => isDowntimeStatus(x.status) && (toDayKey(x.start_ts) === selectedDay || toDayKey(x.end_ts) === selectedDay))
  const manualDowntime = data.downtime.filter((x) => x.source === 'manual')
  const equipmentOptions = useMemo(
    () => [...new Set(data.equipment.map((x) => x.equipment_id).filter(Boolean))].sort(),
    [data.equipment]
  )
  const filteredDowntime = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dayDowntime.filter((x) => {
      if (statusFilter !== 'all' && x.status !== statusFilter) return false
      if (equipmentFilter !== 'all' && x.equipment_id !== equipmentFilter) return false
      if (sourceFilter !== 'all' && (x.source || 'auto') !== sourceFilter) return false
      if (!q) return true
      return (
        String(x.equipment_id || '').toLowerCase().includes(q) ||
        String(x.note || '').toLowerCase().includes(q) ||
        String(x.created_by || '').toLowerCase().includes(q)
      )
    })
  }, [dayDowntime, query, statusFilter, equipmentFilter, sourceFilter])
  const totalDuration = filteredDowntime.reduce((acc, x) => {
    const s = new Date(normalizeTs(x.start_ts)).getTime()
    const e = x.end_ts ? new Date(normalizeTs(x.end_ts)).getTime() : Date.now()
    if (!Number.isFinite(s) || !Number.isFinite(e)) return acc
    return acc + Math.max(0, Math.round((e - s) / 60000))
  }, 0)
  const focusedRows = useMemo(
    () => data.downtime
      .filter((x) => isDowntimeStatus(x.status))
      .filter((x) => !focusEquipmentId || x.equipment_id === focusEquipmentId)
      .filter((x) => toDayKey(x.start_ts) === focusDay || toDayKey(x.end_ts) === focusDay)
      .sort((a, b) => new Date(normalizeTs(b.start_ts)).getTime() - new Date(normalizeTs(a.start_ts)).getTime()),
    [data.downtime, focusEquipmentId, focusDay]
  )
  const focusedTotal = focusedRows.reduce((acc, x) => {
    const s = new Date(normalizeTs(x.start_ts)).getTime()
    const e = x.end_ts ? new Date(normalizeTs(x.end_ts)).getTime() : Date.now()
    if (!Number.isFinite(s) || !Number.isFinite(e)) return acc
    return acc + Math.max(0, Math.round((e - s) / 60000))
  }, 0)

  const resolveManual = async (equipmentId) => {
    await api.resolveManualDowntime({ equipment_id: equipmentId })
    window.location.reload()
  }
  return (
    <section className="table-card">
      <h2>{`Простои за ${selectedDay}`}</h2>
      <div className="kpi-grid downtime-kpis">
        <div className="kpi-card"><div className="kpi-label">Кол-во простоев</div><div className="kpi-value">{filteredDowntime.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Текущие простои</div><div className="kpi-value">{data.currentDowntime.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Ручные</div><div className="kpi-value">{manualDowntime.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Суммарно, мин</div><div className="kpi-value">{totalDuration}</div></div>
      </div>
      <div className="downtime-toolbar">
        <input
          placeholder="Поиск по ID, комментарию, автору"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Все статусы</option>
          <option value="STOP">ОСТАНОВЛЕН</option>
          <option value="ALARM">АВАРИЯ</option>
          <option value="OFFLINE">ОФФЛАЙН</option>
          <option value="IDLE">ПРОСТОЙ</option>
        </select>
        <select value={equipmentFilter} onChange={(e) => setEquipmentFilter(e.target.value)}>
          <option value="all">Все ИД</option>
          {equipmentOptions.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">Все источники</option>
          <option value="auto">авто</option>
          <option value="manual">ручной</option>
        </select>
      </div>
      <div className="chart-card">
        <h3>Просмотр простоев оборудования за день</h3>
        <div className="downtime-toolbar">
          <select value={focusEquipmentId} onChange={(e) => setFocusEquipmentId(e.target.value)}>
            <option value="">Все оборудование</option>
            {equipmentOptions.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <input type="date" value={focusDay} onChange={(e) => setFocusDay(e.target.value || selectedDay)} />
          <div className="kpi-card"><div className="kpi-label">Кол-во простоев</div><div className="kpi-value">{focusedRows.length}</div></div>
          <div className="kpi-card"><div className="kpi-label">Минуты</div><div className="kpi-value">{focusedTotal}</div></div>
        </div>
        <table>
          <thead><tr><th>Оборудование</th><th>Статус</th><th>Начало</th><th>Конец</th><th>Длительность</th><th>Источник</th></tr></thead>
          <tbody>
            {focusedRows.map((x) => <tr key={`${x.equipment_id}-${x.start_ts}-${x.status}-focus`}><td>{x.equipment_id}</td><td><span className={statusTone(x.status)}>{statusLabel(x.status)}</span></td><td>{formatTs(x.start_ts)}</td><td>{formatTs(x.end_ts)}</td><td>{durationMinutes(x.start_ts, x.end_ts)}</td><td>{sourceLabel(x.source)}</td></tr>)}
          </tbody>
        </table>
      </div>
      <CurrentDowntimeTable rows={data.currentDowntime} onResolveManual={resolveManual} />
      <ManualDowntimeTable rows={manualDowntime} />
      <table>
        <thead><tr><th>Оборудование</th><th>Статус</th><th>Начало</th><th>Конец</th><th>Длительность</th><th>Источник</th><th>Комментарий</th><th>Автор</th></tr></thead>
        <tbody>
          {filteredDowntime.map((x) => <tr key={`${x.equipment_id}-${x.start_ts}-${x.status}`}><td>{x.equipment_id}</td><td><span className={statusTone(x.status)}>{statusLabel(x.status)}</span></td><td>{formatTs(x.start_ts)}</td><td>{formatTs(x.end_ts)}</td><td>{durationMinutes(x.start_ts, x.end_ts)}</td><td>{sourceLabel(x.source)}</td><td>{x.note || '—'}</td><td>{x.created_by || '—'}</td></tr>)}
        </tbody>
      </table>
    </section>
  )
}

function ReportsPage({ data, alarmsCount, selectedDay }) {
  const [periodType, setPeriodType] = useState('day')
  const [periodDay, setPeriodDay] = useState(selectedDay)
  const [periodMonth, setPeriodMonth] = useState(selectedDay.slice(0, 7))
  const [periodYear, setPeriodYear] = useState(selectedDay.slice(0, 4))

  const periodLabel = periodType === 'day'
    ? periodDay
    : periodType === 'month'
      ? periodMonth
      : periodYear

  const periodBounds = useMemo(() => {
    if (periodType === 'day') {
      const start = new Date(`${periodDay}T00:00:00`)
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
      return { startMs: start.getTime(), endMs: end.getTime() }
    }
    if (periodType === 'month') {
      const [y, m] = periodMonth.split('-').map(Number)
      const start = new Date(y, (m || 1) - 1, 1, 0, 0, 0, 0)
      const end = new Date(y, (m || 1), 1, 0, 0, 0, 0)
      return { startMs: start.getTime(), endMs: end.getTime() }
    }
    const y = Number(periodYear) || new Date().getFullYear()
    const start = new Date(y, 0, 1, 0, 0, 0, 0)
    const end = new Date(y + 1, 0, 1, 0, 0, 0, 0)
    return { startMs: start.getTime(), endMs: end.getTime() }
  }, [periodType, periodDay, periodMonth, periodYear])

  const overlapMinutesInBounds = (startTs, endTs) => {
    if (!startTs) return 0
    const s = new Date(normalizeTs(startTs)).getTime()
    const e = endTs ? new Date(normalizeTs(endTs)).getTime() : Date.now()
    if (!Number.isFinite(s) || !Number.isFinite(e)) return 0
    const left = Math.max(s, periodBounds.startMs)
    const right = Math.min(e, periodBounds.endMs)
    if (right <= left) return 0
    return Math.max(0, Math.round((right - left) / 60000))
  }

  const inPeriod = (ts) => {
    const dayKey = toDayKey(ts)
    if (!dayKey) return false
    if (periodType === 'day') return dayKey === periodDay
    if (periodType === 'month') return dayKey.startsWith(`${periodMonth}-`) || dayKey.slice(0, 7) === periodMonth
    return dayKey.startsWith(`${periodYear}-`)
  }

  const periodEvents = useMemo(
    () => data.events.filter((x) => inPeriod(x.ts)),
    [data.events, periodType, periodDay, periodMonth, periodYear]
  )
  const periodDowntime = useMemo(
    () => data.downtime
      .filter((x) => isDowntimeStatus(x.status))
      .filter((x) => inPeriod(x.start_ts) || inPeriod(x.end_ts)),
    [data.downtime, periodType, periodDay, periodMonth, periodYear]
  )
  const periodIntervals = useMemo(
    () => data.downtime.filter((x) => inPeriod(x.start_ts) || inPeriod(x.end_ts)),
    [data.downtime, periodType, periodDay, periodMonth, periodYear]
  )
  const [stationId, setStationId] = useState('')
  const stationOptions = useMemo(
    () => [...new Set(periodIntervals.map((x) => x.equipment_id).filter(Boolean))].sort(),
    [periodIntervals]
  )
  const statusDistribution = useMemo(() => {
    const map = new Map()
    periodEvents.forEach((x) => {
      const key = x.status || 'UNKNOWN'
      map.set(key, (map.get(key) || 0) + 1)
    })
    return Array.from(map.entries()).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count)
  }, [periodEvents])
  const statusMinutes = useMemo(() => {
    const map = new Map()
    periodIntervals.forEach((x) => {
      const status = x.status || 'UNKNOWN'
      const mins = overlapMinutesInBounds(x.start_ts, x.end_ts)
      map.set(status, (map.get(status) || 0) + mins)
    })
    return Array.from(map.entries())
      .map(([status, minutes]) => ({ status, minutes }))
      .sort((a, b) => b.minutes - a.minutes)
  }, [periodIntervals, periodBounds.startMs, periodBounds.endMs])
  const stationStatusMinutes = useMemo(() => {
    if (!stationId) return []
    const map = new Map()
    periodIntervals
      .filter((x) => x.equipment_id === stationId)
      .forEach((x) => {
        const mins = overlapMinutesInBounds(x.start_ts, x.end_ts)
        map.set(x.status || 'UNKNOWN', (map.get(x.status || 'UNKNOWN') || 0) + mins)
      })
    return Array.from(map.entries()).map(([status, minutes]) => ({ status, minutes })).sort((a, b) => b.minutes - a.minutes)
  }, [periodIntervals, stationId, periodBounds.startMs, periodBounds.endMs])
  const runMinutes = statusMinutes.find((x) => x.status === 'RUN')?.minutes || 0
  const downtimeMinutes = statusMinutes
    .filter((x) => isDowntimeStatus(x.status))
    .reduce((acc, x) => acc + x.minutes, 0)
  const totalTrackedMinutes = runMinutes + downtimeMinutes
  const availabilityPct = totalTrackedMinutes > 0
    ? Math.round((runMinutes / totalTrackedMinutes) * 100)
    : 0
  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }))
    periodEvents.forEach((x) => {
      const d = new Date(normalizeTs(x.ts))
      if (Number.isNaN(d.getTime())) return
      buckets[d.getHours()].count += 1
    })
    return buckets
  }, [periodEvents])
  const topByEvents = useMemo(() => {
    const map = new Map()
    periodEvents.forEach((x) => map.set(x.equipment_id, (map.get(x.equipment_id) || 0) + 1))
    return Array.from(map.entries()).map(([id, cnt]) => ({ id, cnt })).sort((a, b) => b.cnt - a.cnt).slice(0, 8)
  }, [periodEvents])
  const topByDowntime = useMemo(() => {
    const map = new Map()
    periodDowntime.forEach((x) => {
      const s = new Date(normalizeTs(x.start_ts)).getTime()
      const e = x.end_ts ? new Date(normalizeTs(x.end_ts)).getTime() : Date.now()
      if (!Number.isFinite(s) || !Number.isFinite(e)) return
      const mins = Math.max(0, Math.round((e - s) / 60000))
      map.set(x.equipment_id, (map.get(x.equipment_id) || 0) + mins)
    })
    return Array.from(map.entries()).map(([id, mins]) => ({ id, mins })).sort((a, b) => b.mins - a.mins).slice(0, 8)
  }, [periodDowntime])
  const totalDowntimeCount = periodDowntime.length
  const uniqueEquipment = new Set(periodEvents.map((x) => x.equipment_id)).size
  const maxHourly = Math.max(1, ...hourly.map((x) => x.count))

  return (
    <section className="table-card">
      <h2>{`Отчеты за ${periodLabel}`}</h2>
      <div className="reports-toolbar">
        <select value={periodType} onChange={(e) => setPeriodType(e.target.value)}>
          <option value="day">По дню</option>
          <option value="month">По месяцу</option>
          <option value="year">По году</option>
        </select>
        {periodType === 'day' && <input type="date" value={periodDay} onChange={(e) => setPeriodDay(e.target.value || selectedDay)} />}
        {periodType === 'month' && <input type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value || selectedDay.slice(0, 7))} />}
        {periodType === 'year' && <input type="number" min="2020" max="2100" value={periodYear} onChange={(e) => setPeriodYear(e.target.value || selectedDay.slice(0, 4))} />}
        <button className="ghost" onClick={() => window.print()}>Печать отчета</button>
      </div>
      <div className="kpi-grid reports-kpis">
        <div className="kpi-card"><div className="kpi-label">Событий</div><div className="kpi-value">{periodEvents.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Оборудование</div><div className="kpi-value">{uniqueEquipment}</div></div>
        <div className="kpi-card"><div className="kpi-label">ALARM</div><div className="kpi-value">{statusDistribution.find((x) => x.status === 'ALARM')?.count || 0}</div></div>
        <div className="kpi-card"><div className="kpi-label">Кол-во простоев</div><div className="kpi-value">{totalDowntimeCount}</div></div>
      </div>
      <div className="charts-grid">
        <MinutesDonut title="Анализ времени работы и простоев" rows={statusMinutes} />
        <div className="chart-card">
          <h3>Простои по оборудованию (мин)</h3>
          <div className="bars">
            {topByDowntime.map((x) => (
              <div key={x.id} className="bar-row">
                <div className="bar-label">{x.id}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(4, (x.mins / (topByDowntime[0]?.mins || 1)) * 100)}%` }} /></div>
                <div className="bar-val">{x.mins}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-card">
        <h3>Диаграмма по станку</h3>
        <div className="reports-toolbar">
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">Выберите станок</option>
            {stationOptions.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>
        {stationId
          ? <MinutesDonut title={`Статусы по времени: ${stationId}`} rows={stationStatusMinutes} />
          : <div className="sub">Выберите станок для отображения круговой диаграммы.</div>}
      </div>
      <div className="charts-grid">
        <div className="chart-card">
          <h3>Пиковые часы активности</h3>
          <div className="bars">
            {hourly.map((x) => (
              <div key={x.hour} className="bar-row">
                <div className="bar-label">{String(x.hour).padStart(2, '0')}:00</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(4, (x.count / maxHourly) * 100)}%` }} /></div>
                <div className="bar-val">{x.count}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="chart-card">
          <h3>Топ оборудования по событиям</h3>
          <div className="bars">
            {topByEvents.map((x) => (
              <div key={x.id} className="bar-row">
                <div className="bar-label">{x.id}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(4, (x.cnt / (topByEvents[0]?.cnt || 1)) * 100)}%` }} /></div>
                <div className="bar-val">{x.cnt}</div>
              </div>
            ))}
          </div>
        </div>
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
  const [permissionsCatalog, setPermissionsCatalog] = useState([])
  const [equipmentList, setEquipmentList] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [forceRunId, setForceRunId] = useState('')
  const [forceRunBusy, setForceRunBusy] = useState(false)
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'operator' })
  const [roleForm, setRoleForm] = useState({ name: '', description: '', permissions: [] })
  const [editRoleName, setEditRoleName] = useState('')
  const [editRoleForm, setEditRoleForm] = useState({ description: '', permissions: [] })
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
  const [telegramForm, setTelegramForm] = useState({ equipment_id: '', message: '' })
  const [telegramBusy, setTelegramBusy] = useState(false)

  const loadAdminData = async () => {
    try {
      const [u, r, eq, perms] = await Promise.all([api.listUsers(), api.listRoles(), api.getEquipment(), api.getPermissions()])
      setUsers(Array.isArray(u) ? u : [])
      setRoles(Array.isArray(r) ? r : [])
      setEquipmentList(Array.isArray(eq) ? eq : [])
      setPermissionsCatalog(Array.isArray(perms) ? perms : [])
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
      setRoleForm({ name: '', description: '', permissions: [] })
      await loadAdminData()
    } catch (err) {
      setError(`Ошибка создания роли: ${String(err.message || err)}`)
    }
  }
  const updateRole = async (e) => {
    e.preventDefault()
    if (!editRoleName) {
      setError('Выберите роль для редактирования')
      return
    }
    try {
      await api.updateRole(editRoleName, editRoleForm)
      setNotice(`Роль обновлена: ${editRoleName}`)
      await loadAdminData()
    } catch (err) {
      setError(`Ошибка обновления роли: ${String(err.message || err)}`)
    }
  }
  const deleteRole = async (roleName) => {
    if (!roleName) return
    if (!window.confirm(`Удалить роль ${roleName}?`)) return
    try {
      await api.deleteRole(roleName)
      setNotice(`Роль удалена: ${roleName}`)
      if (editRoleName === roleName) {
        setEditRoleName('')
        setEditRoleForm({ description: '', permissions: [] })
      }
      await loadAdminData()
    } catch (err) {
      setError(`Ошибка удаления роли: ${String(err.message || err)}`)
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
  const createUser = async (e) => {
    e.preventDefault()
    if (!userForm.username.trim() || !userForm.password.trim()) {
      setError('Заполните логин и пароль пользователя')
      return
    }
    try {
      await api.createUser({
        username: userForm.username.trim(),
        password: userForm.password,
        role: userForm.role
      })
      setNotice(`Пользователь создан: ${userForm.username}`)
      setUserForm({ username: '', password: '', role: 'operator' })
      await loadAdminData()
    } catch (err) {
      setError(`Ошибка создания пользователя: ${String(err.message || err)}`)
    }
  }
  const deleteUser = async (username) => {
    if (!username) return
    if (!window.confirm(`Удалить пользователя ${username}?`)) return
    try {
      await api.deleteUser(username)
      setNotice(`Пользователь удален: ${username}`)
      await loadAdminData()
    } catch (err) {
      setError(`Ошибка удаления пользователя: ${String(err.message || err)}`)
    }
  }
  const togglePermission = (list, code) => {
    if (list.includes(code)) return list.filter((x) => x !== code)
    return [...list, code]
  }
  const forceRun = async () => {
    if (!forceRunId) {
      setError('Выберите оборудование')
      return
    }
    setForceRunBusy(true)
    setError('')
    try {
      await api.resolveManualDowntime({ equipment_id: forceRunId, note: 'forced RUN from admin' })
      setNotice(`Оборудование принудительно переведено в RUN: ${forceRunId}`)
    } catch (e) {
      setError(`Ошибка: ${String(e.message || e)}`)
    } finally {
      setForceRunBusy(false)
    }
  }
  const sendTelegramMessage = async (e) => {
    e.preventDefault()
    const msg = telegramForm.message.trim()
    if (!msg) {
      setError('Введите сообщение для бригады')
      return
    }
    setTelegramBusy(true)
    setError('')
    try {
      await api.telegramNotify({
        equipment_id: telegramForm.equipment_id || '',
        message: msg
      })
      setNotice('Сообщение в Telegram отправлено')
      setTelegramForm({ equipment_id: '', message: '' })
    } catch (err) {
      setError(`Ошибка отправки в Telegram: ${String(err.message || err)}`)
    } finally {
      setTelegramBusy(false)
    }
  }

  return (
    <section className="table-card">
      <h2>Администрирование</h2>
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner">{notice}</div>}
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">Пользователи</div><div className="kpi-value">{users.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Роли</div><div className="kpi-value">{roles.length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Оборудование</div><div className="kpi-value">{equipmentList.length}</div></div>
      </div>
      <div className="btn-row">
        <button className="ghost" onClick={() => window.open('/admin/', '_blank')}>Админ-панель Django</button>
        <button className="ghost" onClick={() => window.open('http://localhost:1880', '_blank')}>Node-RED</button>
      </div>
      <div className="charts-grid" style={{ marginTop: 14 }}>
        <form className="chart-card" onSubmit={createUser}>
          <h3>Создать пользователя</h3>
          <label>Логин<input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} /></label>
          <label>Пароль<input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></label>
          <label>Роль
            <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
              {roles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </label>
          <button className="primary" type="submit">Создать пользователя</button>
        </form>
        <form className="chart-card" onSubmit={createEquipment}>
          <h3>Добавить оборудование</h3>
          <label>ИД<input value={equipmentForm.equipment_id} onChange={(e) => setEquipmentForm({ ...equipmentForm, equipment_id: e.target.value })} /></label>
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
          {equipmentForm.type === 'push' && <label>Топик<input value={equipmentForm.endpoint_topic} onChange={(e) => setEquipmentForm({ ...equipmentForm, endpoint_topic: e.target.value })} /></label>}
          {equipmentForm.type === 'poll' && <label>Интервал опроса, сек<input type="number" value={equipmentForm.poll_interval_sec} onChange={(e) => setEquipmentForm({ ...equipmentForm, poll_interval_sec: Number(e.target.value) })} /></label>}
          <label>Таймаут, сек<input type="number" value={equipmentForm.timeout_sec} onChange={(e) => setEquipmentForm({ ...equipmentForm, timeout_sec: Number(e.target.value) })} /></label>
          <button className="primary" type="submit">Добавить</button>
        </form>

        <form className="chart-card" onSubmit={createRole}>
          <h3>Создать роль</h3>
          <label>Название<input value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} /></label>
          <label>Описание<input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} /></label>
          <div className="sub">Права доступа</div>
          <div className="permission-grid">
            {permissionsCatalog.map((p) => (
              <label key={p.code} className="permission-item">
                <input
                  type="checkbox"
                  checked={roleForm.permissions.includes(p.code)}
                  onChange={() => setRoleForm({ ...roleForm, permissions: togglePermission(roleForm.permissions, p.code) })}
                />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
          <button className="primary" type="submit">Создать роль</button>
          <div className="sub" style={{ marginTop: 8 }}>Роли: {roles.map((r) => r.name).join(', ') || '—'}</div>
        </form>
        <form className="chart-card" onSubmit={updateRole}>
          <h3>Изменить роль</h3>
          <label>Роль
            <select
              value={editRoleName}
              onChange={(e) => {
                const name = e.target.value
                const role = roles.find((r) => r.name === name)
                setEditRoleName(name)
                setEditRoleForm({
                  description: role?.description || '',
                  permissions: Array.isArray(role?.permissions) ? role.permissions : []
                })
              }}
            >
              <option value="">Выберите роль</option>
              {roles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </label>
          <label>Описание
            <input value={editRoleForm.description} onChange={(e) => setEditRoleForm({ ...editRoleForm, description: e.target.value })} />
          </label>
          <label>Права доступа
            <div className="permission-grid">
              {permissionsCatalog.map((p) => (
                <label key={p.code} className="permission-item">
                  <input
                    type="checkbox"
                    checked={editRoleForm.permissions.includes(p.code)}
                    onChange={() => setEditRoleForm({ ...editRoleForm, permissions: togglePermission(editRoleForm.permissions, p.code) })}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </label>
          {['admin', 'operator'].includes(editRoleName) && <div className="sub">Системные роли нельзя изменять или удалять.</div>}
          <div className="btn-row">
            <button className="primary" type="submit" disabled={!editRoleName || ['admin', 'operator'].includes(editRoleName)}>Сохранить изменения</button>
            <button className="ghost" type="button" disabled={!editRoleName || ['admin', 'operator'].includes(editRoleName)} onClick={() => deleteRole(editRoleName)}>Удалить роль</button>
          </div>
        </form>
      </div>

      <div className="charts-grid" style={{ marginTop: 14 }}>
        <form className="chart-card" onSubmit={createManualDowntime}>
          <h3>Ручной простой (админ)</h3>
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
              <option value="STOP">ОСТАНОВЛЕН</option>
              <option value="ALARM">АВАРИЯ</option>
              <option value="OFFLINE">ОФФЛАЙН</option>
              <option value="IDLE">ПРОСТОЙ</option>
            </select>
          </label>
          <label>Начало<input type="datetime-local" value={manualDowntimeForm.start_ts} onChange={(e) => setManualDowntimeForm({ ...manualDowntimeForm, start_ts: e.target.value })} /></label>
          <label>Конец (опционально)<input type="datetime-local" value={manualDowntimeForm.end_ts} onChange={(e) => setManualDowntimeForm({ ...manualDowntimeForm, end_ts: e.target.value })} /></label>
          <label>Комментарий<input value={manualDowntimeForm.note} onChange={(e) => setManualDowntimeForm({ ...manualDowntimeForm, note: e.target.value })} /></label>
          <button className="primary" type="submit">Добавить простой</button>
        </form>
        <form className="chart-card" onSubmit={sendTelegramMessage}>
          <h3>Сообщение ремонтной бригаде</h3>
          <label>Оборудование (опционально)
            <select value={telegramForm.equipment_id} onChange={(e) => setTelegramForm({ ...telegramForm, equipment_id: e.target.value })}>
              <option value="">Без привязки</option>
              {equipmentList.map((eq) => (
                <option key={eq.equipment_id} value={eq.equipment_id}>
                  {eq.equipment_id} - {eq.name}
                </option>
              ))}
            </select>
          </label>
          <label>Текст сообщения
            <textarea
              rows={5}
              value={telegramForm.message}
              onChange={(e) => setTelegramForm({ ...telegramForm, message: e.target.value })}
              placeholder="Например: Станок остановлен, срочно требуется ремонт."
            />
          </label>
          <button className="primary" type="submit" disabled={telegramBusy}>
            {telegramBusy ? 'Отправляю...' : 'Отправить в Telegram'}
          </button>
        </form>
        <div className="chart-card">
          <h3>Принудительно перевести в RUN</h3>
          <div className="btn-row">
            <select value={forceRunId} onChange={(e) => setForceRunId(e.target.value)}>
              <option value="">Выберите оборудование</option>
              {equipmentList.map((eq) => (
                <option key={eq.equipment_id} value={eq.equipment_id}>
                  {eq.equipment_id} - {eq.name}
                </option>
              ))}
            </select>
            <button className="ghost" disabled={forceRunBusy} onClick={forceRun}>
              {forceRunBusy ? 'Выполняю...' : 'Перевести в RUN'}
            </button>
          </div>
        </div>
      </div>

      <div className="chart-card" style={{ marginTop: 14 }}>
        <h3>Пользователи (админ)</h3>
        <table>
          <thead><tr><th>Пользователь</th><th>Роль</th><th>Создан</th><th>Действие</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username}>
                <td>{u.username}</td>
                <td>{u.role}</td>
                <td>{formatTs(u.created_at)}</td>
                <td>
                  {u.username === 'admin'
                    ? '—'
                    : <button className="ghost" onClick={() => deleteUser(u.username)}>Удалить</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="chart-card" style={{ marginTop: 14 }}>
        <h3>Роли и права</h3>
        <table>
          <thead><tr><th>Роль</th><th>Описание</th><th>Права</th></tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.description || '—'}</td>
                <td>{Array.isArray(r.permissions) && r.permissions.length > 0 ? r.permissions.join(', ') : '—'}</td>
              </tr>
            ))}
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
      <Route path="/*" element={<Protected><AppLayout /></Protected>} />
    </Routes>
  )
}
