import React, { useEffect, useRef, useState } from "react";

type InviteModalProps = {
  open: boolean;
  onClose: () => void;
  onSend: (payload: { email: string; role: string }) => Promise<{
    inviteUrl?: string;
  }>;
};

const ROLE_OPTIONS = ["MEMBER", "ADMIN"];

export const InviteModal: React.FC<InviteModalProps> = ({
  open,
  onClose,
  onSend,
}) => {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setRole("MEMBER");
    setSubmitting(false);
    setInviteUrl(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Invite collaborator"
        onClick={(evt) => evt.stopPropagation()}
        onKeyDown={(evt) => {
          if (evt.key === "Escape") onClose();
        }}
      >
        <div className="modal-header">
          <h3>Invite collaborators</h3>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="modal-subtitle">
          Add teammates to this workspace. They will see the Venn diagram once
          they accept.
        </p>
        <form
          onSubmit={async (evt) => {
            evt.preventDefault();
            if (!email.trim()) return;
            setSubmitting(true);
            const result = await onSend({ email: email.trim(), role });
            if (result?.inviteUrl) {
              setInviteUrl(result.inviteUrl);
            }
            setSubmitting(false);
          }}
        >
          <label className="field-label" htmlFor="invite-email">
            Email
          </label>
          <input
            id="invite-email"
            ref={inputRef}
            className="text-input"
            type="email"
            placeholder="teammate@company.com"
            value={email}
            onChange={(evt) => setEmail(evt.target.value)}
            required
          />
          <label className="field-label" htmlFor="invite-role">
            Role
          </label>
          <select
            id="invite-role"
            className="text-input"
            value={role}
            onChange={(evt) => setRole(evt.target.value)}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.toLowerCase()}
              </option>
            ))}
          </select>
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Sending..." : "Send invite"}
            </button>
          </div>
        </form>
        {inviteUrl && (
          <div className="invite-link">
            <div className="field-label">Invite link</div>
            <div className="invite-link-row">
              <input className="text-input" value={inviteUrl} readOnly />
              <button
                className="button secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteUrl);
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
