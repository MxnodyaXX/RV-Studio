import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context'
import { RedirectIfAdmin, RequireAdmin } from './RequireAdmin'

function authValue(status: AuthStatus, extra: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status,
    session: null,
    user: null,
    signedOutReason: null,
    passwordRecovery: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    retry: vi.fn(),
    clearPasswordRecovery: vi.fn(),
    ...extra,
  }
}

function LocationProbe({ label }: { label: string }) {
  const loc = useLocation()
  return (
    <div>
      {label}:{loc.pathname}
      {loc.search}
    </div>
  )
}

function renderAt(path: string, value: AuthContextValue) {
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LocationProbe label="login" />} />
          <Route path="/unauthorized" element={<LocationProbe label="unauthorized" />} />
          <Route element={<RequireAdmin />}>
            <Route path="/" element={<div>secret dashboard</div>} />
            <Route path="/transactions" element={<div>secret transactions</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('RequireAdmin route guard', () => {
  it('shows a loading state while the session is verified, without protected content', () => {
    renderAt('/', authValue('loading'))
    expect(screen.getByRole('status')).toHaveTextContent('Verifying your session')
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })

  it('redirects signed-out visitors to login', () => {
    renderAt('/transactions', authValue('signed_out'))
    expect(screen.getByText('login:/login')).toBeInTheDocument()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })

  it('flags expired sessions on the login redirect', () => {
    renderAt('/', authValue('signed_out', { signedOutReason: 'expired' }))
    expect(screen.getByText('login:/login?reason=expired')).toBeInTheDocument()
  })

  it('sends authenticated non-admins to the unauthorized page', () => {
    renderAt('/', authValue('unauthorized'))
    expect(screen.getByText('unauthorized:/unauthorized')).toBeInTheDocument()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })

  it('shows a retry state when access cannot be verified', () => {
    renderAt('/', authValue('error'))
    expect(screen.getByText('Unable to verify access')).toBeInTheDocument()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })

  it('renders protected routes for the administrator', () => {
    renderAt('/transactions', authValue('admin'))
    expect(screen.getByText('secret transactions')).toBeInTheDocument()
  })
})

describe('RedirectIfAdmin', () => {
  function renderLogin(value: AuthContextValue) {
    return render(
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<RedirectIfAdmin><div>login form</div></RedirectIfAdmin>} />
            <Route path="/" element={<div>dashboard</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )
  }

  it('keeps the admin away from the login page', () => {
    renderLogin(authValue('admin'))
    expect(screen.getByText('dashboard')).toBeInTheDocument()
  })

  it('shows login to signed-out visitors', () => {
    renderLogin(authValue('signed_out'))
    expect(screen.getByText('login form')).toBeInTheDocument()
  })
})
