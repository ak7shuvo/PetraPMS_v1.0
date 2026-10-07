-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Hotel" (
    "id" TEXT NOT NULL DEFAULT 'hotel',
    "name" TEXT NOT NULL,
    "legalName" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'BD',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "bin" TEXT NOT NULL DEFAULT '',
    "tradeLicense" TEXT NOT NULL DEFAULT '',
    "logo" TEXT NOT NULL DEFAULT '',
    "checkInTime" TEXT NOT NULL DEFAULT '14:00',
    "checkOutTime" TEXT NOT NULL DEFAULT '12:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "usdRate" INTEGER NOT NULL DEFAULT 12000,
    "showUsd" BOOLEAN NOT NULL DEFAULT false,
    "setupComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "Hotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDate" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "BusinessDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Permission" (
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL DEFAULT '',
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionCode")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "roleId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "banglaDigits" BOOLEAN NOT NULL DEFAULT false,
    "uiScale" INTEGER NOT NULL DEFAULT 100,
    "theme" TEXT NOT NULL DEFAULT 'light',
    "discountLimitBp" INTEGER NOT NULL DEFAULT 1000,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWindowSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "deviceLabel" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserWindowSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedWorkspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDate" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "username" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT '',
    "entityId" TEXT NOT NULL DEFAULT '',
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "terminalId" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "undoData" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "sha256" TEXT NOT NULL DEFAULT '',
    "schemaVersion" TEXT NOT NULL DEFAULT '',
    "appVersion" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OK',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL DEFAULT 'license',
    "key" TEXT NOT NULL DEFAULT '',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'TRIAL',
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "activatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "sendAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "entity" TEXT NOT NULL DEFAULT '',
    "entityId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '["pos"]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftNote" (
    "id" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT 'FRONT_DESK',
    "text" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL DEFAULT '',
    "acknowledgedBy" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL DEFAULT '',
    "rateBp" INTEGER NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'NET',
    "appliesTo" TEXT NOT NULL DEFAULT '["*"]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "defaultAmount" INTEGER NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amenity" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationPolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "freeUntilHours" INTEGER NOT NULL DEFAULT 24,
    "penaltyType" TEXT NOT NULL DEFAULT 'FIRST_NIGHT',
    "penaltyValue" INTEGER NOT NULL DEFAULT 0,
    "noShowType" TEXT NOT NULL DEFAULT 'FIRST_NIGHT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "baseOccupancy" INTEGER NOT NULL DEFAULT 2,
    "maxAdults" INTEGER NOT NULL DEFAULT 2,
    "maxChildren" INTEGER NOT NULL DEFAULT 1,
    "maxOccupancy" INTEGER NOT NULL DEFAULT 3,
    "bedType" TEXT NOT NULL DEFAULT 'DOUBLE',
    "amenities" TEXT NOT NULL DEFAULT '[]',
    "photos" TEXT NOT NULL DEFAULT '[]',
    "baseRate" INTEGER NOT NULL,
    "extraAdultRate" INTEGER NOT NULL DEFAULT 0,
    "extraChildRate" INTEGER NOT NULL DEFAULT 0,
    "extraBedRate" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "RoomType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" TEXT NOT NULL DEFAULT '1',
    "roomTypeId" TEXT NOT NULL,
    "hkStatus" TEXT NOT NULL DEFAULT 'CLEAN',
    "features" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomBlock" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "ticketId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "RoomBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatePlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'RACK',
    "mealPlan" TEXT NOT NULL DEFAULT 'RO',
    "mealPricePerAdult" INTEGER NOT NULL DEFAULT 0,
    "mealPricePerChild" INTEGER NOT NULL DEFAULT 0,
    "adjustmentType" TEXT NOT NULL DEFAULT 'NONE',
    "adjustmentValue" INTEGER NOT NULL DEFAULT 0,
    "weekendDays" TEXT NOT NULL DEFAULT '[5,6]',
    "weekendAdjustmentBp" INTEGER NOT NULL DEFAULT 0,
    "minStay" INTEGER NOT NULL DEFAULT 1,
    "maxStay" INTEGER NOT NULL DEFAULT 0,
    "companyId" TEXT,
    "cancellationPolicyId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "RatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatePlanRoomType" (
    "id" TEXT NOT NULL,
    "ratePlanId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "rate" INTEGER NOT NULL,
    "extraAdultRate" INTEGER,
    "extraChildRate" INTEGER,
    "extraBedRate" INTEGER,

    CONSTRAINT "RatePlanRoomType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateSeason" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePlanId" TEXT,
    "roomTypeId" TEXT,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "adjustmentType" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL,
    "daysOfWeek" TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    "minStay" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "bin" TEXT NOT NULL DEFAULT '',
    "creditLimit" INTEGER NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "ratePlanId" TEXT,
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "cityLedger" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "gender" TEXT NOT NULL DEFAULT '',
    "dateOfBirth" TEXT NOT NULL DEFAULT '',
    "nationality" TEXT NOT NULL DEFAULT 'BD',
    "idType" TEXT NOT NULL DEFAULT '',
    "idNumber" TEXT NOT NULL DEFAULT '',
    "idImage" TEXT NOT NULL DEFAULT '',
    "idImageBack" TEXT NOT NULL DEFAULT '',
    "photo" TEXT NOT NULL DEFAULT '',
    "passportNumber" TEXT NOT NULL DEFAULT '',
    "passportExpiry" TEXT NOT NULL DEFAULT '',
    "passportIssuedAt" TEXT NOT NULL DEFAULT '',
    "visaNumber" TEXT NOT NULL DEFAULT '',
    "visaType" TEXT NOT NULL DEFAULT '',
    "visaExpiry" TEXT NOT NULL DEFAULT '',
    "arrivalFrom" TEXT NOT NULL DEFAULT '',
    "arrivalDateBd" TEXT NOT NULL DEFAULT '',
    "portOfEntry" TEXT NOT NULL DEFAULT '',
    "purposeOfVisit" TEXT NOT NULL DEFAULT '',
    "occupation" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'BD',
    "companyId" TEXT,
    "vip" INTEGER NOT NULL DEFAULT 0,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklistReason" TEXT NOT NULL DEFAULT '',
    "preferences" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "totalStays" INTEGER NOT NULL DEFAULT 0,
    "totalNights" INTEGER NOT NULL DEFAULT 0,
    "totalSpend" INTEGER NOT NULL DEFAULT 0,
    "lastStayAt" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "confirmationNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "source" TEXT NOT NULL DEFAULT 'WALK_IN',
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "agentName" TEXT NOT NULL DEFAULT '',
    "guestId" TEXT NOT NULL,
    "companyId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "groupName" TEXT NOT NULL DEFAULT '',
    "arrivalDate" TEXT NOT NULL,
    "departureDate" TEXT NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "ratePlanId" TEXT,
    "eta" TEXT NOT NULL DEFAULT '',
    "specialRequests" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "depositRequired" INTEGER NOT NULL DEFAULT 0,
    "paymentTerms" TEXT NOT NULL DEFAULT 'GUEST',
    "cancellationPolicy" TEXT NOT NULL DEFAULT '{}',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "cancellationFee" INTEGER NOT NULL DEFAULT 0,
    "noShowAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationRoom" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "roomId" TEXT,
    "guestId" TEXT,
    "arrivalDate" TEXT NOT NULL,
    "departureDate" TEXT NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "extraBeds" INTEGER NOT NULL DEFAULT 0,
    "ratePlanId" TEXT,
    "nightlyRates" TEXT NOT NULL DEFAULT '[]',
    "rateOverride" BOOLEAN NOT NULL DEFAULT false,
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "earlyCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "lateCheckOut" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMove" (
    "id" TEXT NOT NULL,
    "reservationRoomId" TEXT NOT NULL,
    "fromRoomId" TEXT,
    "toRoomId" TEXT,
    "businessDate" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "movedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folio" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'GUEST',
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reservationId" TEXT,
    "reservationRoomId" TEXT,
    "guestId" TEXT,
    "companyId" TEXT,
    "parentFolioId" TEXT,
    "routing" TEXT NOT NULL DEFAULT '[]',
    "cityLedger" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Folio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolioCharge" (
    "id" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "serviceCharge" INTEGER NOT NULL DEFAULT 0,
    "vat" INTEGER NOT NULL DEFAULT 0,
    "otherTax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "taxDetail" TEXT NOT NULL DEFAULT '[]',
    "taxMode" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "reservationRoomId" TEXT,
    "roomNumber" TEXT NOT NULL DEFAULT '',
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL DEFAULT '',
    "approvedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT NOT NULL DEFAULT '',
    "transferredFrom" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "FolioCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PAYMENT',
    "method" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "foreignAmount" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "receiptNo" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billToName" TEXT NOT NULL,
    "billToAddress" TEXT NOT NULL DEFAULT '',
    "billToBin" TEXT NOT NULL DEFAULT '',
    "subtotal" INTEGER NOT NULL,
    "serviceCharge" INTEGER NOT NULL DEFAULT 0,
    "vat" INTEGER NOT NULL DEFAULT 0,
    "otherTax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "snapshot" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingTask" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 2,
    "assignedToId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "inspectedAt" TIMESTAMP(3),
    "inspectedById" TEXT,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "HousekeepingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinenItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "par" INTEGER NOT NULL DEFAULT 0,
    "inStore" INTEGER NOT NULL DEFAULT 0,
    "inUse" INTEGER NOT NULL DEFAULT 0,
    "inLaundry" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinenItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostFound" (
    "id" TEXT NOT NULL,
    "itemNo" TEXT NOT NULL,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomId" TEXT,
    "location" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "foundBy" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'STORED',
    "guestName" TEXT NOT NULL DEFAULT '',
    "returnedAt" TIMESTAMP(3),
    "returnedTo" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "LostFound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTicket" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "roomId" TEXT,
    "area" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "photos" TEXT NOT NULL DEFAULT '[]',
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "resolution" TEXT NOT NULL DEFAULT '',
    "blockId" TEXT,
    "scheduleId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "MaintenanceTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreventiveSchedule" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "roomId" TEXT,
    "area" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "intervalDays" INTEGER NOT NULL,
    "nextDueDate" TEXT NOT NULL,
    "assignedToId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreventiveSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NightAudit" (
    "id" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "steps" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "NightAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDate_date_key" ON "BusinessDate"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "UserWindowSession_tokenHash_key" ON "UserWindowSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserWindowSession_userId_idx" ON "UserWindowSession"("userId");

-- CreateIndex
CREATE INDEX "UserWindowSession_terminalId_idx" ON "UserWindowSession"("terminalId");

-- CreateIndex
CREATE INDEX "UserWindowSession_lastSeenAt_idx" ON "UserWindowSession"("lastSeenAt");

-- CreateIndex
CREATE INDEX "SavedWorkspace_userId_idx" ON "SavedWorkspace"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "Notification_status_sendAfter_idx" ON "Notification"("status", "sendAfter");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ShiftNote_businessDate_idx" ON "ShiftNote"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_code_key" ON "PaymentMethod"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRule_code_key" ON "TaxRule"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeCode_code_key" ON "ChargeCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Amenity_code_key" ON "Amenity"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationPolicy_code_key" ON "CancellationPolicy"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRule_code_key" ON "DiscountRule"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_code_key" ON "Staff"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RoomType_code_key" ON "RoomType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Room_number_key" ON "Room"("number");

-- CreateIndex
CREATE INDEX "Room_roomTypeId_idx" ON "Room"("roomTypeId");

-- CreateIndex
CREATE INDEX "Room_floor_idx" ON "Room"("floor");

-- CreateIndex
CREATE INDEX "RoomBlock_roomId_startDate_endDate_idx" ON "RoomBlock"("roomId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlan_code_key" ON "RatePlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlanRoomType_ratePlanId_roomTypeId_key" ON "RatePlanRoomType"("ratePlanId", "roomTypeId");

-- CreateIndex
CREATE INDEX "RateSeason_startDate_endDate_idx" ON "RateSeason"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_code_key" ON "Guest"("code");

-- CreateIndex
CREATE INDEX "Guest_phone_idx" ON "Guest"("phone");

-- CreateIndex
CREATE INDEX "Guest_fullName_idx" ON "Guest"("fullName");

-- CreateIndex
CREATE INDEX "Guest_idNumber_idx" ON "Guest"("idNumber");

-- CreateIndex
CREATE INDEX "Guest_email_idx" ON "Guest"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_confirmationNo_key" ON "Reservation"("confirmationNo");

-- CreateIndex
CREATE INDEX "Reservation_arrivalDate_idx" ON "Reservation"("arrivalDate");

-- CreateIndex
CREATE INDEX "Reservation_departureDate_idx" ON "Reservation"("departureDate");

-- CreateIndex
CREATE INDEX "Reservation_status_idx" ON "Reservation"("status");

-- CreateIndex
CREATE INDEX "Reservation_guestId_idx" ON "Reservation"("guestId");

-- CreateIndex
CREATE INDEX "ReservationRoom_arrivalDate_departureDate_idx" ON "ReservationRoom"("arrivalDate", "departureDate");

-- CreateIndex
CREATE INDEX "ReservationRoom_roomId_arrivalDate_departureDate_idx" ON "ReservationRoom"("roomId", "arrivalDate", "departureDate");

-- CreateIndex
CREATE INDEX "ReservationRoom_roomTypeId_arrivalDate_departureDate_idx" ON "ReservationRoom"("roomTypeId", "arrivalDate", "departureDate");

-- CreateIndex
CREATE INDEX "ReservationRoom_status_idx" ON "ReservationRoom"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Folio_number_key" ON "Folio"("number");

-- CreateIndex
CREATE INDEX "Folio_reservationId_idx" ON "Folio"("reservationId");

-- CreateIndex
CREATE INDEX "Folio_status_idx" ON "Folio"("status");

-- CreateIndex
CREATE INDEX "Folio_companyId_idx" ON "Folio"("companyId");

-- CreateIndex
CREATE INDEX "FolioCharge_folioId_idx" ON "FolioCharge"("folioId");

-- CreateIndex
CREATE INDEX "FolioCharge_businessDate_idx" ON "FolioCharge"("businessDate");

-- CreateIndex
CREATE INDEX "FolioCharge_category_idx" ON "FolioCharge"("category");

-- CreateIndex
CREATE INDEX "FolioCharge_sourceRef_idx" ON "FolioCharge"("sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNo_key" ON "Payment"("receiptNo");

-- CreateIndex
CREATE INDEX "Payment_folioId_idx" ON "Payment"("folioId");

-- CreateIndex
CREATE INDEX "Payment_businessDate_idx" ON "Payment"("businessDate");

-- CreateIndex
CREATE INDEX "Payment_method_idx" ON "Payment"("method");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_businessDate_idx" ON "Invoice"("businessDate");

-- CreateIndex
CREATE INDEX "HousekeepingTask_businessDate_status_idx" ON "HousekeepingTask"("businessDate", "status");

-- CreateIndex
CREATE INDEX "HousekeepingTask_roomId_idx" ON "HousekeepingTask"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "LinenItem_code_key" ON "LinenItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LostFound_itemNo_key" ON "LostFound"("itemNo");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceTicket_number_key" ON "MaintenanceTicket"("number");

-- CreateIndex
CREATE INDEX "MaintenanceTicket_status_idx" ON "MaintenanceTicket"("status");

-- CreateIndex
CREATE INDEX "MaintenanceTicket_roomId_idx" ON "MaintenanceTicket"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "NightAudit_businessDate_key" ON "NightAudit"("businessDate");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "Permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWindowSession" ADD CONSTRAINT "UserWindowSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedWorkspace" ADD CONSTRAINT "SavedWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_cancellationPolicyId_fkey" FOREIGN KEY ("cancellationPolicyId") REFERENCES "CancellationPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlanRoomType" ADD CONSTRAINT "RatePlanRoomType_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlanRoomType" ADD CONSTRAINT "RatePlanRoomType_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateSeason" ADD CONSTRAINT "RateSeason_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateSeason" ADD CONSTRAINT "RateSeason_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationRoom" ADD CONSTRAINT "ReservationRoom_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationRoom" ADD CONSTRAINT "ReservationRoom_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationRoom" ADD CONSTRAINT "ReservationRoom_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationRoom" ADD CONSTRAINT "ReservationRoom_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMove" ADD CONSTRAINT "RoomMove_reservationRoomId_fkey" FOREIGN KEY ("reservationRoomId") REFERENCES "ReservationRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMove" ADD CONSTRAINT "RoomMove_toRoomId_fkey" FOREIGN KEY ("toRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_reservationRoomId_fkey" FOREIGN KEY ("reservationRoomId") REFERENCES "ReservationRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioCharge" ADD CONSTRAINT "FolioCharge_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioCharge" ADD CONSTRAINT "FolioCharge_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostFound" ADD CONSTRAINT "LostFound_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTicket" ADD CONSTRAINT "MaintenanceTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

