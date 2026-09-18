'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

/*
 * /forms/[slug] — a public form families fill in (no login). The definition
 * comes from /api/forms/[slug]; the submission goes back the same way.
 */

export default function PublicFormPage() {
  const { slug } = useParams()
  const [form, setForm] = useState(null)
  const [state, setState] = useState('loading')   // loading | ready | missing | submitting | done
  const [values, setValues] = useState({})
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!slug) return
    fetch(`/api/forms/${slug}`).then(async r => {
      if (!r.ok) { setState('missing'); return }
      const f = await r.json(); setForm(f); setState('ready')
    }).catch(() => setState('missing'))
  }, [slug])

  const set = (key, v) => { setValues(x => ({ ...x, [key]: v })); setErrors(e => { const n = { ...e }; delete n[key]; return n }) }
  const toggle = (key, opt) => {
    const cur = Array.isArray(values[key]) ? values[key] : []
    set(key, cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt])
  }

  const submit = async (e) => {
    e.preventDefault()
    setState('submitting'); setMessage('')
    try {
      const r = await fetch(`/api/forms/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: values }) })
      const b = await r.json()
      if (!r.ok) { setErrors(b.errors || {}); setMessage(b.error || 'Something went wrong.'); setState('ready'); return }
      setMessage(b.confirmation || 'Thank you — we have received your form.'); setState('done')
    } catch { setMessage('Something went wrong — please try again.'); setState('ready') }
  }

  const input = (key) => `w-full border rounded-xl px-3.5 py-2.5 text-sm text-[#2A2035] bg-white focus:outline-none focus:border-[#325099] ${errors[key] ? 'border-rose-300' : 'border-[#DEE7FF]'}`
  const renderField = (f) => {
    const opts = f.options || []
    if (f.type === 'textarea') return <textarea value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)} rows={4} placeholder={f.placeholder || ''} className={`${input(f.key)} resize-y`} />
    if (f.type === 'select') return (
      <select value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)} className={input(f.key)}>
        <option value="">Select…</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>)
    if (f.type === 'radio') return (
      <div className="flex flex-wrap gap-2">
        {opts.map(o => (
          <label key={o} className={`flex items-center gap-2 border rounded-xl px-3 py-2 text-sm cursor-pointer ${values[f.key] === o ? 'border-[#325099] bg-[#EEF4FF]' : 'border-[#DEE7FF] bg-white'}`}>
            <input type="radio" name={f.key} checked={values[f.key] === o} onChange={() => set(f.key, o)} className="accent-[#325099]" />{o}
          </label>))}
      </div>)
    if (f.type === 'checkboxes') return (
      <div className="flex flex-wrap gap-2">
        {opts.map(o => {
          const on = Array.isArray(values[f.key]) && values[f.key].includes(o)
          return (
            <label key={o} className={`flex items-center gap-2 border rounded-xl px-3 py-2 text-sm cursor-pointer ${on ? 'border-[#325099] bg-[#EEF4FF]' : 'border-[#DEE7FF] bg-white'}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(f.key, o)} className="accent-[#325099]" />{o}
            </label>)
        })}
      </div>)
    return <input type={['email', 'tel', 'number', 'date'].includes(f.type) ? f.type : 'text'} value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder || ''} className={input(f.key)} />
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#2A2035]">
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-[#DEE7FF]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-2xl md:text-[1.65rem] font-bold tracking-tight text-[#062E63] font-display">CUBE</span>
            <span className="hidden sm:inline-block text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold pt-0.5">Tuition</span>
          </Link>
        </div>
      </header>
      <section className="flex-1 bg-gradient-to-br from-[#F8FAFF] via-[#EEF4FF] to-[#BFD1FF]">
        <div className="max-w-xl mx-auto px-6 py-12 md:py-16">
          <div className="bg-white rounded-2xl border border-[#DEE7FF] shadow-[0_8px_30px_-12px_rgba(50,80,153,0.18)] p-7 md:p-8">
            {state === 'loading' && <p className="text-sm text-[#2A2035]/60 text-center py-6">Loading…</p>}
            {state === 'missing' && (
              <>
                <h1 className="text-xl font-bold text-[#062E63] mb-2">Form not available</h1>
                <p className="text-sm text-[#2A2035]/70">This form is closed or the link is incorrect. Please contact us at <a className="text-[#325099] underline" href="mailto:admin@cubetuition.com.au">admin@cubetuition.com.au</a>.</p>
              </>
            )}
            {state === 'done' && (
              <>
                <h1 className="text-xl font-bold text-[#062E63] mb-2">Thank you</h1>
                <p className="text-sm text-[#2A2035]/75 leading-relaxed">{message}</p>
              </>
            )}
            {(state === 'ready' || state === 'submitting') && form && (
              <form onSubmit={submit} noValidate>
                <p className="text-[10px] tracking-[0.3em] uppercase text-[#325099] font-semibold mb-2 font-display">CUBE Tuition</p>
                <h1 className="text-2xl font-bold text-[#062E63] mb-2 font-display">{form.title}</h1>
                {form.description && <p className="text-sm text-[#2A2035]/70 leading-relaxed mb-6">{form.description}</p>}
                <div className="space-y-5">
                  {(form.fields || []).map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold text-[#325099] mb-1.5">{f.label}{f.required && <span className="text-rose-500"> *</span>}</label>
                      {renderField(f)}
                      {errors[f.key] && <p className="text-[11px] text-rose-600 mt-1">{errors[f.key]}</p>}
                    </div>
                  ))}
                </div>
                {message && <p className="text-sm text-rose-600 mt-5">{message}</p>}
                <button type="submit" disabled={state === 'submitting'}
                  className="mt-7 w-full bg-[#062E63] text-white text-sm font-bold rounded-xl px-5 py-3 hover:bg-[#325099] transition disabled:opacity-50">
                  {state === 'submitting' ? 'Sending…' : 'Submit'}
                </button>
              </form>
            )}
          </div>
          <p className="text-center text-[11px] text-[#325099]/60 mt-6">Questions? Email <a className="underline" href="mailto:admin@cubetuition.com.au">admin@cubetuition.com.au</a></p>
        </div>
      </section>
    </div>
  )
}
