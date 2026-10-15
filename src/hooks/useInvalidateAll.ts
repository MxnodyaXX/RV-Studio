import { useQueryClient } from '@tanstack/react-query'

/** Refreshes every cached query after a successful write. */
export function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries()
}
