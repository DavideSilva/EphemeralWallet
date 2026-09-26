import { createWebAuthnCredential, toWebAuthnAccount } from "viem/account-abstraction";
import { encodeAbiParameters, sha256, slice, stringToBytes, type Hex } from "viem";

/** The owner's passkey (Touch ID on a Mac). Only its id and public key are kept; the private key never leaves the device. */
export type OwnerPasskey = { id: string; publicKey: Hex };

const STORAGE_KEY = "eaw:owner-passkey";

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && window.isSecureContext;
}

export function storedPasskey(): OwnerPasskey | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return value && typeof value.id === "string" && typeof value.publicKey === "string" ? value : null;
  } catch {
    return null;
  }
}

export function forgetPasskey() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored or storage unavailable.
  }
}

/**
 * Returns the stored passkey, or creates one with a Touch ID prompt. One passkey is reused for every card:
 * registering again could replace it in the keychain and break cards issued with the old one.
 */
export async function ownerPasskey(): Promise<OwnerPasskey> {
  const stored = storedPasskey();
  if (stored) return stored;
  const credential = await createWebAuthnCredential({
    name: "Ephemeral card owner",
    // A random user id, so a later registration never overwrites this passkey.
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "Ephemeral card owner", displayName: "Card owner" },
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      requireResidentKey: false,
      userVerification: "required",
    },
  });
  const passkey = { id: credential.id, publicKey: credential.publicKey };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(passkey));
  } catch {
    // Without storage the passkey still works for this card, but the next card will ask to create another.
  }
  return passkey;
}

/** The relying party the passkey is bound to. Passkeys don't work on IP addresses: open the app on localhost. */
export function rpIdHash(): Hex {
  return sha256(stringToBytes(window.location.hostname));
}

/** Approval plugin config for a passkey card: threshold, the passkey's public key, and this site's RP ID hash. */
export function passkeyConfig(threshold: bigint, passkey: OwnerPasskey): Hex {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [threshold, slice(passkey.publicKey, 0, 32), slice(passkey.publicKey, 32, 64), rpIdHash()],
  );
}

/** Asks for Touch ID and returns the WebAuthn assertion over `challenge`, shaped like solady's WebAuthnAuth. */
export async function signWithPasskey(passkey: OwnerPasskey, challenge: Hex) {
  const { signature, webauthn } = await toWebAuthnAccount({ credential: passkey }).sign({ hash: challenge });
  return {
    authenticatorData: webauthn.authenticatorData,
    clientDataJSON: webauthn.clientDataJSON,
    // Byte offsets of the "challenge" and "type" keys, which is what the contract checks.
    challengeIndex: BigInt(webauthn.challengeIndex ?? webauthn.clientDataJSON.indexOf('"challenge"')),
    typeIndex: BigInt(webauthn.typeIndex ?? webauthn.clientDataJSON.indexOf('"type"')),
    // ox normalises s to low-s, which the contract requires.
    r: slice(signature, 0, 32),
    s: slice(signature, 32, 64),
  };
}
