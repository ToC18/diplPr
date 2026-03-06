export function getAccessToken() {
  return localStorage.getItem('asmon_access_token') || ''
}

export function getRefreshToken() {
  return localStorage.getItem('asmon_refresh_token') || ''
}

export function getSessionRole() {
  return localStorage.getItem('asmon_role') || ''
}

export function setSession(accessToken, refreshToken, role = '') {
  localStorage.setItem('asmon_access_token', accessToken || '')
  localStorage.setItem('asmon_refresh_token', refreshToken || '')
  localStorage.setItem('asmon_role', role || '')
}

export function clearSession() {
  localStorage.removeItem('asmon_access_token')
  localStorage.removeItem('asmon_refresh_token')
  localStorage.removeItem('asmon_role')
}

export function authHeaders(extra = {}) {
  const token = getAccessToken()
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders(options.headers || {})
  })
  const text = await response.text()
  if (!response.ok) {
    // Recover from stale/invalid token after restarts or secret changes.
    if (response.status === 401 && getAccessToken()) {
      clearSession()
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.replace('/login')
      }
    }
    throw new Error(text || `${response.status} ${response.statusText}`)
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const api = {
  request,
  login(payload) {
    return fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const text = await response.text()
      if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`)
      return JSON.parse(text)
    })
  },
  register(payload) {
    return fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const text = await response.text()
      if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`)
      return JSON.parse(text)
    })
  },
  refresh(payload) {
    return fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const text = await response.text()
      if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`)
      return JSON.parse(text)
    })
  },
  me() {
    return request('/auth/me')
  },
  listUsers() {
    return request('/auth/users')
  },
  logout(payload) {
    return fetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const text = await response.text()
      if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`)
      return JSON.parse(text)
    })
  },
  getEquipment: () => request('/api/admin/equipment/'),
  createEquipment: (payload) => request('/api/admin/equipment/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  deleteEquipment: (id) => request(`/api/admin/equipment/${encodeURIComponent(id)}/`, { method: 'DELETE' }),
  getEvents: (query = '') => request(`/reports/events${query}`),
  getDowntime: (query = '') => request(`/reports/downtime${query}`),
  getSummary: () => request('/reports/summary'),
  getReports: () => request('/reports/equipment'),
  getStatusDistribution: () => request('/reports/status-distribution'),
  getTimeline: (id, limit = 60) => request(`/reports/timeline/${encodeURIComponent(id)}?limit=${limit}`),
  getShiftSummary: () => request('/reports/shift-summary'),
  getEquipmentState: () => request('/reports/equipment-state'),
  getEquipmentLive: (onlineThresholdSec = 120) => request(`/reports/equipment-live?online_threshold_sec=${onlineThresholdSec}`),
  getCurrentDowntime: (query = '') => request(`/reports/downtime/current${query}`),
  createManualDowntime: (payload) => request('/reports/downtime/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  resolveManualDowntime: (payload) => request('/reports/downtime/manual/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  listRoles: () => request('/auth/roles'),
  createRole: (payload) => request('/auth/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
}
