'use client'
import { useRef } from 'react'
import { qbankImageUrl } from '../../lib/qbank'

/*
 * ImageManager — manage the figures attached to a question.
 *
 * Works with a flat array of image items the parent holds in state:
 *   existing: { id, storage_path, alt }
 *   new:      { _new: true, file, previewUrl, alt }
 * Removing an existing image flags it (the parent collects ids to delete on
 * save); removing a new one just drops it from the array.
 */
export default function ImageManager({ images, onChange, label = 'Figures / images' }) {
  const inputRef = useRef(null)

  const addFiles = (fileList) => {
    const next = [...images]
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith('image/')) return
      next.push({ _new: true, file, previewUrl: URL.createObjectURL(file), alt: '' })
    })
    onChange(next)
  }

  const removeAt = (idx) => {
    const next = images.filter((_, i) => i !== idx)
    onChange(next)
  }

  const setAlt = (idx, alt) => {
    const next = images.map((img, i) => (i === idx ? { ...img, alt } : img))
    onChange(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-[#062E63]">{label}</label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-[11px] font-semibold text-[#325099] hover:text-[#062E63]"
        >
          + Add image
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
      />

      {images.length === 0 ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border border-dashed border-[#DEE7FF] bg-[#F8FAFF] px-3 py-6 text-center text-xs text-[#2A2035]/40 cursor-pointer hover:border-[#325099]"
        >
          Drag images here or click to upload
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {images.map((img, idx) => {
            const src = img._new ? img.previewUrl : qbankImageUrl(img.storage_path)
            return (
              <div key={img.id || `new-${idx}`} className="rounded-xl border border-[#DEE7FF] bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={img.alt || ''} className="w-full h-24 object-contain rounded-lg bg-[#F8FAFF]" />
                <input
                  value={img.alt || ''}
                  onChange={(e) => setAlt(idx, e.target.value)}
                  placeholder="alt text"
                  className="w-full mt-1.5 border border-[#DEE7FF] rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-[#325099]"
                />
                <button
                  type="button"
                  onClick={() => removeAt(idx)}
                  className="w-full mt-1 text-[11px] text-[#DC2626] hover:underline"
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
