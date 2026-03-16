import type { ReactNode } from "react";
import Image from "next/image";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex">
      {/* Left Side - Brand  */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary to-primary-dark items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 start-20 w-64 h-64 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-20 end-20 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        </div>
        <div className="relative text-center text-white max-w-md">
          <div className="w-20 h-20 mx-auto mb-8 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Image
              src="/logo.png"
              alt="iRopit"
              width={48}
              height={48}
              className="object-contain"
            />
          </div>
          <h1 className="text-4xl font-bold mb-4">iRopit</h1>
          <p className="text-lg text-white/80">
            Sync your SMS, calls, notifications & chat across all your devices
          </p>
          <div className="mt-12 grid grid-cols-2 gap-4 text-sm">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <div className="text-2xl font-bold">📱</div>
              <p className="mt-2 text-white/70">SMS Sync</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <div className="text-2xl font-bold">📞</div>
              <p className="mt-2 text-white/70">Call History</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <div className="text-2xl font-bold">🔔</div>
              <p className="mt-2 text-white/70">Notifications</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <div className="text-2xl font-bold">🔒</div>
              <p className="mt-2 text-white/70">Encrypted</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="flex-1 flex items-center justify-center p-6">
        {children}
      </div>
    </div>
  );
}
