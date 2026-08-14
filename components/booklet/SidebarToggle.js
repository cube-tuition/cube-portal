'use client'
import { useCallback, useSyncExternalStore } from 'react'

/*
 * Collapsing the workbook's side tabs.
 *
 * The booklet page is a fixed 794px wide with a 250px comment margin, so on a
 * laptop the tab rail is the first thing worth reclaiming. Collapsed, the rail
 * becomes a thin strip carrying just the reopen arrow — the tabs stay one click
 * away rather than disappearing behind a menu.
 *
 * The choice is remembered per browser, so a teacher who works collapsed stays
 * collapsed between lessons. It is read through useSyncExternalStore rather
 * than an effect: localStorage is external state, the server has none of it,
 * and this keeps the first paint honest (expanded) without a hydration
 * mismatch — while also syncing every open tab of the same booklet.
 */

const listeners = new Set()
const emit = () => listeners.forEach(l => l())

export function useSidebarCollapsed(storeKey) {
  const subscribe = useCallback((cb) => {
    listeners.add(cb)
    window.addEventListener('storage', cb)   // other tabs
    return () => { listeners.delete(cb); window.removeEventListener('storage', cb) }
  }, [])

  const collapsed = useSyncExternalStore(
    subscribe,
    () => { try { return localStorage.getItem(storeKey) === '1' } catch { return false } },
    () => false,   // server render: always expanded
  )

  const toggle = useCallback(() => {
    try { localStorage.setItem(storeKey, collapsed ? '0' : '1') } catch { /* storage blocked */ }
    emit()
  }, [storeKey, collapsed])

  return [collapsed, toggle]
}

/** The thin rail shown in place of the tabs, with the reopen arrow. */
export function SidebarRail({ onExpand }) {
  return (
    <aside className="w-[30px] shrink-0 sticky top-[58px]">
      <button
        onClick={onExpand}
        title="Show tabs"
        aria-label="Show tabs"
        aria-expanded={false}
        className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border border-[#DEE7FF]
                   bg-white text-[#325099] hover:border-[#325099] hover:bg-[#F8FAFF] transition"
      >
        <span className="text-sm leading-none">»</span>
      </button>
    </aside>
  )
}

/** The collapse arrow that sits above the tabs while they are showing. */
export function SidebarCollapseButton({ onCollapse }) {
  return (
    <button
      onClick={onCollapse}
      title="Hide tabs"
      aria-label="Hide tabs"
      aria-expanded
      className="w-full flex items-center justify-end gap-1 px-2 py-1 mb-1.5 rounded-lg
                 text-[10px] font-bold uppercase tracking-wider text-[#2A2035]/35
                 hover:text-[#325099] hover:bg-[#F8FAFF] transition"
    >
      Hide «
    </button>
  )
}
