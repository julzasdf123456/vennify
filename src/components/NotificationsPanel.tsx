import React from "react";
import { UserNotification, WorkspaceInvite } from "../lib/api";

type NotificationsPanelProps = {
  invites: WorkspaceInvite[];
  notifications: UserNotification[];
  onAccept: (token: string) => Promise<void>;
  onClose: () => void;
};

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({
  invites,
  notifications,
  onAccept,
  onClose,
}) => {
  return (
    <div className="notifications-panel">
      <div className="notifications-header">
        <h3>Notifications</h3>
        <button className="icon-btn" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="notifications-section">
        <div className="notifications-section-title">Invitations</div>
        {invites.length === 0 ? (
          <div className="notifications-empty">
            No pending invitations right now.
          </div>
        ) : (
          <div className="notifications-list">
            {invites.map((invite) => (
              <div key={invite.id} className="notifications-card">
                <div>
                  <div className="notifications-title">{invite.workspace.name}</div>
                  <div className="notifications-meta">
                    Role: {invite.role.toLowerCase()}
                  </div>
                  <div className="notifications-meta">
                    Invited as {invite.email}
                  </div>
                </div>
                <button
                  className="button"
                  onClick={() => onAccept(invite.token)}
                >
                  Accept
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="notifications-section">
        <div className="notifications-section-title">Assignments</div>
        {notifications.length === 0 ? (
          <div className="notifications-empty">No assignment notifications.</div>
        ) : (
          <div className="notifications-list">
            {notifications.map((note) => (
              <div key={note.id} className="notifications-card compact">
                <div>
                  <div className="notifications-title">{note.message}</div>
                  <div className="notifications-meta">
                    {new Date(note.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
