import React from "react";

type LoginPageProps = {
  loginUrl: string;
};

export const LoginPage: React.FC<LoginPageProps> = ({ loginUrl }) => {
  return (
    <div className="login-page">
      <div className="login-hero">
        <div className="login-brand">
          <div className="login-logo">V</div>
          <div>
            <h1>Vennify</h1>
            <p>Canvas-first project planning for overlapping scope.</p>
          </div>
        </div>

        <div className="login-cta">
          <h2>Sign in to your workspace</h2>
          <p>
            Your modules, items, and placement history live in one shared
            workspace. Log in to continue exactly where you left off.
          </p>
          <a className="button login-button" href={loginUrl}>
            Continue with Google
          </a>
          <div className="login-note">
            OAuth is used to secure your workspace. We only store your basic
            profile details.
          </div>
        </div>
      </div>

      <div className="login-grid">
        <div className="login-card">
          <h3>Venn Workspace</h3>
          <p>
            Drag modules, resize overlaps, and place items visually. Membership
            updates are synced across the team in real time.
          </p>
        </div>
        <div className="login-card">
          <h3>Shared Project State</h3>
          <p>
            Your diagram, list, and detail panel are stored in Postgres so every
            teammate sees the same scope map.
          </p>
        </div>
        <div className="login-card">
          <h3>Audit Ready</h3>
          <p>
            The foundation is set for roles, permissions, and activity history
            as the app scales.
          </p>
        </div>
      </div>

      <div className="login-footer">
        <span>Secure workspace access · Powered by Google OAuth</span>
      </div>
    </div>
  );
};
