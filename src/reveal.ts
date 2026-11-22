/**
 * Scroll reveal: cards (and anything marked data-reveal) that are added below the fold
 * fade and slide up as they scroll into view. Content already on screen is left alone,
 * so nothing flickers, and it does nothing when the user prefers reduced motion.
 */
const SELECTOR = '.card, [data-reveal]'

export function startReveal(root: HTMLElement) {
  if (typeof IntersectionObserver === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-visible')
        io.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -32px 0px', threshold: 0.05 },
  )
  const consider = (el: Element) => {
    if (el.classList.contains('reveal') || el.closest('[role="dialog"], [role="status"], [role="menu"]')) return
    if (el.getBoundingClientRect().top < window.innerHeight) return
    el.classList.add('reveal')
    io.observe(el)
  }
  const scan = (node: Node) => {
    if (!(node instanceof Element)) return
    if (node.matches(SELECTOR)) consider(node)
    node.querySelectorAll(SELECTOR).forEach(consider)
  }
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach(scan)
  }).observe(root, { childList: true, subtree: true })
}
