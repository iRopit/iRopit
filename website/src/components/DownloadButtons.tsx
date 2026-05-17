import Link from "next/link";
import Image from "next/image";

export default function DownloadButtons({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-4 ${className}`}>
      {/* Google Play Button */}
      <Link
        href="https://play.google.com/store/apps/details?id=com.IRopit"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-3 bg-txt dark:bg-surface-secondary text-txt-inverse dark:text-txt px-5 py-3 rounded-[var(--radius)] hover:bg-txt/90 dark:hover:bg-surface-tertiary transition-all hover:scale-105 dark:border dark:border-border"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-7 h-7 fill-current"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 0 1-.61-.921V2.735a1 1 0 0 1 .609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.302 2.302c.756.439.756 1.54 0 1.978l-2.302 1.303-2.535-2.535 2.535-2.535-.001-.513zM5.864 3.471L16.8 9.804l-2.302 2.302L5.864 3.47z" />
        </svg>
        <div className="text-left">
          <div className="text-[10px] opacity-80 leading-tight">GET IT ON</div>
          <div className="text-sm font-semibold leading-tight">Google Play</div>
        </div>
      </Link>

      {/* Chrome Extension Button */}
      <Link
        href="https://chromewebstore.google.com/detail/iropit/apjplefehkfmcjmkpapnjpainefomkgh?hl=en-US&utm_source=ext_sidebar"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-3 bg-txt dark:bg-surface-secondary text-txt-inverse dark:text-txt px-5 py-3 rounded-[var(--radius)] hover:bg-txt/90 dark:hover:bg-surface-tertiary transition-all hover:scale-105 dark:border dark:border-border"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-7 h-7 fill-current"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001-3.952 6.848c.2.013.4.025.604.025 6.627 0 12-5.373 12-12 0-.685-.067-1.354-.178-2.008zM12 8.009a3.991 3.991 0 1 0 0 7.982 3.991 3.991 0 0 0 0-7.982z" />
        </svg>
        <div className="text-left">
          <div className="text-[10px] opacity-80 leading-tight">
            AVAILABLE ON
          </div>
          <div className="text-sm font-semibold leading-tight">
            Chrome Web Store
          </div>
        </div>
      </Link>
    </div>
  );
}
