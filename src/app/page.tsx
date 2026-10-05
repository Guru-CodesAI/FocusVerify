import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <nav className="mb-16 flex items-center justify-between">
          <div className="text-xl font-semibold tracking-tight">FOCUSVERIFY</div>
          <div className="flex gap-3 text-sm text-slate-600">
            <Link href="/setup" className="rounded-full bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">
              Start Session
            </Link>
            <Link href="/report" className="rounded-full border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:border-slate-400">
              View Report
            </Link>
          </div>
        </nav>

        <section className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.22em] text-slate-500">
              Privacy-conscious assessment session monitoring
            </p>
            <h1 className="max-w-xl text-5xl font-semibold tracking-tight text-slate-900">
              See what the browser can actually observe.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-slate-600">
              FocusVerify records browser focus, tab visibility, fullscreen, and camera-stream availability. It does not analyze faces, eyes, gaze, identity, or intent; recorded signals are kept for human review.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/setup" className="rounded-full bg-slate-900 px-6 py-3 font-medium text-white hover:bg-slate-700">
                Start Session
              </Link>
              <Link href="/reviewer" className="rounded-full border border-slate-300 bg-white px-6 py-3 font-medium text-slate-700 hover:border-slate-400">
                Reviewer sign in
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="rounded-2xl bg-slate-100 p-4">
              <div className="mb-4 flex items-center justify-between text-sm text-slate-600">
                <span>Browser signal preview</span>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">Browser-observable</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                  <span className="text-sm text-slate-600">Page visibility</span>
                  <span className="font-semibold text-slate-900">Tracked</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                  <span className="text-sm text-slate-600">Window focus</span>
                  <span className="font-semibold text-slate-900">Tracked</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                  <span className="text-sm text-slate-600">Fullscreen changes</span>
                  <span className="font-semibold text-slate-900">Tracked</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                  <span className="text-sm text-slate-600">Camera stream</span>
                  <span className="font-semibold text-slate-900">Local only</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
