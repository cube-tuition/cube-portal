'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { subjectConfig } from '../../../../../lib/resourceSubjects'
import TopicsManager from '../../../../../components/qbank/TopicsManager'

/*
 * Topics — /tutor/resources/<subject>/topics
 *
 * The subject's years & courses, topics, subtopics and skills (what questions
 * and workbooks are filed under), as its own page in the subject's Resources.
 */
export default function SubjectTopicsPage() {
  const { subject } = useParams()
  const slug = String(subject || '').toLowerCase()
  const cfg = subjectConfig(slug)
  if (!cfg) {
    return (
      <div className="min-h-screen bg-[#F8FAFF] flex items-center justify-center">
        <p className="text-sm text-[#2A2035]/50">Unknown subject. <Link href="/tutor" className="text-[#325099] underline">Back to home</Link></p>
      </div>
    )
  }
  return <TopicsManager scope={cfg.value} backHref={`/tutor/resources/${slug}`} backLabel={cfg.label} />
}
