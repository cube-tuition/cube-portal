'use client'
import { createContext, useContext } from 'react'

/*
 * Shared context for the /tutor/hub section.
 * Kept in its own file so layout.js and all child pages import the same
 * module instance — avoids Next.js code-splitting creating two copies of
 * HubContext (which would cause useHub() to return the default value).
 */
export const HubContext = createContext({ staff: null, isAdmin: false, canEdit: false, loading: true })
export function useHub() { return useContext(HubContext) }
