import Link from 'next/link'

export default function NotFoundPage() {
  return (
    <main className="detail-page">
      <section className="panel detail-header">
        <div>
          <p className="eyebrow">Missing rollout</p>
          <h1>Sentra could not find that deployment.</h1>
          <p>The rollout may have been deleted, or the URL is pointing to a deployment ID that does not exist.</p>
        </div>
        <Link href="/" className="primary-button">
          Return to control room
        </Link>
      </section>
    </main>
  )
}
