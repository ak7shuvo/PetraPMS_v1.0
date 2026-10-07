"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Splash } from "@/components/shell/splash";

export default function Index() {
  const { status, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading || !status) return;
    router.replace(status.setupComplete ? "/dashboard" : "/setup");
  }, [loading, status, router]);
  return <Splash />;
}
