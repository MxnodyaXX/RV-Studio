// Maps Supabase/PostgREST errors to messages that are safe and useful to show.

type MaybeError = { code?: string; message?: string; status?: number; name?: string } | null | undefined

export class AppError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

/** True for errors meaning the session is no longer valid. */
export function isAuthError(error: unknown): boolean {
  const e = error as MaybeError
  if (!e) return false
  return (
    e.code === 'PGRST301' || // JWT expired / invalid
    e.code === 'PGRST302' ||
    e.status === 401 ||
    /jwt expired/i.test(e.message ?? '')
  )
}

export function toUserMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = error as MaybeError
  if (!e) return fallback
  if (e instanceof AppError) return e.message
  if (isAuthError(e)) return 'Your session has expired. Please sign in again.'
  switch (e.code) {
    case '42501':
      return 'You are not authorised to perform this action.'
    case '23505':
      return 'This record already exists. It may have been saved already.'
    case '23503':
      return 'The selected category does not match the transaction type, or a linked record no longer exists.'
    case '23514':
      return 'The data failed validation. Please check the values and try again.'
    case '22023':
      return e.message ?? fallback
    case 'PGRST116':
      return 'The record could not be found. It may have been deleted.'
  }
  if (e.name === 'TypeError' && /fetch/i.test(e.message ?? '')) {
    return 'Network error. Check your internet connection and try again.'
  }
  return fallback
}

/** Normalises any thrown value to an Error for TanStack Query. */
export function asError(error: unknown): Error {
  if (error instanceof Error) return error
  const e = error as MaybeError
  const err = new AppError(toUserMessage(error), e?.code)
  return err
}
