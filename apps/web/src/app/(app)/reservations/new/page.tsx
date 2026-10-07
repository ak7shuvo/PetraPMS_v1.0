"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import type { Guest } from "@/lib/queries";
import { useT } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
import { ReservationForm } from "@/components/res/reservation-form";
import { useTitle } from "@/components/shell/auth-screens";

export default function NewReservationPage() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  useTitle(t("res.new"));
  const roomId = sp.get("roomId") ?? undefined;
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: () => get<{ id: string; roomTypeId: string }[]>("/rooms"), enabled: !!roomId });
  const roomTypeId = roomId ? rooms.data?.find((r) => r.id === roomId)?.roomTypeId : sp.get("roomTypeId") ?? undefined;
  const guestId = sp.get("guestId");
  const guest = useQuery({ queryKey: ["guest", guestId], enabled: !!guestId, queryFn: () => get<Guest>(`/guests/${guestId}`) });
  if ((roomId && !rooms.data) || (guestId && !guest.data)) return null;
  return (
    <div>
      <PageHeader title={t("res.new")} />
      <ReservationForm initial={{ arrival: sp.get("arrival") ?? undefined, departure: sp.get("departure") ?? undefined, roomId, roomTypeId, guest: guest.data ?? null }} onCreated={(r) => router.push(`/reservations/${r.id}`)} />
    </div>
  );
}
