import type { CSSProperties } from 'react';

export default function ResetPasswordPage() {
  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <p style={styles.eyebrow}>Account security</p>
        <h1 style={styles.title}>Reset your password</h1>
        <p style={styles.subtitle}>Enter a new password for your account and confirm it below.</p>

        <form style={styles.form}>
          <label style={styles.field}>
            <span style={styles.label}>New password</span>
            <input type="password" placeholder="Enter new password" style={styles.input} />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Confirm password</span>
            <input type="password" placeholder="Re-enter new password" style={styles.input} />
          </label>

          <button type="submit" style={styles.button}>Update password</button>
        </form>
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f172a 0%, #111827 100%)',
    padding: '24px',
    fontFamily: 'Arial, sans-serif'
  },
  card: {
    width: '100%',
    maxWidth: '480px',
    padding: '32px 28px',
    borderRadius: '20px',
    background: 'rgba(15, 23, 42, 0.9)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.45)',
    color: '#e2e8f0'
  },
  eyebrow: {
    margin: 0,
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#7dd3fc'
  },
  title: {
    margin: '12px 0 8px',
    fontSize: '2rem',
    lineHeight: 1.2,
    color: '#f8fafc'
  },
  subtitle: {
    margin: 0,
    color: '#cbd5e1',
    lineHeight: 1.6
  },
  form: {
    marginTop: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px'
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#e2e8f0'
  },
  input: {
    width: '100%',
    borderRadius: '12px',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    background: 'rgba(15, 23, 42, 0.7)',
    color: '#f8fafc',
    padding: '12px 14px',
    fontSize: '1rem',
    outline: 'none',
    boxSizing: 'border-box'
  },
  button: {
    marginTop: '8px',
    border: 'none',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)',
    color: '#f8fafc',
    fontSize: '1rem',
    fontWeight: 700,
    padding: '14px 16px',
    cursor: 'pointer'
  }
};