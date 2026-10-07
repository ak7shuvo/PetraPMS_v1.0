"use client";
// Gate for every signed-in screen: setup → sign-in (inline, so pop-out URLs survive) → forced password
// change → app shell. The lock screen overlays the shell so unsaved work stays in place.
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Splash } from "@/components/shell/splash";
import { ForcedPasswordChange, LockScreen, LoginScreen } from "@/components/shell/auth-screens";
import { AppShell } from "@/components/shell/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status, user, loading, locked } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading && status && !status.setupComplete) router.replace("/setup");
  }, [loading, status, router]);
  if (loading || !status) return <Splash />;
  if (!status.setupComplete) return <Splash />;
  if (!user) return <LoginScreen />;
  if (user.mustChangePassword) return <ForcedPasswordChange />;
  return (
    <>
      <AppShell>
        <Suspense fallback={null}>{children}</Suspense>
      </AppShell>
      {locked ? <LockScreen /> : null}
    </>
  );
}
