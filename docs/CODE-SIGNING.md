# Code signing (Windows)

Unsigned installers work but trigger Microsoft SmartScreen / "unknown publisher" warnings, which hurts sales.

1. Buy an **OV or EV code-signing certificate** (EV removes SmartScreen warnings immediately; OV builds reputation over time) or use **Azure Trusted Signing**.
2. Local build: set `CSC_LINK` (path/base64 of the .pfx) and `CSC_KEY_PASSWORD`, then `pnpm build:win`.
3. CI: add the same two values as GitHub Actions secrets (`.github/workflows/release-windows.yml` already passes them through).
4. Verify: right-click the .exe → Properties → Digital Signatures, or `signtool verify /pa PetraPMS-Setup-*.exe`.
5. Keep the certificate/private key out of the repository.
