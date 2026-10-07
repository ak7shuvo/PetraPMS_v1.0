"use client";
// Shared query hooks and API types used across screens.
import { useQuery } from "@tanstack/react-query";
import { get } from "./api";

export interface RoomType {
  id: string;
  code: string;
  name: string;
  nameBn: string;
  description: string;
  baseOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  bedType: string;
  amenities: string[];
  photos: string[];
  baseRate: number;
  extraAdultRate: number;
  extraChildRate: number;
  extraBedRate: number;
  sortOrder: number;
  active: boolean;
  roomCount?: number;
}
export interface Room {
  id: string;
  number: string;
  floor: string;
  roomTypeId: string;
  hkStatus: string;
  features: string;
  notes: string;
  active: boolean;
  sortOrder: number;
  version: number;
  roomType?: { code: string; name: string };
}
export interface RatePlan {
  id: string;
  code: string;
  name: string;
  nameBn: string;
  type: string;
  mealPlan: string;
  mealPricePerAdult: number;
  mealPricePerChild: number;
  adjustmentType: string;
  adjustmentValue: number;
  weekendDays: number[];
  weekendAdjustmentBp: number;
  minStay: number;
  maxStay: number;
  companyId: string | null;
  cancellationPolicyId: string | null;
  cancellationPolicy?: { id: string; code: string; name: string } | null;
  description: string;
  active: boolean;
  roomRates: { roomTypeId: string; rate: number; extraAdultRate: number | null; extraChildRate: number | null; extraBedRate: number | null }[];
}
export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  nameBn: string;
  type: string;
  active: boolean;
  sortOrder: number;
}
export interface ChargeCode {
  id: string;
  code: string;
  name: string;
  nameBn: string;
  category: string;
  defaultAmount: number;
  taxable: boolean;
  active: boolean;
  sortOrder: number;
}
export interface Company {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  bin: string;
  creditLimit: number;
  paymentTermsDays: number;
  ratePlanId: string | null;
  discountBp: number;
  cityLedger: boolean;
  notes: string;
  active: boolean;
}
export interface Guest {
  id: string;
  code: string;
  title: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  gender: string;
  dateOfBirth: string;
  nationality: string;
  idType: string;
  idNumber: string;
  idImage: string;
  idImageBack: string;
  photo: string;
  passportNumber: string;
  passportExpiry: string;
  passportIssuedAt: string;
  visaNumber: string;
  visaType: string;
  visaExpiry: string;
  arrivalFrom: string;
  arrivalDateBd: string;
  portOfEntry: string;
  purposeOfVisit: string;
  occupation: string;
  address: string;
  city: string;
  country: string;
  companyId: string | null;
  company?: { id: string; name: string } | null;
  vip: number;
  blacklisted: boolean;
  blacklistReason: string;
  preferences: string;
  notes: string;
  loyaltyPoints: number;
  marketingOptIn: boolean;
  totalStays: number;
  totalNights: number;
  totalSpend: number;
  lastStayAt: string;
}
export interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone: string;
  roleId: string;
  role?: { code: string; name: string };
  active: boolean;
  locale: string;
  discountLimitBp: number;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  hasPin?: boolean;
}

const STATIC = { staleTime: 120_000 };

export const useRoomTypes = () => useQuery({ queryKey: ["room-types"], queryFn: () => get<RoomType[]>("/room-types"), ...STATIC });
export const useRooms = () => useQuery({ queryKey: ["rooms"], queryFn: () => get<Room[]>("/rooms"), staleTime: 30_000 });
export const useRatePlans = () => useQuery({ queryKey: ["rate-plans"], queryFn: () => get<RatePlan[]>("/rate-plans"), ...STATIC });
export const usePaymentMethods = () => useQuery({ queryKey: ["masters", "payment-methods"], queryFn: () => get<PaymentMethod[]>("/payment-methods"), ...STATIC });
export const useChargeCodes = () => useQuery({ queryKey: ["masters", "charge-codes"], queryFn: () => get<ChargeCode[]>("/charge-codes"), ...STATIC });
export const useCompanies = (enabled = true) => useQuery({ queryKey: ["companies"], queryFn: () => get<Company[]>("/companies?active=1"), enabled, ...STATIC });
export const useHotel = () => useQuery({ queryKey: ["hotel"], queryFn: () => get<{ name: string; checkInTime: string; checkOutTime: string; usdRate: number; showUsd: boolean; bin: string }>("/hotel"), ...STATIC });
