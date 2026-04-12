import { useNavigate } from 'react-router-dom';
import { Brain, ArrowLeft } from 'lucide-react';

const EFFECTIVE_DATE = '1 April 2025';
const COMPANY = 'Rasi Cyber Solutions Private Limited';
const PRODUCT = 'Zapheit';
const CONTACT_EMAIL = 'legal@zapheit.com';

export default function TermsPage() {
  const navigate = useNavigate();
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-[#050d1a] text-slate-300">
      {/* Nav */}
      <nav className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white">Zapheit</span>
          </button>
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
          <p className="text-slate-500 text-sm">Effective date: {EFFECTIVE_DATE}</p>
        </div>

        <div className="space-y-10 text-sm leading-7">

          <section>
            <p>
              These Terms of Service ("Terms") govern your access to and use of {PRODUCT}, a product of {COMPANY} ("we", "us", "our"). By creating an account or using the platform, you agree to these Terms. If you do not agree, do not use the service.
            </p>
          </section>

          <Section title="1. The Service">
            <p>
              {PRODUCT} is an AI agent governance platform. It lets organisations connect, monitor, and control AI agents — tracking usage, costs, incidents, and policy compliance through a single dashboard.
            </p>
            <p className="mt-3">
              We reserve the right to update, modify, or discontinue any part of the service at any time with reasonable notice.
            </p>
          </Section>

          <Section title="2. Eligibility">
            <p>
              You must be at least 18 years old and have the authority to enter into these Terms on behalf of your organisation. By using {PRODUCT}, you confirm that the information you provide is accurate and up to date.
            </p>
          </Section>

          <Section title="3. Your Account">
            <ul className="list-disc pl-5 space-y-2">
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>You must notify us immediately if you suspect unauthorised access to your account.</li>
              <li>Each account is for a single organisation. Do not share access credentials across organisations.</li>
              <li>We may suspend or terminate accounts that violate these Terms.</li>
            </ul>
          </Section>

          <Section title="4. Acceptable Use">
            <p>You agree not to use {PRODUCT} to:</p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>Violate any applicable law or regulation, including India's Information Technology Act 2000 and the Digital Personal Data Protection Act 2023 (DPDPA).</li>
              <li>Transmit malware, spam, or any harmful code through the LLM gateway.</li>
              <li>Reverse-engineer, decompile, or attempt to extract the source code of the platform.</li>
              <li>Use the service to process data in a way that violates the rights of individuals.</li>
              <li>Resell or sublicense the service without our written consent.</li>
            </ul>
          </Section>

          <Section title="5. Your Data">
            <p>
              You retain full ownership of all data you bring into {PRODUCT} — including agent conversations, incident logs, cost records, and any data processed through the LLM gateway. We act as a data processor on your behalf.
            </p>
            <p className="mt-3">
              By using the service, you grant us a limited licence to process your data solely to provide the service to you. We do not sell your data or use it to train our own models.
            </p>
            <p className="mt-3">
              You are responsible for ensuring that the data you process through {PRODUCT} complies with applicable privacy laws, including obtaining any necessary consents from individuals whose data may pass through the platform.
            </p>
          </Section>

          <Section title="6. Data Security">
            <p>
              We implement industry-standard security measures including encryption at rest and in transit, row-level security on our database, JWT-based authentication, and audit logging. However, no system is completely secure. We cannot guarantee that data breaches will never occur, and we are not liable for breaches caused by factors outside our reasonable control.
            </p>
          </Section>

          <Section title="7. Billing and Payment">
            <p>
              Billing terms, if applicable to your plan, will be specified in a separate Order Form or on the pricing page. All fees are in Indian Rupees (INR) unless stated otherwise. Fees are non-refundable except as required by law or as explicitly stated in your plan.
            </p>
            <p className="mt-3">
              We may suspend access if payment is overdue by more than 15 days after providing notice.
            </p>
          </Section>

          <Section title="8. Intellectual Property">
            <p>
              {COMPANY} owns all rights to the {PRODUCT} platform, including its software, design, trademarks, and documentation. These Terms do not grant you any ownership rights. You may not use our name, logo, or trademarks without our written permission.
            </p>
          </Section>

          <Section title="9. Third-Party Services">
            <p>
              {PRODUCT} integrates with third-party services (OpenAI, Anthropic, Supabase, and others). Your use of those services is subject to their own terms and privacy policies. We are not responsible for the practices of third-party providers.
            </p>
          </Section>

          <Section title="10. Limitation of Liability">
            <p>
              To the maximum extent permitted by law, {COMPANY} is not liable for any indirect, incidental, consequential, or punitive damages arising from your use of the service, including but not limited to loss of data, revenue, or business opportunities.
            </p>
            <p className="mt-3">
              Our total liability to you for any claim arising from these Terms shall not exceed the amount you paid us in the three months preceding the claim.
            </p>
          </Section>

          <Section title="11. Indemnification">
            <p>
              You agree to indemnify and hold {COMPANY} harmless from any claims, losses, or damages (including legal fees) arising from your violation of these Terms, your use of the service, or your infringement of any third-party rights.
            </p>
          </Section>

          <Section title="12. Termination">
            <p>
              Either party may terminate these Terms with 30 days written notice. We may terminate immediately if you materially breach these Terms. Upon termination, your access to the service will cease and we will delete your data within 30 days unless retention is required by law.
            </p>
            <p className="mt-3">
              You may export your data at any time before termination using the tools available in the platform.
            </p>
          </Section>

          <Section title="13. Governing Law">
            <p>
              These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts of Howrah, West Bengal, India.
            </p>
          </Section>

          <Section title="14. Changes to These Terms">
            <p>
              We may update these Terms from time to time. We will notify you of material changes via email or a notice in the platform at least 14 days before the changes take effect. Continued use of the service after that date constitutes acceptance of the revised Terms.
            </p>
          </Section>

          <Section title="15. Contact Us">
            <p>
              For questions about these Terms, contact us at:
            </p>
            <div className="mt-3 p-4 rounded-xl border border-slate-700 bg-white/[0.02] space-y-1">
              <p className="text-slate-300 font-medium">{COMPANY}</p>
              <p>PH-II GR FL, BL-B 20, Round Tank Ln, Howrah, West Bengal 711101, India</p>
              <p>Mobile: +91-9433116259</p>
              <p>Email: <a href={`mailto:${CONTACT_EMAIL}`} className="text-cyan-400 hover:underline">{CONTACT_EMAIL}</a></p>
            </div>
          </Section>

        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 px-6 mt-16">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <p>© {year} {COMPANY}. All rights reserved.</p>
          <div className="flex gap-6">
            <button onClick={() => navigate('/terms')} className="hover:text-cyan-400 transition-colors">Terms</button>
            <button onClick={() => navigate('/privacy')} className="hover:text-cyan-400 transition-colors">Privacy</button>
            <button onClick={() => navigate('/')} className="hover:text-cyan-400 transition-colors">Home</button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-white mb-3">{title}</h2>
      <div className="text-slate-400">{children}</div>
    </section>
  );
}
