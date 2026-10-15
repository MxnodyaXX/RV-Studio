import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './auth-context'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  authSignOut: vi.fn(),
  checkIsAdmin: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
}))

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: mocks.authSignOut,
    },
  },
}))

vi.mock('@/services/auth', () => ({
  checkIsAdmin: mocks.checkIsAdmin,
  signOut: mocks.signOut,
  signInWithPassword: mocks.signInWithPassword,
}))

const session = (id: string) => ({ user: { id, email: `${id}@test.local` }, access_token: 't' })

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="reason">{auth.signedOutReason ?? ''}</span>
      <button onClick={() => auth.signIn('a@b.c', 'pw').catch((e: Error) => (document.title = e.message))}>login</button>
    </div>
  )
}

function renderProvider(qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

let authCallback: (event: string, s: unknown) => void

beforeEach(() => {
  vi.clearAllMocks()
  document.title = ''
  mocks.onAuthStateChange.mockImplementation((cb) => {
    authCallback = cb
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  mocks.signOut.mockResolvedValue(undefined)
})

describe('AuthProvider', () => {
  it('is signed out without a session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed_out'))
    expect(mocks.checkIsAdmin).not.toHaveBeenCalled()
  })

  it('grants access only after the server confirms the allowlisted admin', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: session('admin') } })
    mocks.checkIsAdmin.mockResolvedValue(true)
    renderProvider()
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('admin'))
  })

  it('signs out an authenticated user who is not the administrator', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: session('intruder') } })
    mocks.checkIsAdmin.mockResolvedValue(false)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthorized'))
    expect(mocks.signOut).toHaveBeenCalled()
  })

  it('reports an error state if access cannot be verified', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: session('admin') } })
    mocks.checkIsAdmin.mockRejectedValue(new TypeError('Failed to fetch'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'))
  })

  it('treats an unexpected SIGNED_OUT as an expired session and clears cached data', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: session('admin') } })
    mocks.checkIsAdmin.mockResolvedValue(true)
    const qc = new QueryClient()
    qc.setQueryData(['finance', 'x'], { secret: 1 })
    renderProvider(qc)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('admin'))

    act(() => authCallback('SIGNED_OUT', null))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed_out'))
    expect(screen.getByTestId('reason')).toHaveTextContent('expired')
    expect(qc.getQueryData(['finance', 'x'])).toBeUndefined()
  })

  it('rejects sign-in for a non-admin account and signs it out', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    mocks.signInWithPassword.mockResolvedValue(session('intruder'))
    mocks.checkIsAdmin.mockResolvedValue(false)
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed_out'))
    await act(async () => screen.getByText('login').click())
    await waitFor(() => expect(document.title).toMatch(/not authorised/))
    expect(mocks.signOut).toHaveBeenCalled()
    expect(screen.getByTestId('status')).not.toHaveTextContent('admin')
  })
})
