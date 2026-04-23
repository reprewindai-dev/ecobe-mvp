'use client'

import { useEffect, useMemo, useState } from 'react'

import type { BlogPost } from '@/lib/blog-posts'

export function BlogLoop({ posts }: { posts: BlogPost[] }) {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (posts.length <= 1) {
      return
    }

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % posts.length)
    }, 5000)

    return () => window.clearInterval(timer)
  }, [posts.length])

  const activePost = posts[activeIndex] ?? posts[0]

  const pillText = useMemo(() => {
    return `${activeIndex + 1} / ${posts.length}`
  }, [activeIndex, posts.length])

  return (
    <div className="blog-loop">
      <div className="blog-loop__feature">
        <div className="blog-loop__eyebrow">{activePost.eyebrow}</div>
        <h2>{activePost.title}</h2>
        <p>{activePost.summary}</p>
        <div className="blog-loop__meta">
          <span>{activePost.publishedAt}</span>
          <strong>{pillText}</strong>
        </div>
      </div>

      <div className="blog-loop__rail">
        {posts.map((post, index) => (
          <button
            key={post.slug}
            type="button"
            className={index === activeIndex ? 'blog-loop__rail-item blog-loop__rail-item--active' : 'blog-loop__rail-item'}
            onClick={() => setActiveIndex(index)}
          >
            <span>{post.eyebrow}</span>
            <strong>{post.title}</strong>
          </button>
        ))}
      </div>
    </div>
  )
}
