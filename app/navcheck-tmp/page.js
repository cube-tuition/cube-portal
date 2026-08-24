'use client'
// TEMPORARY local harness for checking the workbook page navigator.
// Renders WorkbookDoc from hard-coded sample blocks — no database, no student
// data. Delete before committing.
import WorkbookDoc from '../../components/booklet/WorkbookDoc'

const para = (n) => `Sample body text for block ${n}. ` + 'The quick brown fox jumps over the lazy dog. '.repeat(14)
const blocks = []
let i = 0
const push = (b) => blocks.push({ id: `h_${++i}`, section: 'content', ...b })
push({ type: 'section', title: 'Weighing Molecules', number: '1', syllabus: '', syllabus_points: [] })
push({ type: 'subtopic', title: 'What a Mass Spectrum Tells You' })
push({ type: 'text', body: para(1) })
push({ type: 'question', prompt: 'First question with writing space.', lines: '8', parts: [], marks: '', solution: '' })
push({ type: 'subtopic', title: 'Inside the Instrument' })
push({ type: 'text', body: para(2) })
push({ type: 'question', prompt: 'Second question.', lines: '10', parts: [], marks: '', solution: '' })
push({ type: 'section', title: 'Reading a Mass Spectrum', number: '2', syllabus: '', syllabus_points: [] })
push({ type: 'subtopic', title: 'The Molecular Ion and the Base Peak' })
push({ type: 'text', body: para(3) })
push({ type: 'question', prompt: 'Third question.', lines: '12', parts: [], marks: '', solution: '' })
push({ type: 'subtopic', title: 'Counting Carbons' })
push({ type: 'text', body: para(4) })
push({ type: 'question', prompt: 'Fourth question.', lines: '12', parts: [], marks: '', solution: '' })
blocks.push({ id: 'h_hw1', section: 'homework', type: 'question', prompt: 'Homework question one.', lines: '14', parts: [], marks: '', solution: '' })
blocks.push({ id: 'h_hw2', section: 'homework', type: 'question', prompt: 'Homework question two.', lines: '14', parts: [], marks: '', solution: '' })
blocks.push({ id: 'h_rq1', section: 'revision', type: 'question', prompt: 'Quiz question.', lines: '16', parts: [], marks: '5', solution: '' })

export default function NavCheck() {
  return (
    <div className="min-h-screen bg-[#F8FAFF]">
      <div className="sticky top-0 h-[58px] bg-white border-b border-[#DEE7FF] flex items-center px-5 text-sm font-semibold text-[#325099] z-30">
        Navigator harness
      </div>
      <div className="max-w-[1330px] mx-auto px-5 py-5">
        <WorkbookDoc
          booklet={{ booklet_name: 'Nav Harness', year: 12, subject: 'Chemistry' }}
          blocks={blocks}
          classId={null}
          ownerId={null}
          mode="solutions"
          commentStudentId={null}
        />
      </div>
    </div>
  )
}
