import Link from "next/link";

export default function SuccessPage() {
  return (
    <div style={{ padding: "60px 20px", textAlign: "center", fontFamily: "sans-serif", maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ width: "64px", height: "64px", borderRadius: "50%", backgroundColor: "#E3F1E7", color: "#25865D", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: "32px" }}>
        ✓
      </div>
      <h1 style={{ fontSize: "28px", color: "#163F30", marginBottom: "12px" }}>Payment Successful!</h1>
      <p style={{ color: "#4B6358", fontSize: "16px", marginBottom: "32px", lineHeight: "1.5" }}>
        Your payment has been received and verified by Chargily. You can now create your workspace account.
      </p>
      <Link
        href="/?payment=success"
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
        Continue to Workspace
      </Link>
    </div>
  );
}
