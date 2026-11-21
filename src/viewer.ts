import { useMemo } from 'react'
import type { Player } from '../shared/api'
import { useMe } from './api'

/** The signed-in user plus client-side mirrors of the server's permission rules. */
export function useViewer() {
  const { data: me, isLoading } = useMe()
  return useMemo(() => {
    const isAdmin = !!me?.user.isAdmin
    const clubs = new Set(me?.clubAdminSlugs ?? [])
    const groups = Object.values(me?.groupAdminScope ?? {}).map((ids) => new Set(ids))
    const isClubAdminFor = (p: Pick<Player, 'clubSlug'> | undefined) => !!p?.clubSlug && clubs.has(p.clubSlug)
    return {
      me: me ?? null,
      loading: isLoading,
      signedIn: !!me,
      isAdmin,
      myPlayer: me?.player ?? null,
      needsOnboarding: !!me && !me.player,
      hasAdminScope: isAdmin || clubs.size > 0 || groups.length > 0,
      isClubAdminFor,
      canEditPlayer: (p: Player | undefined) => isAdmin || isClubAdminFor(p),
      canWriteMatch: (a: Player | undefined, b: Player | undefined) =>
        isAdmin ||
        isClubAdminFor(a) ||
        isClubAdminFor(b) ||
        (!!a && !!b && groups.some((g) => g.has(a.id) && g.has(b.id))),
    }
  }, [me, isLoading])
}
