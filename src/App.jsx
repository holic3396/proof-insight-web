import React, { useState, useRef, useMemo } from "react";
import { ethers } from "ethers";
import { Turnstile } from "@marsidev/react-turnstile";

// Edit this to your deployed Cloudflare Worker endpoint
const WORKER_URL = import.meta.env.VITE_WORKER_URL;
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCAN_BASE_URL = import.meta.env.VITE_SCAN_BASE_URL || "https://amoy.polygonscan.com/tx/";

if (!WORKER_URL) {
  throw new Error("VITE_WORKER_URL is not set in environment variables");
}

if (!TURNSTILE_SITE_KEY) {
  throw new Error("VITE_TURNSTILE_SITE_KEY is not set in environment variables");
}

function hexFromBuffer(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(file) {
  const arrayBuffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return `0x${hexFromBuffer(digest)}`;
}

function buildSignedMessage(fileHashHex) {
  return `Proof Insight: register file hash ${fileHashHex}`;
}

export default function App() {
  const [hash, setHash] = useState("");
  const [sig, setSig] = useState("");
  const [userAddr, setUserAddr] = useState("");
  const [status, setStatus] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [registerResult, setRegisterResult] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const turnstileRef = useRef(null);
  const fileInputRef = useRef(null);

  const onFileChange = async (e) => {
    const f = e.target.files?.[0];
    setHash("");
    setSig("");
    setStatus("");
    setRegisterResult(null);
    setVerifyResult(null);
    if (f) {
      setStatus("Computing SHA-256...");
      try {
        const h = await sha256Hex(f);
        setHash(h);
        setStatus("Ready to sign");
      } catch (err) {
        setStatus(`Error: ${err.message}`);
      }
    }
  };

  const onSign = async () => {
    if (!hash) return setStatus("No hash to sign");
    if (!window.ethereum) return setStatus("MetaMask not found");

    try {
      setStatus("Requesting signature from wallet...");
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setUserAddr(address);
      const message = buildSignedMessage(hash);
      const signature = await signer.signMessage(message);
      setSig(signature);
      setStatus("Signature obtained");
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  };

  const onSubmit = async () => {
    if (!hash || !sig) return setStatus("Hash and signature required");
    if (!turnstileToken) return setStatus("Please complete the CAPTCHA");

    setStatus("Sending to server...");
    setRegisterResult(null);

    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileHash: hash,
          signature: sig,
          user: userAddr,
          turnstileToken: turnstileToken,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${body.error || res.statusText}`);
        return;
      }
      setRegisterResult(body);
      setStatus("Success! Proof stored on-chain.");
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      // Reset Turnstile after use
      turnstileRef.current?.reset();
      setTurnstileToken("");
    }
  };

  const onVerify = async () => {
    if (!hash) return setStatus("Please select a file first");
    setStatus("Verifying proof from blockchain...");
    setVerifyResult(null);

    try {
      const verifyUrl = new URL(WORKER_URL);
      verifyUrl.searchParams.append("hash", hash);

      const res = await fetch(verifyUrl.toString(), { method: "GET" });
      const body = await res.json();

      if (!res.ok) {
        setStatus(`Server error: ${body.error || res.statusText}`);
        return;
      }

      setVerifyResult(body);
      setStatus(body.found ? "Verification complete: Proof found." : "Verification complete: Proof not found.");
    } catch (err) {
      setStatus(`Network error: ${err.message}`);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: "24px auto", fontFamily: "sans-serif", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>Proof Insight — Frontend (Prototype)</h1>

      {/* --- Step 1: File Selection --- */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6 }}><strong>1. Choose a file</strong> (hashed locally)</label>
        <input type="file" onChange={onFileChange} />
      </div>

      <div style={{ background: "#f7f7f8", padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <div><strong>File Hash (SHA-256)</strong></div>
        <div style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{hash || "—"}</div>
      </div>

      {/* --- Step 2: Register or Verify --- */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={onSign} disabled={!hash || !!sig} style={{ padding: "8px 12px" }}>2a. Sign with Wallet</button>
        <button onClick={onSubmit} disabled={!sig || !turnstileToken} style={{ padding: "8px 12px" }}>2b. Submit Proof</button>
        <button onClick={onVerify} disabled={!hash} style={{ padding: "8px 12px", marginLeft: 'auto', background: '#28a745' }}>Verify Proof</button>
      </div>

      {/* --- Turnstile Widget --- */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0' }}>
        <Turnstile
          ref={turnstileRef}
          siteKey={TURNSTILE_SITE_KEY}
          onSuccess={(token) => setTurnstileToken(token)}
        />
      </div>

      {/* --- Status & Results --- */}
      <div style={{ marginTop: 12 }}>
        <div style={{ color: "#666", minHeight: '24px', fontStyle: 'italic' }}><strong>Status:</strong> {status}</div>

        <div><strong>User (address)</strong></div>
        <div style={{ fontFamily: "monospace" }}>{userAddr || "—"}</div>

        <div style={{ marginTop: 8 }}><strong>Signature</strong></div>
        <div style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{sig || "—"}</div>

        {registerResult && (
          <div style={{ marginTop: 8, background: '#e9f7ef', padding: 8, borderRadius: 4 }}>
            <strong>Registration Result:</strong>
            <div>Tx Hash: <a href={`${SCAN_BASE_URL}${registerResult.txHash}`} target="_blank" rel="noopener noreferrer">{registerResult.txHash}</a></div>
            <div>Block: {registerResult.blockNumber}</div>
          </div>
        )}

        {verifyResult && (
          <div style={{ marginTop: 8, background: '#eef2f7', padding: 8, borderRadius: 4 }}>
            <strong>Verification Result:</strong>
            {verifyResult.found ? (
              <>
                <div>Owner: {verifyResult.owner}</div>
                <div>Timestamp: {new Date(verifyResult.timestamp * 1000).toLocaleString()}</div>
              </>
            ) : (
              <div>Proof not found for this file.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}