import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import ToastContainer from '../shared/ToastContainer'

export default function Layout() {
  return (
    <div className="app-layout" id="app-layout">
      <Sidebar />
      <main className="app-main">
        <div className="app-content">
          <Outlet />
        </div>
      </main>
      <ToastContainer />
    </div>
  )
}
