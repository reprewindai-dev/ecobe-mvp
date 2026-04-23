import { blogPosts } from '@/lib/blog-posts'

import { BlogLoop } from './blog-loop'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function BlogPage() {
  return (
    <main className="page-shell blog-page">
      <header className="topbar">
        <div>
          <div className="brand-mark">HaloGrid Blog</div>
          <div className="brand-subtitle">Automated insight loop</div>
        </div>

        <nav className="topnav" aria-label="Primary">
          <a href="/">Home</a>
          <a href="/pay">Pay</a>
          <a href="/api/v1/public/overview">JSON</a>
        </nav>
      </header>

      <section className="blog-hero">
        <div className="blog-hero__copy">
          <span className="eyebrow">Blog</span>
          <h1>Operational notes, buyer rationale, and broker-boundary updates.</h1>
          <p>
            This is the real blog page. The top of HaloGrid stays focused on control; the articles live here
            and rotate automatically so the latest guidance stays visible without cluttering the homepage.
          </p>
        </div>

        <BlogLoop posts={blogPosts} />
      </section>

      <section className="blog-grid">
        {blogPosts.map((post) => (
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
