import { describe, it, expect } from "vitest";
// @ts-expect-error plain .mjs script
import { verifyInstaller } from "../../../scripts/verify-installer.mjs";
describe("installer definition", () => {
  it("never deletes customer data and is per-machine", () => expect(verifyInstaller()).toEqual([]));
});
