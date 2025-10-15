import React, { useState, useRef } from "react";
import { ethers } from "ethers";
import { Turnstile } from "@marsidev/react-turnstile";

const WORKER_URL = import.meta.env.VITE_WORKER_URL;
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCAN_BASE_URL = import.meta.env.VITE_SCAN_BASE_URL || "https://amoy.polygonscan.com/tx/";

if (!WORKER_URL) throw new Error("VITE_WORKER_URL is not set");
if (!TURNSTILE_SITE_KEY) throw new Error("VITE_TURNSTILE_SITE_KEY is not set");

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
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);
  const [selectedFileName, setSelectedFileName] = useState("");

  const onDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      inputRef.current.files = files;
      onFileChange({ target: { files } });
    }
  };

  const onFileChange = async (e) => {
    const f = e.target.files?.[0];
    setSelectedFileName(f ? f.name : "");
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
    <div className="max-w-3xl mx-auto px-6 py-10 text-gray-800 font-sans">
      {/* --- Info Card --- */}
      <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-5 mb-6 text-sm text-gray-600 space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">Proof Insight</h1>
        <p>Securely prove your document’s integrity — without uploading the file.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Your file never leaves your browser (only SHA-256 hash is processed).</li>
          <li>Free users can register <strong>up to 10 proofs per address</strong>.</li>
          <li>Steps: Choose file → Sign → Submit → Verify.</li>
        </ul>
      </div>

      {/* Step 1 */}
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Step 1. Select your file</h2>
      <div
        onDragEnter={onDrag}
        onDragOver={onDrag}
        onDragLeave={onDrag}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${dragActive ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-gray-50"
          }`}
        onClick={() => inputRef.current?.click()}
      >
        <p className="text-gray-700 text-sm">
          {dragActive ? "Drop your file here..." : "Drag & drop your file here or click to browse"}
        </p>
        <input
          ref={inputRef}
          type="file"
          onChange={onFileChange}
          className="hidden"
        />
      </div>
      {selectedFileName && (
        <div className="mt-3 flex items-center justify-between bg-white border rounded px-3 py-2 text-sm">
          <span className="text-gray-700 truncate">{selectedFileName}</span>
          <button
            onClick={() => {
              setSelectedFileName("");
              setHash("");
              fileInputRef.current.value = "";
            }}
            className="text-red-500 hover:text-red-600 text-xs"
          >
            ✕
          </button>
        </div>
      )}
      <div className="mt-3">
        <div className="text-gray-600 text-sm font-medium">File Hash (SHA-256)</div>
        <div className="font-mono text-xs break-all bg-white border rounded p-2 mt-1">
          {hash || "—"}
        </div>
      </div>

      {/* Step 2 */}
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Step 2. Sign & Register Proof</h2>
      <div className="flex flex-wrap gap-3 mb-4">
        <button
          onClick={onSign}
          disabled={!hash || !!sig}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          Sign with Wallet
        </button>
        <button
          onClick={onSubmit}
          disabled={!sig || !turnstileToken}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          Submit Proof
        </button>
        <button
          onClick={onVerify}
          disabled={!hash}
          className="ml-auto px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
        >
          Verify Proof
        </button>
      </div>

      {/* Status */}
      <div className="mt-6 bg-gray-50 border rounded-lg p-4 space-y-2 text-sm">
        <div><strong>Status:</strong> {status || "—"}</div>
        <div><strong>User (address):</strong> <span className="font-mono">{userAddr || "—"}</span></div>
        <div><strong>Signature:</strong> <div className="font-mono break-all">{sig || "—"}</div></div>

        {registerResult && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3 mt-2">
            <strong>Registration Result</strong>
            <div>Tx Hash: <a href={`${SCAN_BASE_URL}${registerResult.txHash}`} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">{registerResult.txHash}</a></div>
            <div>Block: {registerResult.blockNumber}</div>
          </div>
        )}

        {verifyResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mt-2">
            <strong>Verification Result</strong>
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

      {/* Turnstile */}
      <div className="flex justify-center my-4">
        <Turnstile ref={turnstileRef} siteKey={TURNSTILE_SITE_KEY} onSuccess={setTurnstileToken} />
      </div>

    </div>
  );
}