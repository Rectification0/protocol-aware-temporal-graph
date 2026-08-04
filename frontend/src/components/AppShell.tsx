import { Outlet } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { Sidebar } from '@/components/Sidebar'

// F2.2: Navbar + Sidebar + content outlet. This is the root layout route
// for every authenticated page -- /login (outside the shell) is not a
// child of this route.

export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col">
      <Navbar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
