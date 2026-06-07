'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import TutorNav from '../../../components/TutorNav'
import Link from 'next/link'

const PLACEHOLDERS = [
  { tag: '{{guardian}}',      desc: "Guardian's first name" },
  { tag: '{{studentNames}}',  desc: 'Student name(s)' },
  { tag: '{{term}}',          desc: 'Term name (e.g. Term 1 2025)' },
  { tag: '{{invNo}}',         desc: 'Invoice number' },
  { tag: '{{amount}}',        desc: 'Amount due' },
  { tag: '{{dueDate}}',       desc: 'Due date' },
]

export default function SettingsPage() {
  const [profile,  setProfile]  = useState(null)
  const [template, setTemplate] = useState('')
  const [subject,  setSubject]  = useState('')
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('directors').select('full_name').eq('user_id', user.id).maybeSingle()
        .then(({ data }) => setProfile(data))
    })
    supabase.from('portal_settings')
      .select('key, value')
      .in('key', ['invoice_email_template', 'invoice_email_subject'])
      .then(({ data }) => {
        if (data) {
          const map = Object.fromEntries(data.map(r => [r.key, r.value]))
          setTemplate(map.invoice_email_template || '')
          setSubject(map.invoice_email_subject || '')
        }
        setLoading(false)
      })
  }, [])

  const handleSave = async () => {
    setSaving(true); setError(null); setSaved(false)
    try {
      const { error: e1 } = await supabase.from('portal_settings')
        .upsert({ key: 'invoice_email_template', value: template, updated_at: new Date().toISOString() })
      const { error: e2 } = await supabase.from('portal_settings')
        .upsert({ key: 'invoice_email_subject', value: subject, updated_at: new Date().toISOString() })
      if (e1 || e2) throw new Error((e1 || e2).message)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <TutorNav staffName={profile?.full_name} isAdmin />

      <div className="max-w-3xl mx-auto px-6 pt-10 pb-24">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/tutor/database" className="text-sm text-[#325099]/50 hover:text-[#325099] transition">← Database</Link>
        </div>
        <h1 className="text-2xl font-bold text-[#062E63] mb-1">Settings</h1>
        <p className="text-sm text-[#325099]/60 mb-8">Manage portal-wide configuration.</p>

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="w-6 h-6 border-2 border-[#325099] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white border border-[#DEE7FF] rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-sm font-bold text-[#062E63] mb-4">Invoice email template</h2>

              {/* Placeholder reference */}
              <div className="bg-[#F8FAFF] border border-[#DEE7FF] rounded-xl px-4 py-3 mb-4">
                <p className="text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-2">Available placeholders · use <code className="font-mono">**text**</code> for bold</p>
                <div className="flex flex-wrap gap-3">
                  {PLACEHOLDERS.map(p => (
                    <div key={p.tag} className="flex items-center gap-1.5">
                      <code className="text-[11px] font-mono bg-white border border-[#DEE7FF] rounded px-1.5 py-0.5 text-[#325099]">{p.tag}</code>
                      <span className="text-[11px] text-[#325099]/50">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subject */}
              <div className="mb-3">
                <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Subject line</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-sm text-[#062E63] focus:outline-none focus:border-[#325099]"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-[11px] font-semibold text-[#325099]/60 uppercase tracking-wider mb-1">Email body</label>
                <textarea
                  value={template}
                  onChange={e => setTemplate(e.target.value)}
                  rows={22}
                  className="w-full border border-[#DEE7FF] rounded-lg px-3 py-2 text-xs text-[#062E63] font-mono resize-y focus:outline-none focus:border-[#325099]"
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex items-center gap-3 pt-1">
              <button onClick={handleSave} disabled={saving}
                className="text-xs font-semibold bg-[#062E63] text-white px-6 py-2 rounded-full hover:bg-[#325099] transition disabled:opacity-40">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
