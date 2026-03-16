"use client";

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <title>Offline | iRopit</title>
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-warning/10 flex items-center justify-center">
          <svg
            className="w-10 h-10 text-warning"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M15.536 8.464a5 5 0 010 7.072M8.464 15.536a5 5 0 010-7.072"
            />
            <line x1="4" y1="4" x2="20" y2="20" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-txt mb-3">
          You&apos;re Offline
        </h1>
        <p className="text-txt-secondary mb-6">
          No internet connection. Please check your network and try again.
        </p>
        <button
          onClick={() => typeof window !== "undefined" && window.location.reload()}
          className="px-6 py-3 bg-primary text-txt-inverse rounded-xl font-medium hover:bg-primary-dark transition"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
