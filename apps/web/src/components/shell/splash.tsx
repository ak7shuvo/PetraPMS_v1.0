"use client";
import { Loader2 } from "lucide-react";

export function Logo({ size = 28, name = "PetraPMS" }: { size?: number; name?: string }) {
  return (
    <div className="flex items-center gap-2 select-none">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="6" fill="#111111" />
        <path d="M9 24V8h8.5a5 5 0 0 1 0 10H13" stroke="#C8102E" strokeWidth="3.2" fill="none" strokeLinecap="square" />
      </svg>
      <span className="font-bold tracking-tight" style={{ fontSize: size * 0.62 }}>
        {name}
      </span>
    </div>
  );
}

export function Splash({ message }: { message?: string }) {
  return (
    <div className="min-h-screen grid place-items-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <Logo size={40} />
        <Loader2 className="size-5 animate-spin text-muted" />
        {message ? <p className="text-sm text-muted">{message}</p> : null}
      </div>
    </div>
  );
}
