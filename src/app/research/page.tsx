import { technicalPosts } from '@/lib/technical-posts'

import { BlogLoop } from '../blog/blog-loop'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function ResearchPage() {
  return (
    <main className="page-shell blog-page">
      <header className="topbar">
        <div>
          <div className="brand-mark">Technical Notes</div>
          <div className="brand-subtitle">For operators, engineers, and auditors</div>
        </div>

        <nav className="topnav" aria-label="Primary">
          <a href="/">Home</a>
          <a href="/blog">Public blog</a>
          <a href="/pay">Pay</a>
          <a href="/api/v1/public/overview">JSON</a>
        </nav>
      </header>

      <section className="blog-hero">
        <div className="blog-hero__copy">
          <span className="eyebrow">Research</span>
          <h1>Architecture notes, policy detail, and implementation updates.</h1>
          <p>
            This is the deeper lane for the people who want the wiring, the tradeoffs, and the proof behind
            the public surface. The public site stays simple. This page carries the technical detail.
          </p>
        </div>

        <BlogLoop posts={technicalPosts} />
      </section>

      <section className="blog-grid">
        {technicalPosts.map((post) => (
          <article className="blog-card" key={post.slug}>
            <div className="blog-card__eyebrow">{post.eyebrow}</div>
            <h2>{post.title}</h2>
            <p>{post.summary}</p>
            <div className="blog-card__body">
              {post.body.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
