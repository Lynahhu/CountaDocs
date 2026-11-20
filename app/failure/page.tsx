import Link from "next/link";

export default function FailurePage() {
  return (
    <div style={{ padding: "60px 20px", textAlign: "center", fontFamily: "sans-serif", maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ width: "64px", height: "64px", borderRadius: "50%", backgroundColor: "#FEE2E2", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: "32px" }}>
        ✕
      </div>
      <h1 style={{ fontSize: "28px", color: "#163F30", marginBottom: "12px" }}>Payment Cancelled or Failed</h1>
      <p style={{ color: "#4B6358", fontSize: "16px", marginBottom: "32px", lineHeight: "1.5" }}>
        The payment attempt was not completed. No charges were made to your account.
      </p>
      <Link
        href="/?payment=failed"
        style={{
          display: "inline-block",
          padding: "12px 28px",
          backgroundColor: "#25865D",
          color: "#fff",
          borderRadius: "8px",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "15px",
        }}
      >
        Try Again
      </Link>
    </div>
  );
}
