// Ed25519 public key used to verify license keys offline (PUBLIC key only). Written by the PetraPMS License Manager.
// The matching private key never leaves the vendor's machine.
//
// CHANNEL: this committed key is a DEVELOPMENT key (generated on a developer machine). `pnpm build:win` refuses to
// package it. To ship, run on the vendor machine:  pnpm license init --write-app --production   (new key pair)
//                                            or:  pnpm license write-app-key --production      (existing key pair)
export const LICENSE_KEY_CHANNEL: "development" | "production" = "development";
export const LICENSE_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA2//2zJm2hKmSQeGZpfEXvkz5wdZ9Hjym0yrCmjxSuLM=\n-----END PUBLIC KEY-----\n";
