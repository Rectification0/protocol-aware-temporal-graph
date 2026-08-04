import type { ComponentType } from 'react'
import {
  Activity,
  BarChart3,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldAlert,
} from 'lucide-react'

// Single source of truth for the app's top-level routes (tasks.md F2.1) --
// F5.2's Sidebar builds its nav links from NAV_ROUTES rather than
// duplicating this list, so the two can't drift out of sync.

export const ROUTES = {
  home: '/',
  analytics: '/analytics',
  investigation: '/investigation/:entityId',
  detections: '/detections',
  logs: '/logs',
  monitoring: '/monitoring',
  settings: '/settings',
  login: '/login',
} as const

export interface NavRouteMeta {
  path: string
  label: string
  icon: ComponentType<{ className?: string }>
}

// `/investigation/:entityId` (a drill-down detail route reached from
// elsewhere, not a static destination) and `/login` (outside the
// authenticated app shell) are deliberately not nav links.
export const NAV_ROUTES: NavRouteMeta[] = [
  { path: ROUTES.home, label: 'Overview', icon: LayoutDashboard },
  { path: ROUTES.analytics, label: 'Analytics', icon: BarChart3 },
  { path: ROUTES.detections, label: 'Detections', icon: ShieldAlert },
  { path: ROUTES.logs, label: 'Logs', icon: ScrollText },
  { path: ROUTES.monitoring, label: 'Monitoring', icon: Activity },
  { path: ROUTES.settings, label: 'Settings', icon: Settings },
]

export function investigationPath(entityId: string): string {
  return `/investigation/${encodeURIComponent(entityId)}`
}
