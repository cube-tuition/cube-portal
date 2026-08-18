'use client'
import { useEffect, useState } from 'react'
import { fetchModuleNames } from '../../lib/syllabus'
import { isChemistry, chemModuleNumber, chemModuleLabel } from '../../lib/format'

/*
 * Chemistry booklets are filed by MODULE, not by topic, and the module is read
 * off the name ("M3L2" → module 3). This hook hands a screen the labeller it
 * needs: `groupLabel(booklet)` gives "Module 3: Reactive Chemistry" for
 * Chemistry and the booklet's own topic for every other subject, so a list can
 * show one secondary label without caring which it is.
 *
 * The names come from the master syllabus and are cached for the session, so
 * mounting this in several lists costs one fetch.
 */
export default function useChemModules() {
  const [names, setNames] = useState({})
  useEffect(() => {
    let live = true
    fetchModuleNames('Chemistry').then(m => { if (live) setNames(m) })
    return () => { live = false }
  }, [])

  // The label a booklet files under: its module (Chemistry) or its topic.
  const groupLabel = (b) => {
    if (!isChemistry(b?.subject)) return b?.topic || ''
    const n = chemModuleNumber(b?.booklet_name || b?.title)
    return n == null ? '' : chemModuleLabel(n, names)
  }
  return { moduleNames: names, groupLabel }
}
