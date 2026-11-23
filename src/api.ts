import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type {
  Activity,
  BoxRound,
  ClubDetail,
  ClubSummary,
  GroupDetail,
  GroupSummary,
  Match,
  Me,
  Page,
  Player,
} from '../shared/api'
import type { Settings } from '../shared/rating'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; type?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-boast': '1' }
  let payload: BodyInit | undefined
  if (init.raw !== undefined) {
    payload = init.raw
    if (init.type) headers['content-type'] = init.type
  } else if (init.body !== undefined) {
    payload = JSON.stringify(init.body)
    headers['content-type'] = 'application/json'
  }
  const res = await fetch(`/api${path}`, { method: init.method ?? 'GET', headers, body: payload, credentials: 'same-origin' })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`)
  return data as T
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
})

export function signIn(returnTo = location.pathname + location.search) {
  location.href = `/api/auth/google?return=${encodeURIComponent(returnTo)}`
}

export async function signOut() {
  await api('/auth/logout', { method: 'POST' })
  queryClient.clear()
  location.href = '/'
}

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me | null>('/me'), staleTime: 60_000 })

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), staleTime: 300_000 })

export function usePlayers() {
  const q = useQuery({ queryKey: ['players'], queryFn: () => api<Player[]>('/players') })
  const byId = useMemo(() => new Map((q.data ?? []).map((p) => [p.id, p])), [q.data])
  return { ...q, players: q.data ?? [], byId }
}

export const usePlayer = (key: string | undefined) =>
  useQuery({ queryKey: ['player', key], queryFn: () => api<Player>(`/players/${encodeURIComponent(key!)}`), enabled: !!key })

export interface MatchFilter {
  player?: string
  vs?: string
  club?: string
  group?: string
  status?: string
  limit?: number
}

const qs = (f: object) =>
  new URLSearchParams(Object.entries(f).filter(([, v]) => v != null && v !== '') as Array<[string, string]>).toString()

export function useMatches(filter: MatchFilter, opts: { enabled?: boolean; cursor?: string | null } = {}) {
  const f = { ...filter, cursor: opts.cursor ?? undefined }
  return useQuery({
    queryKey: ['matches', f],
    queryFn: () => api<Page<Match>>(`/matches?${qs(f)}`),
    enabled: opts.enabled ?? true,
    placeholderData: (prev) => prev,
  })
}

export const useActivity = (enabled: boolean) =>
  useQuery({ queryKey: ['activity'], queryFn: () => api<Activity>('/activity'), enabled, refetchInterval: 60_000 })

export const useClubs = () => useQuery({ queryKey: ['clubs'], queryFn: () => api<ClubSummary[]>('/clubs') })
export const useClub = (slug: string | undefined) =>
  useQuery({ queryKey: ['club', slug], queryFn: () => api<ClubDetail>(`/clubs/${slug}`), enabled: !!slug })
export const useGroups = () => useQuery({ queryKey: ['groups'], queryFn: () => api<GroupSummary[]>('/groups') })
export const useRounds = (groupId: string | undefined) =>
  useQuery({ queryKey: ['rounds', groupId], queryFn: () => api<BoxRound[]>(`/groups/${groupId}/rounds`), enabled: !!groupId })
export const useGroup = (slug: string | undefined) =>
  useQuery({ queryKey: ['group', slug], queryFn: () => api<GroupDetail>(`/groups/${slug}`), enabled: !!slug })

/** Anything that changes data can move levels, rankings and inboxes, so refresh broadly. */
export function invalidateAll() {
  return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'settings' })
}

export function useApiMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'settings' }),
  })
}
