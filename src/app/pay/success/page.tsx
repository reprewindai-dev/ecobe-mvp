export const dynamic = 'force-dynamic'

export default function PaySuccessPage() {
  return (
    <main className="page-shell pay-page">
      <section className="pay-result">
        <span className="eyebrow">Payment complete</span>
        <h1>Checkout completed successfully.</h1>
        <p>The subscription is now active or will activate when Stripe finishes processing.</p>
        <a className="button button--primary" href="/">
          Return home
        </a>
      </section>
    </main>
  )
}
