import "express-session"

declare module "express-session" {
  interface SessionData {
    /** Set when /oauth2/auth starts a flow so the session (and its id) is persisted */
    oauthFlowStartedAt?: number
  }
}
