import type { TermsDocument } from './types.ts'
import { TERMS_VERSION } from '../../../shared/termsVersion.js'

// English Terms & Conditions — a standalone document, independent of the Dutch
// version and of the i18n system. DRAFT: requires legal review before
// public launch.
export const termsEn: TermsDocument = {
  version: TERMS_VERSION,
  title: 'GigBuddy Terms & Conditions',
  draftNotice: 'Draft version — this text is pending legal review.',
  intro: [
    'These terms describe what you can expect from GigBuddy and what we expect from you. We have written them in plain language on purpose: if something is unclear, that is a bug — tell us.',
    'By creating a band workspace or joining one, you agree to these terms.',
  ],
  sections: [
    {
      heading: '1. What GigBuddy is',
      paragraphs: [
        'GigBuddy is an online tool for bands: planning gigs and rehearsals, managing availability, songs and setlists, contacts, and — on paid plans — band finances such as invoices and a bookkeeping ledger.',
        'GigBuddy is provided as an online service ("software as a service"). You do not buy the software; you use it while your account is active.',
      ],
    },
    {
      heading: '2. Your account',
      paragraphs: [
        'You sign in with an existing Google or Microsoft account. You are responsible for keeping access to that account secure; everything done through your sign-in counts as done by you.',
        'One person, one account. Each band (a "workspace") has an owner whose subscription determines the plan for that band, and members whom the band itself manages.',
        'You must be at least 16 years old, or have permission from a parent or guardian, to use GigBuddy.',
      ],
    },
    {
      heading: '3. Subscriptions, trial and payment',
      paragraphs: [
        'GigBuddy has a free plan and paid plans. Prices, limits and features per plan are shown before you subscribe. Payment is handled by our payment provider (Mollie); we never see or store your full payment details.',
        'New subscribers get a one-time free trial period. To start it we place a €0.01 verification charge that establishes your payment mandate. If you cancel during the trial, you pay nothing beyond that verification charge.',
        'Subscriptions renew automatically per month or per year, depending on your choice, until you cancel. You can cancel at any time; a paid period runs to its end date and is not refunded pro rata unless the law requires it.',
        'When you move to a lower plan, features outside the new plan become unavailable. Data is deleted only after your explicit, informed confirmation of a downgrade — never merely because a payment failed. If your subscription lapses, your workspace falls back to the free plan and your data stays stored.',
      ],
    },
    {
      heading: '4. Fair use',
      paragraphs: [
        'Storage and usage limits per plan exist so that everyone gets a fast, reliable service. Use GigBuddy for what it is meant for: running your band.',
        'Not allowed: using GigBuddy for unlawful content or activities; attempting to breach or probe the security of the service or other bands’ data; reselling access; placing an unreasonable load on the service (for example automated bulk requests); or uploading material you have no right to use.',
        'If usage seriously threatens the stability or security of the service, we may temporarily limit an account. We will contact you before or as soon as possible after doing so.',
      ],
    },
    {
      heading: '5. Your content',
      paragraphs: [
        'Everything you put into GigBuddy — songs, files, contacts, financial records — remains yours. You give us only the technical permission needed to store, process, and display it to your band members, because that is what the service does.',
        'You are responsible for the content your band stores, including having the rights to uploaded files (for example sheet music or recordings).',
        'You can export or delete your own data. Deleting a workspace deletes its content, including financial records — keeping legally required copies (for example for tax retention duties) is your responsibility.',
      ],
    },
    {
      heading: '6. Data protection and privacy',
      paragraphs: [
        'We process personal data (such as names, email addresses, and the contacts your band stores) only to provide the service, following the EU General Data Protection Regulation (GDPR). For the data your band stores about others, your band is the controller and GigBuddy processes it on your behalf.',
        'We do not sell personal data and we do not use your content for advertising or for training AI models.',
        'Data is stored within the European Union. We use a small number of processors (hosting, payments) that are bound by processing agreements.',
        'You may request access, correction, or deletion of your personal data at any time. Security incidents that affect your data are reported to you without undue delay.',
      ],
    },
    {
      heading: '7. Availability and support',
      paragraphs: [
        'We aim for high availability but provide GigBuddy without an uptime guarantee. Maintenance is announced when it is expected to be disruptive.',
        'We make regular backups for disaster recovery. These backups are not a substitute for your own export of records you are legally required to keep.',
        'Support is provided by email on a best-effort basis.',
      ],
    },
    {
      heading: '8. Liability',
      paragraphs: [
        'GigBuddy is a tool for bands, not a professional bookkeeping, legal or tax service; verify important figures with your own adviser. We are not liable for indirect damage such as lost profits or lost data, except where damage results from our intent or gross negligence.',
        'Our total liability is in all cases limited to the amount you paid us for the service in the twelve months before the event causing the damage.',
        'Nothing in these terms limits liability that cannot be limited under law.',
      ],
    },
    {
      heading: '9. Changes to these terms',
      paragraphs: [
        'We may update these terms. For meaningful changes we will notify you inside the app at least 30 days in advance and ask you to accept the new version. If you do not agree, you can cancel and export your data before the change takes effect.',
      ],
    },
    {
      heading: '10. Governing law',
      paragraphs: [
        'These terms are governed by Dutch law. Disputes are brought before the competent court in the Netherlands, unless mandatory consumer law lets you choose the court of your place of residence.',
      ],
    },
  ],
}
