import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/app/queryClient'
import { useAuth } from '@/app/auth-context'
import { getProfile, saveDisplayName } from '@/services/profile'

export function useProfile() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.profile(user?.id ?? 'none'),
    queryFn: () => getProfile(user!.id),
    enabled: !!user,
  })
}

export function useSaveDisplayName() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => saveDisplayName(user!.id, name),
    onSuccess: (profile) => qc.setQueryData(queryKeys.profile(profile.id), profile),
  })
}
