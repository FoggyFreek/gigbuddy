// Visitor-facing privacy notice. Keep in sync with PRIVACY.md (the operator
// document); this is the plain-language version linked from every page footer.
export default function Privacy() {
  return (
    <div className="privacy-page">
      <h1>Privacy notice</h1>
      <p>
        This is a band&apos;s public link page. You can visit it without an account, and it sets
        <strong> no cookies</strong> and stores nothing on your device.
      </p>
      <h2>What we measure</h2>
      <p>
        To show the band how their page is doing, each page view is counted with three coarse,
        anonymous facts: the <strong>device class</strong> (phone, tablet or desktop), the{' '}
        <strong>traffic source</strong> (the website that linked here, or a campaign tag — never the
        full address you came from), and the <strong>country</strong> the visit came from.
      </p>
      <h2>What we do not collect</h2>
      <ul>
        <li>No IP addresses are stored.</li>
        <li>No full user-agent strings, no fingerprinting, no cross-site tracking.</li>
        <li>No cookies, local storage, or any other identifiers on your device.</li>
        <li>Nothing that identifies you as a person.</li>
      </ul>
      <p>
        To estimate unique visitors, a truncated, keyed hash of connection data is kept for a single
        day; it rotates daily, cannot be linked across days, and cannot be traced back to you. Raw
        view counts are automatically deleted after at most 13 months; only aggregate totals remain.
      </p>
      <h2>External links</h2>
      <p>
        Cards on this page link to external platforms (music services, shops, social networks). Once
        you follow a link, that platform&apos;s own privacy policy applies.
      </p>
      <h2>Contact</h2>
      <p>
        For questions about this page&apos;s data, contact the band that operates it; for questions
        about the platform, contact the site operator.
      </p>
    </div>
  )
}
