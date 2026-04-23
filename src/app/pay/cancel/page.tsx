export const dynamic = 'force-dynamic'

export default function PayCancelPage() {
  return (
    <main className="page-shell pay-page">
      <section className="pay-result">
        <span className="eyebrow">Checkout canceled</span>
        <h1>Payment was not completed.</h1>
        <p>You can reopen checkout whenever you’re ready.</p>
        <a className="button button--primary" href="/pay">
          Try again
        </a>
      </section>
    </main>
  )
}
