import Link from 'next/link'
import CubeLogo from '../../components/CubeLogo'

/*
 * /privacy — the portal's privacy policy. Public: Apple requires a privacy
 * policy URL for the iPhone app, and families should be able to read it.
 * Keep it factual: it describes what the portal actually stores and which
 * services handle it. Update it when a new service or data type is added.
 */
export const metadata = {
  title: 'Privacy Policy · CUBE Tuition',
  description: 'How the CUBE Tuition portal and app handle personal information.',
}

const UPDATED = '22 October 2026'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFF] text-[#2A2035]">
      <header className="bg-white border-b border-[#DEE7FF]">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center gap-2.5">
          <CubeLogo className="h-7 w-auto text-[#062E63]" />
          <Link href="/" className="text-xl font-bold tracking-tight text-[#062E63] font-display">CUBE</Link>
          <span className="text-[10px] tracking-[0.3em] uppercase text-[#325099]/70 font-semibold pt-0.5">Tuition</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-10 text-[15px] leading-relaxed">
        <h1 className="text-3xl font-bold text-[#062E63] font-display">Privacy Policy</h1>
        <p className="text-sm text-[#2A2035]/55 mt-1 mb-8">CUBE Tuition · Chatswood, NSW · Last updated {UPDATED}</p>

        <p>
          This policy covers the CUBE Tuition portal (portal.cubetuition.com.au) and the CUBE
          iPhone app, which is the same portal in an app. It explains what personal information we
          collect, why, who handles it for us, and how to ask about it. We handle personal
          information in line with the Australian Privacy Principles.
        </p>

        <Section title="Who uses the portal">
          <p>
            Students and their parents or guardians, and CUBE staff (teachers and directors).
            Accounts are created by CUBE when a student enrols or a teacher joins — there is no
            self-service sign-up.
          </p>
        </Section>

        <Section title="What we collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Contact and enrolment details</strong> — student and parent names, email addresses, phone numbers, school and year level, classes enrolled in, and the term each enrolment runs.</li>
            <li><strong>Learning records</strong> — attendance, homework, quiz and exam results, teacher comments and term reports, and work completed in online workbooks.</li>
            <li><strong>Messages</strong> — text messages exchanged with the CUBE office number, chat messages between staff (and, where a class channel is open to students, with students), and the names of the people in each conversation.</li>
            <li><strong>Billing</strong> — invoices, payment status and credits for each family. We do not store card numbers.</li>
            <li><strong>Staff records</strong> — teaching availability, lessons taught and pay details, for the staff member concerned.</li>
            <li><strong>Technical data</strong> — sign-in times, pages used, and, if you turn notifications on, a device token that lets us send notifications to your phone. We do not use advertising identifiers and we do not track you across other apps or websites.</li>
          </ul>
        </Section>

        <Section title="Why we collect it">
          <p>
            To run the tuition service: timetabling classes, marking rolls, sharing materials and
            results, invoicing, communicating with families and staff, paying teachers, and sending
            the notifications you have asked for. We do not sell personal information and we do not
            use it for advertising.
          </p>
        </Section>

        <Section title="Who handles it for us">
          <p>Our service providers process data only to provide their service to CUBE:</p>
          <ul className="list-disc pl-5 space-y-1.5 mt-2">
            <li><strong>Supabase</strong> — the portal’s database and file storage.</li>
            <li><strong>Vercel</strong> — hosting for the portal.</li>
            <li><strong>Twilio</strong> — text messages and calls on the CUBE office number.</li>
            <li><strong>Resend</strong> — emails sent by the portal (reports, invoices, logins).</li>
            <li><strong>Xero</strong> — accounting and payroll.</li>
            <li><strong>Apple</strong> — delivering notifications to the iPhone app.</li>
          </ul>
          <p className="mt-2">Some of these providers store data outside Australia (for example in the United States).</p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Learning records and billing history are kept while a student is enrolled and for as
            long as we are required to keep business records afterwards. Messages are kept so that
            staff can refer back to them. Accounts that are no longer needed are closed by CUBE.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Access to the portal needs a personal login. Each person sees only what their role
            allows — a student their own results, a teacher their own classes and pay, directors
            the records needed to run CUBE — and that is enforced by the database itself, not just
            by the screens. Passwords are stored only as hashes; CUBE staff cannot see them.
          </p>
        </Section>

        <Section title="Your choices and rights">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>You can ask to see or correct the personal information we hold about you or your child.</li>
            <li>Notifications are optional; turn them off in your phone’s settings at any time.</li>
            <li>You can ask us to close an account. We will close it and remove the data we are not required to keep.</li>
          </ul>
          <p className="mt-2">
            To do any of these, or to ask a question or make a complaint, email{' '}
            <a href="mailto:admin@cubetuition.com.au" className="text-[#325099] underline">admin@cubetuition.com.au</a>.
            If you are not satisfied with our response you can contact the Office of the Australian
            Information Commissioner (oaic.gov.au).
          </p>
        </Section>

        <Section title="Children">
          <p>
            Many of our students are under 18. Their accounts are set up with a parent or
            guardian’s knowledge as part of enrolment, and parents can ask about their child’s
            information at any time using the contact above.
          </p>
        </Section>

        <Section title="Changes">
          <p>We will update this page if what we collect or how we handle it changes, and show the date at the top.</p>
        </Section>

        <p className="mt-10 text-xs text-[#2A2035]/45">© CUBE Tuition · Chatswood</p>
      </main>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-[#062E63] mb-2">{title}</h2>
      {children}
    </section>
  )
}
